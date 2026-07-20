/**
 * Unit tests for the PACE plan builder.
 *
 * Tests:
 *  - Golden-hour Level I becomes Primary (P slot)
 *  - Level I beyond golden hour is excluded from PACE (goes to echelon plan only)
 *  - Non-Level-I Primary: closest highest-capability facility, surgical prioritised
 *  - P/A never draw from tier-1 (Level IV) facilities when Level III+ exists
 *  - P/A never draw from pediatric-only facilities when eligible options exist
 *  - Graceful fallback when no eligible (Level III+) facility is available
 *  - Warnings emitted for fallback slots
 *  - Medic overrides win regardless of eligibility
 */

import { buildFacilityPace } from './pace'
import type { FacilityScore, TransitInfo } from './rank'
import type { FacilityRecord } from './facilities/merge'
import type { CapabilityFlag } from './careLevel'

function mkFacility(overrides: Partial<FacilityRecord>): FacilityRecord {
  return {
    id: `fac-${Math.random().toString(36).slice(2)}`,
    name: 'Test Facility',
    lat: 0, lon: 0,
    phone: '',
    address: '',
    beds: 100,
    hasHelipad: false,
    hasEmergency: true,
    tier: 2,
    capabilities: [] as CapabilityFlag[],
    inferredCapabilities: [] as CapabilityFlag[],
    pediatricOnly: false,
    source: 'osm',
    isCustom: false,
    ...overrides,
  }
}

function mkTransit(effectiveS: number): TransitInfo {
  return { groundDurationS: effectiveS, heloDurationS: null, effectiveDurationS: effectiveS }
}

function mkScore(fac: FacilityRecord, effectiveS = 1800, score = 200): FacilityScore {
  return { facility: fac, transit: mkTransit(effectiveS), score, withinGoldenHour: effectiveS <= 3600 }
}

// ── Primary selection doctrine ────────────────────────────────────────────────

