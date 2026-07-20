/**
 * Unit tests for mergeFacilities — trauma-center promotion and injection cases.
 *
 * These tests exercise the Step 4 logic added for the bundled trauma-center
 * registry: co-located HIFLD/OSM hospitals are promoted to the correct tier;
 * non-co-located entries are injected as standalone 'registry' records.
 *
 * Other merge behaviour (OSM dedup, HIFLD matching, chamber injection) is
 * tested implicitly; the tests here are scoped to the trauma-center step.
 */

import { mergeFacilities, fromTraumaCenter } from './merge'
import type { FacilityRecord, } from './merge'
import type { HifldFacility } from './hifld'
import type { OsmFacility } from './overpass'
import type { TraumaCenter } from './traumaCenters'

// ── Factory helpers ───────────────────────────────────────────────────────────

function mkHifld(overrides: Partial<HifldFacility> & { lat: number; lon: number; name: string }): HifldFacility {
  return {
    hifldId: 1001,
    name: overrides.name,
    lat: overrides.lat,
    lon: overrides.lon,
    phone: '',
    address: '',
    beds: 300,
    hasHelipad: false,
    hasEmergency: true,
    tier: 2,                  // null-TRAUMA default — exactly what we're fixing
    capabilities: [],
    inferredCapabilities: [],
    traumaLevel: null,
    ...overrides,
  }
}

function mkOsm(overrides: Partial<OsmFacility> & { lat: number; lon: number; name: string }): OsmFacility {
  return {
    osmId: 9001,
    name: overrides.name,
    lat: overrides.lat,
    lon: overrides.lon,
    phone: '',
    address: '',
    beds: 0,
    hasHelipad: false,
    hasEmergency: true,
    tier: 2,
    capabilities: [],
    inferredCapabilities: [],
    ...overrides,
  }
}

function mkTrauma(overrides: Partial<TraumaCenter> & { lat: number; lon: number; name: string; level: 1 | 2 }): TraumaCenter {
  return {
    state: 'AL',
    ...overrides,
  }
}

// ── fromTraumaCenter ──────────────────────────────────────────────────────────

describe('fromTraumaCenter', () => {
  test('Level I entry → tier 4, source registry, traumaLevel 1', () => {
    const tc = mkTrauma({ name: 'UAB Hospital', lat: 33.5059, lon: -86.7995, level: 1 })
    const rec = fromTraumaCenter(tc)
    expect(rec.tier).toBe(4)
    expect(rec.source).toBe('registry')
    expect(rec.traumaLevel).toBe(1)
    expect(rec.hasEmergency).toBe(true)
    expect(rec.pediatricOnly).toBe(false)
    expect(rec.isCustom).toBe(false)
  })

  test('Level II entry → tier 3, source registry, traumaLevel 2', () => {
    const tc = mkTrauma({ name: 'HCA Gulf Coast', lat: 30.174, lon: -85.661, level: 2 })
    const rec = fromTraumaCenter(tc)
    expect(rec.tier).toBe(3)
    expect(rec.source).toBe('registry')
    expect(rec.traumaLevel).toBe(2)
  })

  test('id is stable slug derived from name', () => {
    const tc = mkTrauma({ name: 'UAB Hospital', lat: 33.5059, lon: -86.7995, level: 1 })
    expect(fromTraumaCenter(tc).id).toBe('registry-uab-hospital')
  })

  test('hasHelipad defaults true when not set', () => {
    const tc = mkTrauma({ name: 'Test', lat: 0, lon: 0, level: 1 })
    expect(fromTraumaCenter(tc).hasHelipad).toBe(true)
  })

  test('hasHelipad false when explicitly set', () => {
    const tc = mkTrauma({ name: 'Test', lat: 0, lon: 0, level: 1, hasHelipad: false })
    expect(fromTraumaCenter(tc).hasHelipad).toBe(false)
  })

  test('notes preserved', () => {
    const tc = mkTrauma({ name: 'Test', lat: 0, lon: 0, level: 1, notes: 'Role 4 facility.' })
    expect(fromTraumaCenter(tc).notes).toBe('Role 4 facility.')
  })

  test('Level I inferred capabilities include surgical', () => {
    const tc = mkTrauma({ name: 'Test', lat: 0, lon: 0, level: 1 })
    const rec = fromTraumaCenter(tc)
    expect(rec.capabilities).toContain('surgical')
    expect(rec.inferredCapabilities).toContain('surgical')
  })

  test('Level I inferred capabilities include neuro', () => {
    const tc = mkTrauma({ name: 'Test', lat: 0, lon: 0, level: 1 })
    const rec = fromTraumaCenter(tc)
    expect(rec.capabilities).toContain('neuro')
  })

  test('Level II inferred capabilities include surgical but not necessarily neuro', () => {
    const tc = mkTrauma({ name: 'Test', lat: 0, lon: 0, level: 2 })
    const rec = fromTraumaCenter(tc)
    expect(rec.capabilities).toContain('surgical')
  })
})

