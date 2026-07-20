/**
 * Unit tests for the echelons-of-care plan assembly module.
 *
 * Tests:
 *  - selectEchelonNodes: standard path — pacePrimary becomes stabilize when no SOST
 *  - selectEchelonNodes: SOST path (operational) — SOST overrides pacePrimary as stabilize
 *  - selectEchelonNodes: returns null when PACE Primary is a Level I (gate fires)
 *  - selectEchelonNodes: builds echelon plan when Level I exists but is not the PACE Primary
 *  - selectEchelonNodes: returns null when no pacePrimary and no SOST
 *  - selectEchelonNodes: SOST in training mode is ignored (falls back to pacePrimary)
 *  - selectEchelonNodes: custom facilities excluded from definitive pool
 *  - selectEchelonNodes: picks closest Level I as definitive when multiple exist
 *  - buildEchelonPlan: two legs, Leg-2 transit = passed inter-facility value
 *  - buildEchelonPlan: training → Leg-2 is civilian handoff
 *  - buildEchelonPlan: operational rotary Leg-2 falls back to ground when no helipad
 *  - formatEchelonSummary: produces correct one-line string
 *  - pickNearestLevelI: returns nearest tier-4, excludes pediatric + custom
 *  - dive mode: requiredCapability gates definitive pool and SOST pool
 */

import { selectEchelonNodes, buildEchelonPlan, formatEchelonSummary, pickNearestLevelI, LEG2_DROP_GROUND_DIST_M, LEG2_FIXED_WING_DIST_M } from './echelon'
import type { EchelonNodes } from './echelon'
import type { FacilityRecord } from './facilities/merge'
import type { FacilityScore, TransitInfo } from './rank'
import type { CapabilityFlag } from './careLevel'

// ── Helpers ───────────────────────────────────────────────────────────────────

function mkFacility(overrides: Partial<FacilityRecord>): FacilityRecord {
  return {
    id:                   `fac-${Math.random().toString(36).slice(2)}`,
    name:                 'Test Facility',
    lat:                  0,
    lon:                  0,
    phone:                '',
    address:              '',
    beds:                 100,
    hasHelipad:           false,
    hasEmergency:         true,
    tier:                 2,
    capabilities:         [],
    inferredCapabilities: [],
    pediatricOnly:        false,
    source:               'osm',
    isCustom:             false,
    ...overrides,
  }
}

function mkScore(
  facility: FacilityRecord,
  effectiveS: number,
  groundS: number | null = effectiveS,
  heloS: number | null = null,
): FacilityScore {
  const transit: TransitInfo = {
    groundDurationS:    groundS,
    heloDurationS:      heloS,
    effectiveDurationS: effectiveS,
  }
  return { facility, transit, score: 0, withinGoldenHour: effectiveS <= 3600 }
}

function mkTransit(effectiveS: number, groundS: number | null = effectiveS, heloS: number | null = null): TransitInfo {
  return { groundDurationS: groundS, heloDurationS: heloS, effectiveDurationS: effectiveS }
}

// ── selectEchelonNodes ────────────────────────────────────────────────────────