describe('buildFacilityPace — Primary selection doctrine', () => {

  test('golden-hour Level I becomes Primary regardless of rank order', () => {
    // Level I is farther by score but within golden hour — doctrine puts it at Primary.
    const lvlI  = mkFacility({ id: 'l1', name: 'Level I Trauma', tier: 4 })
    const lvlIII = mkFacility({ id: 'l3', name: 'Community Hospital', tier: 2, capabilities: ['surgical'] as CapabilityFlag[] })

    const ranked: FacilityScore[] = [
      mkScore(lvlIII, 600, 300),    // closer, surgical, but not Level I
      mkScore(lvlI, 2400, 200),     // Level I, within golden hour (40 min)
    ]

    const { entries } = buildFacilityPace({
      ranked,
      allFacilities: [lvlIII, lvlI],
    })

    const pEntry = entries.find(e => e.letter === 'P')!
    expect(pEntry.facility.id).toBe('l1')   // Level I wins Primary
    expect(pEntry.facility.tier).toBe(4)
  })

  test('Level I beyond golden hour is excluded from PACE', () => {
    const lvlI   = mkFacility({ id: 'l1', name: 'Far Level I', tier: 4 })
    const lvlIII = mkFacility({ id: 'l3', name: 'Surgical Unit', tier: 3, capabilities: ['surgical'] as CapabilityFlag[] })

    const ranked: FacilityScore[] = [
      mkScore(lvlI,   9000, 400),   // Level I, 150 min — beyond golden hour
      mkScore(lvlIII, 1200, 200),   // Level III with surgical, within golden hour
    ]

    const { entries } = buildFacilityPace({ ranked, allFacilities: [lvlI, lvlIII] })

    // Level I must NOT appear in any slot — it belongs to the echelon plan
    const allIds = entries.map(e => e.facility.id)
    expect(allIds).not.toContain('l1')

    // Primary should be the Level III surgical-capable hospital
    const pEntry = entries.find(e => e.letter === 'P')!
    expect(pEntry.facility.id).toBe('l3')
  })

  test('without golden-hour Level I: closest highest-tier facility is Primary', () => {
    // No Level I anywhere — Primary is the closest best tier.
    const t3near = mkFacility({ id: 'a', name: 'Near Level II',  tier: 3 })
    const t3far  = mkFacility({ id: 'b', name: 'Far Level II',   tier: 3 })
    const t2     = mkFacility({ id: 'c', name: 'Level III',      tier: 2 })

    const ranked: FacilityScore[] = [
      mkScore(t3near, 1200, 350),   // tier 3, 20 min
      mkScore(t3far,  3000, 300),   // tier 3, 50 min
      mkScore(t2,      600, 200),   // tier 2, 10 min — closer but lower tier
    ]

    const { entries } = buildFacilityPace({ ranked, allFacilities: [t3near, t3far, t2] })
    const pEntry = entries.find(e => e.letter === 'P')!
    // Tier 3 wins over tier 2 regardless of transit; among tier 3, nearest wins
    expect(pEntry.facility.id).toBe('a')
  })

  test('surgical capability breaks tie among same-tier facilities', () => {
    const withSurg    = mkFacility({ id: 'surg', name: 'Surgical Unit', tier: 3, capabilities: ['surgical'] as CapabilityFlag[] })
    const withoutSurg = mkFacility({ id: 'gen',  name: 'General ED',    tier: 3, capabilities: [] })

    const ranked: FacilityScore[] = [
      mkScore(withoutSurg, 600, 300),   // no surgical, closer
      mkScore(withSurg,    900, 280),   // surgical, slightly farther
    ]

    const { entries } = buildFacilityPace({ ranked, allFacilities: [withoutSurg, withSurg] })
    const pEntry = entries.find(e => e.letter === 'P')!
    // Surgical capability outranks a closer same-tier facility without it
    expect(pEntry.facility.id).toBe('surg')
  })

  test('among equal tier and capability, closest is Primary', () => {
    const near = mkFacility({ id: 'near', name: 'Nearby ED',  tier: 2, capabilities: ['surgical'] as CapabilityFlag[] })
    const far  = mkFacility({ id: 'far',  name: 'Far ED',     tier: 2, capabilities: ['surgical'] as CapabilityFlag[] })

    const ranked: FacilityScore[] = [
      mkScore(near, 600, 300),
      mkScore(far, 3000, 200),
    ]

    const { entries } = buildFacilityPace({ ranked, allFacilities: [near, far] })
    expect(entries.find(e => e.letter === 'P')!.facility.id).toBe('near')
  })

})

// ── Eligibility floor ─────────────────────────────────────────────────────────