// ── Trauma-center promotion in mergeFacilities ────────────────────────────────

describe('mergeFacilities — trauma-center promotion', () => {
  test('co-located HIFLD hospital with null TRAUMA is promoted to correct tier', () => {
    // Simulate: HIFLD returned UAB with null TRAUMA → tier 2
    // Registry has UAB as Level I → should promote to tier 4
    const hifld = mkHifld({ name: 'UAB Hospital', lat: 33.5059, lon: -86.7995, tier: 2, traumaLevel: null })
    const tc = mkTrauma({ name: 'UAB Hospital', lat: 33.5059, lon: -86.7995, level: 1 })

    const result = mergeFacilities([], [hifld], [], [], [tc])

    // Should be exactly one record (no duplicate injection)
    const uab = result.filter(r => r.name.toLowerCase().includes('uab'))
    expect(uab).toHaveLength(1)
    expect(uab[0].tier).toBe(4)
    expect(uab[0].traumaLevel).toBe(1)
  })

  test('promoted record retains HIFLD source (not overwritten to registry)', () => {
    const hifld = mkHifld({ name: 'UAB Hospital', lat: 33.5059, lon: -86.7995 })
    const tc = mkTrauma({ name: 'UAB Hospital', lat: 33.5059, lon: -86.7995, level: 1 })

    const result = mergeFacilities([], [hifld], [], [], [tc])
    const uab = result.find(r => r.name.includes('UAB'))!
    expect(uab.source).toBe('hifld')   // was fetched from HIFLD — keep that provenance
  })

  test('promotion adds inferred capabilities for Level I', () => {
    const hifld = mkHifld({ name: 'UAB Hospital', lat: 33.5059, lon: -86.7995, tier: 2, capabilities: [] })
    const tc = mkTrauma({ name: 'UAB Hospital', lat: 33.5059, lon: -86.7995, level: 1 })

    const result = mergeFacilities([], [hifld], [], [], [tc])
    const uab = result.find(r => r.name.includes('UAB'))!
    expect(uab.capabilities).toContain('surgical')
    expect(uab.capabilities).toContain('neuro')
  })

  test('existing capabilities are preserved on promotion (union, not replace)', () => {
    const hifld = mkHifld({
      name: 'UAB Hospital', lat: 33.5059, lon: -86.7995,
      tier: 2, capabilities: ['icu', 'burn'],
    })
    const tc = mkTrauma({ name: 'UAB Hospital', lat: 33.5059, lon: -86.7995, level: 1 })

    const result = mergeFacilities([], [hifld], [], [], [tc])
    const uab = result.find(r => r.name.includes('UAB'))!
    expect(uab.capabilities).toContain('icu')
    expect(uab.capabilities).toContain('burn')
    expect(uab.capabilities).toContain('surgical')
  })

  test('does not demote a hospital that is already at a higher tier', () => {
    // Hospital already correctly identified as tier 4; registry Level II (tier 3) should not demote
    const hifld = mkHifld({ name: 'Big Hospital', lat: 33.5059, lon: -86.7995, tier: 4 })
    const tc = mkTrauma({ name: 'Big Hospital', lat: 33.5059, lon: -86.7995, level: 2 }) // L2 = tier 3

    const result = mergeFacilities([], [hifld], [], [], [tc])
    const hosp = result.find(r => r.name.includes('Big'))!
    expect(hosp.tier).toBe(4)   // must not be demoted to 3
  })

  test('backfills traumaLevel when tier is already correct but traumaLevel is null', () => {
    // Hospital already tier 4 but HIFLD left traumaLevel null — registry should backfill
    const hifld = mkHifld({ name: 'Best Hospital', lat: 33.5059, lon: -86.7995, tier: 4, traumaLevel: null })
    const tc = mkTrauma({ name: 'Best Hospital', lat: 33.5059, lon: -86.7995, level: 1 })

    const result = mergeFacilities([], [hifld], [], [], [tc])
    const hosp = result.find(r => r.name.includes('Best'))!
    expect(hosp.traumaLevel).toBe(1)
    expect(hosp.tier).toBe(4)   // tier unchanged
  })

  test('co-location match works within 2 km (TRAUMA_MATCH_RADIUS_M)', () => {
    // Place registry entry 1.5 km away from the HIFLD record — still co-located
    const hifld = mkHifld({ name: 'UAB Hospital', lat: 33.5059, lon: -86.7995, tier: 2 })
    // 1.5 km north ≈ +0.0135° lat
    const tc = mkTrauma({ name: 'UAB Hospital', lat: 33.5194, lon: -86.7995, level: 1 })

    const result = mergeFacilities([], [hifld], [], [], [tc])
    const uab = result.filter(r => r.name.toLowerCase().includes('uab'))
    expect(uab).toHaveLength(1)   // not injected as duplicate
    expect(uab[0].tier).toBe(4)   // promoted
  })

  test('does NOT match hospitals more than 2 km away (different campuses)', () => {
    // Place registry entry 3 km away — should be treated as a different hospital
    const hifld = mkHifld({ name: 'UAB Hospital', lat: 33.5059, lon: -86.7995, tier: 2 })
    // 3 km north ≈ +0.027° lat
    const tc = mkTrauma({ name: 'UAB Hospital', lat: 33.5329, lon: -86.7995, level: 1 })

    const result = mergeFacilities([], [hifld], [], [], [tc])
    // Two records: original HIFLD (not promoted) + injected registry standalone
    expect(result.length).toBeGreaterThanOrEqual(2)
    const hifldRec = result.find(r => r.source === 'hifld')
    expect(hifldRec!.tier).toBe(2)   // not promoted
  })
})