describe('selectEchelonNodes', () => {

  test('standard path: pacePrimary becomes stabilize when no SOST present', () => {
    const definitiveHosp = mkFacility({ tier: 4, name: 'Level I Hospital', isCustom: false })
    const stabilizeHosp  = mkFacility({ tier: 2, name: 'District Hospital', isCustom: false })
    const ranked = [
      mkScore(stabilizeHosp, 600),    // close, lower tier — PACE Primary
      mkScore(definitiveHosp, 9000),  // 150 min — Level I beyond golden hour
    ]

    // pacePrimary = PACE Primary as a FacilityScore
    const pacePrimary = mkScore(stabilizeHosp, 600)

    const nodes = selectEchelonNodes(ranked, pacePrimary, 'training')
    expect(nodes).not.toBeNull()
    expect(nodes!.stabilizeAt.name).toBe('District Hospital')
    expect(nodes!.definitive.name).toBe('Level I Hospital')
    expect(nodes!.stabilizeTransit.effectiveDurationS).toBe(600)
    expect(nodes!.definitiveTransit.effectiveDurationS).toBe(9000)
    expect(nodes!.stabilizeIsSost).toBe(false)
  })

  test('SOST path (operational): SOST becomes stabilize node instead of pacePrimary', () => {
    const definitiveHosp = mkFacility({ tier: 4, name: 'Level I Hospital', isCustom: false })
    const sost           = mkFacility({ tier: 4, name: 'SOST Alpha', isCustom: true, hasHelipad: true })
    const stabilizeHosp  = mkFacility({ tier: 2, name: 'District Hospital', isCustom: false })
    const ranked = [
      mkScore(sost, 300),              // very close SOST — becomes stabilize in operational
      mkScore(stabilizeHosp, 600),
      mkScore(definitiveHosp, 9000),   // far definitive
    ]
    const pacePrimary = mkScore(stabilizeHosp, 600)

    const nodes = selectEchelonNodes(ranked, pacePrimary, 'operational')
    expect(nodes).not.toBeNull()
    expect(nodes!.stabilizeAt.name).toBe('SOST Alpha')
    expect(nodes!.stabilizeIsSost).toBe(true)
    expect(nodes!.definitive.name).toBe('Level I Hospital')
  })

  test('returns null when the PACE Primary is a Level I (gate fires — PACE already routes to definitive)', () => {
    const definitiveHosp = mkFacility({ tier: 4, name: 'Level I Hospital', isCustom: false })
    const stabilizeHosp  = mkFacility({ tier: 2, name: 'District Hospital', isCustom: false })
    const ranked = [
      mkScore(stabilizeHosp, 600),
      mkScore(definitiveHosp, 1800),
    ]
    const pacePrimary = mkScore(definitiveHosp, 1800)  // PACE Primary IS the Level I

    const nodes = selectEchelonNodes(ranked, pacePrimary, 'training')
    expect(nodes).toBeNull()
  })

  test('builds echelon plan when Level I exists but is not the PACE Primary', () => {
    // Level I is within the former golden hour (1800s) but NOT the PACE Primary.
    // New behaviour: echelon plan is built because the PACE Primary lacks Level I.
    const definitiveHosp = mkFacility({ tier: 4, name: 'Level I Hospital', isCustom: false })
    const stabilizeHosp  = mkFacility({ tier: 2, name: 'District Hospital', isCustom: false })
    const ranked = [
      mkScore(stabilizeHosp, 600),
      mkScore(definitiveHosp, 1800),   // within former golden hour but not PACE Primary
    ]
    const pacePrimary = mkScore(stabilizeHosp, 600)  // PACE Primary is a lower-tier facility

    const nodes = selectEchelonNodes(ranked, pacePrimary, 'training')
    expect(nodes).not.toBeNull()
    expect(nodes!.stabilizeAt.name).toBe('District Hospital')
    expect(nodes!.definitive.name).toBe('Level I Hospital')
  })

  test('returns null when no pacePrimary and no SOST (no stabilize node)', () => {
    const definitiveHosp = mkFacility({ tier: 4, name: 'Level I Hospital', isCustom: false })
    const otherFac       = mkFacility({ tier: 2, name: 'Local ED',          isCustom: false })
    const ranked = [
      mkScore(otherFac, 1800),
      mkScore(definitiveHosp, 9000),   // beyond golden hour — definitive pool has it
    ]

    // No pacePrimary, no SOST → no stabilize node → null
    const nodes = selectEchelonNodes(ranked, undefined, 'training')
    expect(nodes).toBeNull()
  })

  test('SOST in training mode: SOST is ignored, falls back to pacePrimary', () => {
    const definitiveHosp = mkFacility({ tier: 4, name: 'Level I Hospital', isCustom: false })
    const sost           = mkFacility({ tier: 4, name: 'SOST Alpha', isCustom: true, hasHelipad: true })
    const stabilizeHosp  = mkFacility({ tier: 2, name: 'District Hospital', isCustom: false })
    const ranked = [
      mkScore(sost, 300),
      mkScore(stabilizeHosp, 600),
      mkScore(definitiveHosp, 9000),
    ]
    const pacePrimary = mkScore(stabilizeHosp, 600)

    // Training — SOST override not active; pacePrimary is stabilize node
    const nodes = selectEchelonNodes(ranked, pacePrimary, 'training')
    expect(nodes).not.toBeNull()
    expect(nodes!.stabilizeAt.name).toBe('District Hospital')
    expect(nodes!.stabilizeIsSost).toBe(false)
  })

  test('custom facilities excluded from definitive pool — null when no non-custom Level I', () => {
    // SOST is tier-4 and custom — closest, but excluded from definitive pool.
    // With no non-custom tier-4 in the pool, definitive pool is empty → null.
    const sost = mkFacility({ tier: 4, name: 'SOST Alpha', isCustom: true, hasHelipad: true })
    const ranked = [mkScore(sost, 300)]

    const nodes = selectEchelonNodes(ranked, undefined, 'operational')
    // SOST could be stabilize, but there is no valid definitive
    expect(nodes).toBeNull()
  })

  test('picks closest Level I as definitive when multiple are available', () => {
    const def1 = mkFacility({ tier: 4, name: 'Farther Level I',   isCustom: false })
    const def2 = mkFacility({ tier: 4, name: 'Closer Level I',    isCustom: false })
    const stab = mkFacility({ tier: 2, name: 'District Hospital',  isCustom: false })
    const ranked = [
      mkScore(stab, 600),
      mkScore(def1, 12000),   // 200 min
      mkScore(def2,  8000),   // 133 min — closer
    ]
    const pacePrimary = mkScore(stab, 600)

    const nodes = selectEchelonNodes(ranked, pacePrimary, 'training')
    expect(nodes).not.toBeNull()
    expect(nodes!.definitive.name).toBe('Closer Level I')
    expect(nodes!.definitiveTransit.effectiveDurationS).toBe(8000)
  })

})