describe('buildFacilityPace — eligibility floor', () => {

  test('P and A draw from Level III+ when available', () => {
    const tier1  = mkFacility({ id: 'a', name: 'Local A&E',       tier: 1, capabilities: [] })
    const tier2  = mkFacility({ id: 'b', name: 'District General', tier: 2, capabilities: [] })
    const tier3  = mkFacility({ id: 'c', name: 'Trauma Unit',      tier: 3, capabilities: [] })

    const ranked: FacilityScore[] = [
      mkScore(tier1, 300, 295),
      mkScore(tier3, 600, 285),
      mkScore(tier2, 1200, 280),
    ]

    const { entries, warnings } = buildFacilityPace({
      ranked,
      allFacilities: [tier1, tier2, tier3],
    })

    const pEntry = entries.find(e => e.letter === 'P')!
    const aEntry = entries.find(e => e.letter === 'A')!

    expect(pEntry.facility.tier).toBeGreaterThanOrEqual(2)
    expect(aEntry.facility.tier).toBeGreaterThanOrEqual(2)
    expect(warnings).toHaveLength(0)

    // C or E can be basic care
    const ceIds = entries.filter(e => e.letter === 'C' || e.letter === 'E').map(e => e.facility.id)
    expect(ceIds).toContain('a')
  })

  test('Pediatric-only facility excluded from ALL PACE slots (P/A/C/E)', () => {
    const pedsFac    = mkFacility({ id: 'p',  name: "Children's Hospital", tier: 3, pediatricOnly: true })
    const traumaFac  = mkFacility({ id: 't1', name: 'Trauma Unit Alpha',   tier: 3, pediatricOnly: false })
    const traumaFac2 = mkFacility({ id: 't2', name: 'Trauma Unit Beta',    tier: 2, pediatricOnly: false })

    const ranked: FacilityScore[] = [
      mkScore(pedsFac, 300, 300),
      mkScore(traumaFac, 600, 280),
      mkScore(traumaFac2, 900, 260),
    ]

    const { entries, warnings } = buildFacilityPace({
      ranked,
      allFacilities: [pedsFac, traumaFac, traumaFac2],
    })

    const pEntry = entries.find(e => e.letter === 'P')!
    const aEntry = entries.find(e => e.letter === 'A')!
    expect(pEntry.facility.pediatricOnly).toBe(false)
    expect(aEntry.facility.pediatricOnly).toBe(false)
    expect(warnings).toHaveLength(0)

    const allIds = entries.map(e => e.facility.id)
    expect(allIds).not.toContain('p')
  })

  test('Pediatric-only facility not used for A when only 1 eligible facility exists', () => {
    const pedsFac   = mkFacility({ id: 'p', name: "Children's Hospital", tier: 3, pediatricOnly: true })
    const traumaFac = mkFacility({ id: 't', name: 'Trauma Unit',         tier: 3, pediatricOnly: false })

    const ranked: FacilityScore[] = [
      mkScore(pedsFac, 300, 300),
      mkScore(traumaFac, 600, 280),
    ]

    const { entries, warnings } = buildFacilityPace({
      ranked,
      allFacilities: [pedsFac, traumaFac],
    })

    const pEntry = entries.find(e => e.letter === 'P')!
    expect(pEntry.facility.id).toBe('t')
    expect(pEntry.facility.pediatricOnly).toBe(false)

    const allIds = entries.map(e => e.facility.id)
    expect(allIds).not.toContain('p')
    expect(warnings).toHaveLength(0)
  })

  test('excludeFromPace flag removes facility from all PACE slots', () => {
    const excluded = mkFacility({ id: 'x', name: 'Flagged Hospital', tier: 3, excludeFromPace: true })
    const eligible = mkFacility({ id: 'e', name: 'Eligible Hospital', tier: 3 })

    const ranked: FacilityScore[] = [
      mkScore(excluded, 300, 300),
      mkScore(eligible, 600, 280),
    ]

    const { entries } = buildFacilityPace({
      ranked,
      allFacilities: [excluded, eligible],
    })

    const allIds = entries.map(e => e.facility.id)
    expect(allIds).not.toContain('x')
    expect(allIds).toContain('e')
  })

  test('Graceful fallback when no Level III+ facility exists — warning emitted', () => {
    const basic1 = mkFacility({ id: 'b1', name: 'Clinic Alpha', tier: 1 })
    const basic2 = mkFacility({ id: 'b2', name: 'Clinic Beta',  tier: 1 })

    const ranked: FacilityScore[] = [
      mkScore(basic1, 600, 200),
      mkScore(basic2, 1200, 150),
    ]

    const { entries, warnings } = buildFacilityPace({
      ranked,
      allFacilities: [basic1, basic2],
    })

    const pEntry = entries.find(e => e.letter === 'P')
    const aEntry = entries.find(e => e.letter === 'A')
    expect(pEntry).toBeDefined()
    expect(aEntry).toBeDefined()

    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toMatch(/Level III\+/)

    // Fallback entries should have a phasedNote warning annotation
    expect(pEntry?.phasedNote).toBeTruthy()
  })

  test('Medic override wins regardless of eligibility (pediatric-only override)', () => {
    const pedsFac   = mkFacility({ id: 'p', name: "Children's Hospital", tier: 3, pediatricOnly: true })
    const traumaFac = mkFacility({ id: 't', name: 'Trauma Unit',         tier: 3, pediatricOnly: false })

    const ranked: FacilityScore[] = [
      mkScore(traumaFac, 600, 300),
      mkScore(pedsFac, 300, 280),
    ]

    const { entries } = buildFacilityPace({
      ranked,
      allFacilities: [pedsFac, traumaFac],
      overrides: { P: 'p' },
    })

    const pEntry = entries.find(e => e.letter === 'P')!
    expect(pEntry.facility.id).toBe('p')
    expect(pEntry.overridden).toBe(true)
  })

})