// ── Trauma-center injection in mergeFacilities ────────────────────────────────

describe('mergeFacilities — trauma-center injection (not co-located)', () => {
  test('registry entry not co-located with any merged record is injected as standalone', () => {
    // No HIFLD/OSM data at all — registry entry becomes a standalone record
    const tc = mkTrauma({ name: 'UAB Hospital', lat: 33.5059, lon: -86.7995, level: 1 })

    const result = mergeFacilities([], [], [], [], [tc])
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('registry')
    expect(result[0].name).toBe('UAB Hospital')
    expect(result[0].tier).toBe(4)
  })

  test('standalone injection preserves lat/lon', () => {
    const tc = mkTrauma({ name: 'Test Hospital', lat: 33.5059, lon: -86.7995, level: 1 })
    const result = mergeFacilities([], [], [], [], [tc])
    expect(result[0].lat).toBe(33.5059)
    expect(result[0].lon).toBe(-86.7995)
  })

  test('injected registry record has isChamber unset', () => {
    const tc = mkTrauma({ name: 'Test Hospital', lat: 33.5059, lon: -86.7995, level: 1 })
    const result = mergeFacilities([], [], [], [], [tc])
    expect(result[0].isChamber).toBeFalsy()
  })

  test('registry does not match isChamber records — chamber records not promoted', () => {
    // A standalone chamber happens to be co-located with a registry entry — should not be promoted
    // (chambers are not hospitals; step 4 explicitly skips isChamber records)
    const osm = mkOsm({ name: 'Dive Center Hospital', lat: 33.5059, lon: -86.7995 }) as OsmFacility & { isChamber: boolean }
    osm.isChamber = true
    const tc = mkTrauma({ name: 'Dive Center Hospital', lat: 33.5059, lon: -86.7995, level: 1 })

    // Pass through as OSM
    const result = mergeFacilities([osm], [], [], [], [tc])
    // The chamber-flagged OSM record should NOT be promoted
    const chamber = result.find(r => r.isChamber)
    if (chamber) {
      expect(chamber.tier).not.toBe(4)   // must not have been promoted
    }
    // There should also be a standalone registry record injected (since chamber was skipped)
    const registry = result.find(r => r.source === 'registry')
    expect(registry).toBeDefined()
  })

  test('multiple registry entries — all are either promoted or injected', () => {
    const tc1 = mkTrauma({ name: 'Hospital Alpha', lat: 33.5059, lon: -86.7995, level: 1 })
    const tc2 = mkTrauma({ name: 'Hospital Beta',  lat: 39.7283, lon: -104.9929, level: 2, state: 'CO' })

    const result = mergeFacilities([], [], [], [], [tc1, tc2])
    expect(result).toHaveLength(2)
    expect(result.map(r => r.source).every(s => s === 'registry')).toBe(true)
  })

  test('custom facilities still appear alongside registry injections', () => {
    const custom = { id: 'custom-1', name: 'SOST Alpha', lat: 30.0, lon: -85.0, phone: '', address: '', beds: 0, hasHelipad: true, tier: 3, capabilities: [], isCustom: true }
    const tc = mkTrauma({ name: 'UAB Hospital', lat: 33.5059, lon: -86.7995, level: 1 })

    const result = mergeFacilities([], [], [custom as any], [], [tc])
    expect(result.some(r => r.isCustom)).toBe(true)
    expect(result.some(r => r.source === 'registry')).toBe(true)
  })
})

// ── Empty-input guard ─────────────────────────────────────────────────────────

describe('mergeFacilities — empty inputs', () => {
  test('no inputs → empty result', () => {
    expect(mergeFacilities([], [], [], [], [])).toHaveLength(0)
  })

  test('traumaCenters param defaults to empty when omitted (4-arg call)', () => {
    const result = mergeFacilities([], [], [], [])
    expect(result).toHaveLength(0)
  })
})