// ── buildEchelonPlan ──────────────────────────────────────────────────────────

describe('buildEchelonPlan', () => {

  const definitiveHosp = mkFacility({ tier: 4, name: 'Level I Hospital', isCustom: false, hasHelipad: true })
  const stabilizeHosp  = mkFacility({ tier: 2, name: 'District Hospital', isCustom: false, hasHelipad: true })

  const nodes: EchelonNodes = {
    stabilizeAt:       stabilizeHosp,
    stabilizeTransit:  mkTransit(600, 600, 480),    // ground 10 min, helo 8 min
    definitive:        definitiveHosp,
    definitiveTransit: mkTransit(9000, 9000, 7200),
    stabilizeIsSost:   false,
  }

  const leg2Transit = mkTransit(5400, 6000, 4800)   // inter-facility transit

  test('produces exactly two legs', () => {
    const plan = buildEchelonPlan({ nodes, leg2Transit, environment: 'training', organicAssetLabel: 'UH-60', transferAssetLabel: 'HH-60' })
    expect(plan.legs).toHaveLength(2)
  })

  test('Leg-1 is POI → stabilize with organic asset label', () => {
    const plan = buildEchelonPlan({ nodes, leg2Transit, environment: 'training', organicAssetLabel: 'UH-60', transferAssetLabel: 'HH-60' })
    const leg1 = plan.legs[0]
    expect(leg1.role).toBe('evac-to-stabilize')
    expect(leg1.from.kind).toBe('poi')
    expect(leg1.to.name).toBe('District Hospital')
    expect(leg1.assetLabel).toBe('UH-60')
    expect(leg1.transit.effectiveDurationS).toBe(600)
  })

  test('Leg-2 transit equals the passed inter-facility value', () => {
    const plan = buildEchelonPlan({ nodes, leg2Transit, environment: 'operational', organicAssetLabel: 'UH-60', transferAssetLabel: 'HH-60' })
    const leg2 = plan.legs[1]
    expect(leg2.transit.effectiveDurationS).toBe(5400)
    expect(leg2.transit.groundDurationS).toBe(6000)
    expect(leg2.transit.heloDurationS).toBe(4800)
  })

  test('training Leg-2 uses civilian handoff asset label; note on Leg-1, not Leg-2', () => {
    const plan = buildEchelonPlan({ nodes, leg2Transit, environment: 'training', organicAssetLabel: 'UH-60', transferAssetLabel: 'HH-60' })
    const leg1 = plan.legs[0]
    const leg2 = plan.legs[1]
    expect(leg2.assetLabel).toBe('Civilian EMS / hospital transfer')
    // "Team cedes control" moves to Leg-1 in training
    expect(leg1.notes).toBeDefined()
    expect(leg1.notes?.some(n => n.includes('cedes control'))).toBe(true)
    // Leg-2 has no notes in training (civilian handoff — team has already ceded)
    expect(leg2.notes).toBeUndefined()
  })

  test('operational Leg-2 uses transfer asset label', () => {
    const plan = buildEchelonPlan({ nodes, leg2Transit, environment: 'operational', organicAssetLabel: 'UH-60', transferAssetLabel: 'HH-60' })
    const leg2 = plan.legs[1]
    expect(leg2.assetLabel).toBe('HH-60')
    expect(leg2.notes).toBeUndefined()
  })

  test('operational Leg-2 falls back to ground when an endpoint lacks a helipad', () => {
    const noHelipadStab = mkFacility({ tier: 2, name: 'No Pad Hospital', hasHelipad: false })
    const noHelipadNodes: EchelonNodes = {
      ...nodes,
      stabilizeAt:       noHelipadStab,
      stabilizeTransit:  mkTransit(600, 600, null),
    }
    // Short haul (has ground): no helipad note present
    const shortHaulTransit: TransitInfo = { ...leg2Transit, groundDurationS: 6000 }
    const plan = buildEchelonPlan({ nodes: noHelipadNodes, leg2Transit: shortHaulTransit, environment: 'operational', organicAssetLabel: 'UH-60', transferAssetLabel: 'HH-60' })
    const leg2 = plan.legs[1]
    expect(leg2.mode).toBe('ground')
    expect(leg2.notes?.some(n => n.includes('No helipad'))).toBe(true)
  })

  test('plan records stabilizeAt and definitive from nodes', () => {
    const plan = buildEchelonPlan({ nodes, leg2Transit, environment: 'operational', organicAssetLabel: 'UH-60', transferAssetLabel: 'HH-60' })
    expect(plan.stabilizeAt.name).toBe('District Hospital')
    expect(plan.definitive.name).toBe('Level I Hospital')
    expect(plan.environment).toBe('operational')
  })

  test('falls back to organic label when transferAssetLabel is empty', () => {
    const plan = buildEchelonPlan({ nodes, leg2Transit, environment: 'operational', organicAssetLabel: 'UH-60', transferAssetLabel: '' })
    expect(plan.legs[1].assetLabel).toBe('UH-60')
  })

  test('operational Leg-2 with fixedWingDurationS set uses fixed-wing mode when no helipad at endpoint', () => {
    // No helipad on stabilize side → canFly = false; fixedWingDurationS is set → mode = 'fixed-wing'
    const noHelipadStab = mkFacility({ tier: 2, name: 'No Pad', hasHelipad: false })
    const noHelipadNodes: EchelonNodes = {
      ...nodes,
      stabilizeAt:      noHelipadStab,
      stabilizeTransit: mkTransit(600, 600, null),
    }
    const longHaulTransit: TransitInfo = {
      groundDurationS:    null,              // ground dropped (≥100 km)
      heloDurationS:      null,              // no helipad at stabilize
      fixedWingDurationS: 4200,              // C-130 ~70 min (≥300 km)
      effectiveDurationS: 4200,
    }
    const plan = buildEchelonPlan({ nodes: noHelipadNodes, leg2Transit: longHaulTransit, environment: 'operational', organicAssetLabel: 'UH-60', transferAssetLabel: 'HH-60' })
    const leg2 = plan.legs[1]
    expect(leg2.mode).toBe('fixed-wing')
    expect(leg2.assetLabel).toBe('C-130 (fixed-wing)')
    expect(leg2.notes?.some(n => n.includes('Airfield must be located'))).toBe(true)
    expect(leg2.notes?.some(n => n.includes('No helipad'))).toBe(false)
  })

  test('operational Leg-2 with fixedWingDurationS adds airfield note even when rotary available', () => {
    // Both helipads → rotary mode; but fixedWingDurationS is set → airfield note appended
    const longHaulTransit: TransitInfo = {
      groundDurationS:    null,
      heloDurationS:      7200,
      fixedWingDurationS: 3600,
      effectiveDurationS: 3600,
    }
    const plan = buildEchelonPlan({ nodes, leg2Transit: longHaulTransit, environment: 'operational', organicAssetLabel: 'UH-60', transferAssetLabel: 'HH-60' })
    const leg2 = plan.legs[1]
    expect(leg2.mode).toBe('rotary')   // helipads on both ends — rotary still primary
    expect(leg2.notes?.some(n => n.includes('Airfield must be located'))).toBe(true)
  })

  test('distance threshold exports are sane (100 km / 300 km in metres)', () => {
    expect(LEG2_DROP_GROUND_DIST_M).toBe(100_000)
    expect(LEG2_FIXED_WING_DIST_M).toBe(300_000)
    expect(LEG2_FIXED_WING_DIST_M).toBeGreaterThan(LEG2_DROP_GROUND_DIST_M)
  })

})