// ── Dive mode (requiredCapability: hyperbaric) ────────────────────────────────

describe('buildFacilityPace — dive mode (requiredCapability: hyperbaric)', () => {

  test('only chamber facilities are auto-assigned to PACE slots', () => {
    const chamberFac = mkFacility({ id: 'c1', name: 'HBO Unit', tier: 3, capabilities: ['hyperbaric', 'surgical'] as CapabilityFlag[] })
    const plainFac   = mkFacility({ id: 'p1', name: 'Plain ED', tier: 4, capabilities: ['surgical'] as CapabilityFlag[] })
    const chamberFac2 = mkFacility({ id: 'c2', name: 'HBO Center 2', tier: 2, capabilities: ['hyperbaric'] as CapabilityFlag[] })

    const ranked: FacilityScore[] = [
      mkScore(plainFac,   600, 300),
      mkScore(chamberFac, 900, 295),
      mkScore(chamberFac2, 1800, 250),
    ]

    const { entries, warnings } = buildFacilityPace({
      ranked,
      allFacilities: [plainFac, chamberFac, chamberFac2],
      requiredCapability: 'hyperbaric',
    })

    expect(warnings).toHaveLength(0)

    for (const e of entries) {
      if (!e.overridden) {
        expect(e.facility.capabilities).toContain('hyperbaric')
      }
    }
  })

  test('emits a warning and leaves slots empty when no chamber facility in pool', () => {
    const plainT4 = mkFacility({ id: 'x', name: 'Trauma Center', tier: 4, capabilities: ['surgical'] as CapabilityFlag[] })
    const ranked: FacilityScore[] = [mkScore(plainT4, 600, 300)]

    const { entries, warnings } = buildFacilityPace({
      ranked,
      allFacilities: [plainT4],
      requiredCapability: 'hyperbaric',
    })

    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toMatch(/hyperbaric|recompression|dive/i)
    const autoEntries = entries.filter(e => !e.overridden)
    expect(autoEntries).toHaveLength(0)
  })

  test('capability mode finds chambers ranked below position 8', () => {
    const hospitals = Array.from({ length: 10 }, (_, i) =>
      mkFacility({ id: `h${i}`, name: `Hospital ${i}`, tier: 4, capabilities: ['surgical'] as CapabilityFlag[] })
    )
    const chamber = mkFacility({ id: 'hbo', name: 'HBO Center', tier: 2, capabilities: ['hyperbaric'] as CapabilityFlag[], isChamber: true })

    const ranked: FacilityScore[] = [
      ...hospitals.map((h, i) => mkScore(h, 600 + i * 60, 380 - i)),
      mkScore(chamber, 1200, 50),
    ]

    const { entries, warnings } = buildFacilityPace({
      ranked,
      allFacilities: [...hospitals, chamber],
      requiredCapability: 'hyperbaric',
      poolMode: 'capability',
    })

    expect(warnings).toHaveLength(0)
    const pEntry = entries.find(e => e.letter === 'P')!
    expect(pEntry.facility.id).toBe('hbo')
  })

  test('medic override bypasses dive-mode capability requirement', () => {
    const plainFac   = mkFacility({ id: 'plain', name: 'Plain Trauma', tier: 4, capabilities: ['surgical'] as CapabilityFlag[] })
    const chamberFac = mkFacility({ id: 'hbo',   name: 'HBO Center',   tier: 2, capabilities: ['hyperbaric'] as CapabilityFlag[] })

    const ranked: FacilityScore[] = [
      mkScore(plainFac, 600, 300),
      mkScore(chamberFac, 2400, 200),
    ]

    const { entries } = buildFacilityPace({
      ranked,
      allFacilities: [plainFac, chamberFac],
      overrides: { P: 'plain' },
      requiredCapability: 'hyperbaric',
    })

    const pEntry = entries.find(e => e.letter === 'P')!
    expect(pEntry.facility.id).toBe('plain')
    expect(pEntry.overridden).toBe(true)
  })

})