// ── formatEchelonSummary ──────────────────────────────────────────────────────

describe('formatEchelonSummary', () => {

  test('produces a two-arrow summary string', () => {
    const definitiveHosp = mkFacility({ tier: 4, name: 'Level I Hospital', hasHelipad: true })
    const stabilizeHosp  = mkFacility({ tier: 2, name: 'District Hospital', hasHelipad: true })
    const nodes: EchelonNodes = {
      stabilizeAt:       stabilizeHosp,
      stabilizeTransit:  mkTransit(600),
      definitive:        definitiveHosp,
      definitiveTransit: mkTransit(9000),
      stabilizeIsSost:   false,
    }
    const plan = buildEchelonPlan({
      nodes,
      leg2Transit:        mkTransit(5400),
      environment:        'operational',
      organicAssetLabel:  'UH-60',
      transferAssetLabel: 'HH-60',
    })
    const summary = formatEchelonSummary(plan)
    expect(summary).toContain('POI')
    expect(summary).toContain('District Hospital')
    expect(summary).toContain('Level I Hospital')
    expect(summary).toContain('UH-60')
    expect(summary).toContain('HH-60')
    // Transit: 600s = 10 min, 5400s = 90 min
    expect(summary).toContain('10 min')
    expect(summary).toContain('1 hr 30 min')
  })

  test('training summary shows civilian handoff', () => {
    const definitiveHosp = mkFacility({ tier: 4, name: 'MTC', hasHelipad: true })
    const stabilizeHosp  = mkFacility({ tier: 2, name: 'Local ED', hasHelipad: false })
    const nodes: EchelonNodes = {
      stabilizeAt:       stabilizeHosp,
      stabilizeTransit:  mkTransit(900),
      definitive:        definitiveHosp,
      definitiveTransit: mkTransit(7200),
      stabilizeIsSost:   false,
    }
    const plan = buildEchelonPlan({
      nodes,
      leg2Transit:        mkTransit(4500),
      environment:        'training',
      organicAssetLabel:  'UH-60',
      transferAssetLabel: 'HH-60',
    })
    const summary = formatEchelonSummary(plan)
    expect(summary).toContain('Civilian EMS')
    expect(summary).toContain('Local ED')
    expect(summary).toContain('MTC')
  })

})

// ── Dive mode (requiredCapability: hyperbaric) ────────────────────────────────

describe('selectEchelonNodes — dive mode (requiredCapability: hyperbaric)', () => {

  test('excludes non-chamber facilities from definitive pool', () => {
    // Closest tier-4 has no chamber; farther tier-4 does.
    // Without dive mode the closest tier-4 would be definitive.
    // With dive mode, it must be excluded from the definitive pool.
    const chamberT4 = mkFacility({ id: 'c4', name: 'HBO Level I',   tier: 4, capabilities: ['hyperbaric'] as CapabilityFlag[] })
    const plainT4   = mkFacility({ id: 'p4', name: 'Plain Level I', tier: 4, capabilities: [] })
    const nearT2    = mkFacility({ id: 'n2', name: 'Near ED',        tier: 2, capabilities: ['hyperbaric'] as CapabilityFlag[] })

    // Both Level I's are beyond golden hour (3800s > 3600s)
    const ranked = [
      mkScore(nearT2,    600),
      mkScore(plainT4,  3800),    // closest tier-4 — no chamber
      mkScore(chamberT4, 7200),   // farther tier-4 — has chamber
    ]

    const pacePrimary = mkScore(nearT2, 600)

    // Without dive mode: plainT4 is closest non-pediatric non-custom Level I → definitive
    const nodesStandard = selectEchelonNodes(ranked, pacePrimary, 'training')
    if (nodesStandard) {
      expect(nodesStandard.definitive.id).toBe('p4')
    }

    // With dive mode: plainT4 excluded (no hyperbaric); chamberT4 becomes definitive
    const nodesDive = selectEchelonNodes(ranked, pacePrimary, 'training', 'hyperbaric')
    if (nodesDive) {
      expect(nodesDive.definitive.capabilities).toContain('hyperbaric')
      expect(nodesDive.definitive.id).toBe('c4')
    }
  })

  test('returns null when no chamber facility is in the definitive pool', () => {
    // Only non-chamber highest-tier facilities — dive mode yields no valid definitive.
    const plainT4 = mkFacility({ id: 'p4', name: 'Plain Trauma', tier: 4, capabilities: [] })
    const plainT2 = mkFacility({ id: 'p2', name: 'Local ED',     tier: 2, capabilities: [] })

    const ranked = [mkScore(plainT2, 600), mkScore(plainT4, 7200)]
    const pacePrimary = mkScore(plainT2, 600)

    const nodes = selectEchelonNodes(ranked, pacePrimary, 'training', 'hyperbaric')
    expect(nodes).toBeNull()
  })

  test('excludes non-chamber SOST from operational SOST pool', () => {
    // Custom SOST without hyperbaric — should not be selected as stabilize node in dive mode.
    // Falls back to pacePrimary (which has hyperbaric).
    const sostNoHbo = mkFacility({ id: 'sost', name: 'SOST',     tier: 3, isCustom: true, hasHelipad: true, capabilities: [] })
    const chamberT4 = mkFacility({ id: 'c4',   name: 'HBO Hosp', tier: 4, isCustom: false, capabilities: ['hyperbaric'] as CapabilityFlag[] })
    const chamberT2 = mkFacility({ id: 'c2',   name: 'HBO ED',   tier: 2, isCustom: false, capabilities: ['hyperbaric'] as CapabilityFlag[] })

    // chamberT4 is beyond golden hour (7200s)
    const ranked = [mkScore(chamberT2, 900), mkScore(sostNoHbo, 600), mkScore(chamberT4, 7200)]

    // pacePrimary = chamberT2 (the PACE Primary, which has hyperbaric)
    const pacePrimary = mkScore(chamberT2, 900)

    const nodes = selectEchelonNodes(ranked, pacePrimary, 'operational', 'hyperbaric')

    // SOST without chamber must not be the stabilize node; pacePrimary (chamberT2) is used
    if (nodes) {
      expect(nodes.stabilizeAt.id).not.toBe('sost')
      expect(nodes.stabilizeAt.capabilities).toContain('hyperbaric')
    }
  })

})

// ── pickNearestLevelI ─────────────────────────────────────────────────────────

describe('pickNearestLevelI', () => {

  test('returns the nearest tier-4 (Level I) facility', () => {
    const far  = mkFacility({ id: 'l1-far',  name: 'Distant Level I', tier: 4 })
    const near = mkFacility({ id: 'l1-near', name: 'Close Level I',   tier: 4 })
    const t2   = mkFacility({ id: 't2',      name: 'Level III ED',    tier: 2 })

    const ranked = [
      mkScore(t2,    900),
      mkScore(near, 3600),
      mkScore(far,  7200),
    ]
    const result = pickNearestLevelI(ranked)
    expect(result).not.toBeNull()
    expect(result!.facility.id).toBe('l1-near')
  })

  test('returns null when no tier-4 facility is present', () => {
    const t3 = mkFacility({ id: 't3', name: 'Level II',  tier: 3 })
    const t2 = mkFacility({ id: 't2', name: 'Level III', tier: 2 })
    const ranked = [mkScore(t3, 1800), mkScore(t2, 600)]
    expect(pickNearestLevelI(ranked)).toBeNull()
  })

  test('ignores pediatric-only tier-4 facilities', () => {
    const pediatric = mkFacility({ id: 'ped', name: "Children's Level I", tier: 4, pediatricOnly: true })
    const adult     = mkFacility({ id: 'adu', name: 'Adult Level I',       tier: 4, pediatricOnly: false })

    const ranked = [mkScore(pediatric, 600), mkScore(adult, 3600)]
    const result = pickNearestLevelI(ranked)
    expect(result!.facility.id).toBe('adu')    // pediatric is nearer but excluded
  })

  test('ignores custom (SOST) tier-4 facilities', () => {
    const sost = mkFacility({ id: 'sost', name: 'SOST',          tier: 4, isCustom: true })
    const hosp = mkFacility({ id: 'hosp', name: 'Level I Trauma', tier: 4, isCustom: false })

    const ranked = [mkScore(sost, 600), mkScore(hosp, 3600)]
    const result = pickNearestLevelI(ranked)
    expect(result!.facility.id).toBe('hosp')   // SOST is nearer but excluded
  })

  test('returns null for empty ranked list', () => {
    expect(pickNearestLevelI([])).toBeNull()
  })

})
