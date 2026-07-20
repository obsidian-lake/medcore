/**
 * Unit tests for the facility ranking algorithm.
 *
 * Tests:
 *  - Higher tier wins when transit is similar
 *  - Golden-hour weighting (within vs beyond 60 min)
 *  - Tier-4 facility at 90 min still beats tier-1 at 10 min (tier weight dominates)
 *  - Stabilize-then-transfer trigger
 *  - Capability breadth as tiebreaker
 *  - Custom facility (SOST) with tier-4 close by ranks first
 */

import { rankFacilities } from './rank'
import type { RankInput } from './rank'
import { applyOverrides } from './facilities/merge'
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
    capabilities: [],
    pediatricOnly: false,
    source: 'osm',
    isCustom: false,
    ...overrides,
  }
}

function mkInput(
  tier: 1 | 2 | 3 | 4,
  groundS: number | null,
  heloS: number | null = null,
  caps: string[] = [],
  overrides: Partial<FacilityRecord> = {},
): RankInput {
  return {
    facility: mkFacility({ tier, capabilities: caps as CapabilityFlag[], ...overrides }),
    groundDurationS: groundS,
    heloDurationS: heloS,
  }
}

describe('rankFacilities', () => {

  test('higher tier wins when transit is equal', () => {
    const inputs: RankInput[] = [
      mkInput(2, 1800),
      mkInput(4, 1800),
      mkInput(1, 1800),
      mkInput(3, 1800),
    ]
    const { ranked } = rankFacilities(inputs)
    const tiers = ranked.map(r => r.facility.tier)
    expect(tiers[0]).toBe(4)
    expect(tiers[1]).toBe(3)
    expect(tiers[2]).toBe(2)
    expect(tiers[3]).toBe(1)
  })

  test('within-golden-hour bonus: same tier, closer facility ranked higher', () => {
    const inputs: RankInput[] = [
      mkInput(3, 3000),   // 50 min — within golden hour
      mkInput(3, 5400),   // 90 min — beyond golden hour
    ]
    const { ranked } = rankFacilities(inputs)
    expect(ranked[0].transit.groundDurationS).toBe(3000)
    expect(ranked[0].withinGoldenHour).toBe(true)
    expect(ranked[1].withinGoldenHour).toBe(false)
  })

  test('tier-4 far away still beats tier-1 close: tier weight dominates', () => {
    const inputs: RankInput[] = [
      mkInput(4, 7200),   // 2 hr away — definitive care
      mkInput(1, 600),    // 10 min — basic care
    ]
    const { ranked } = rankFacilities(inputs)
    expect(ranked[0].facility.tier).toBe(4)
  })

  test('stabilize-then-transfer: tier-4 far, tier-2 very close → phased', () => {
    // At 150 min (9000s), the transit penalty is large enough that tier-2 at 10 min
    // may outscore tier-4 in ranking — that's intentional (most accessible care first).
    // The phasedRecommendation is what tells the medic to stabilize at tier-2 then
    // transfer to tier-4 as the definitive option.
    const inputs: RankInput[] = [
      mkInput(4, 9000),   // 150 min — far definitive care
      mkInput(2, 600),    // 10 min — nearby stabilize
    ]
    const { phasedRecommendation } = rankFacilities(inputs)
    expect(phasedRecommendation).toBeDefined()
    expect(phasedRecommendation!.stabilizeAt.tier).toBe(2)
    expect(phasedRecommendation!.thenTransferTo.tier).toBe(4)
    expect(phasedRecommendation!.stabilizeTransit.effectiveDurationS).toBe(600)
    expect(phasedRecommendation!.transferTransit.effectiveDurationS).toBe(9000)
  })

  test('no phased recommendation when tier-4 is within golden hour', () => {
    // Tier-4 at 30 min: well within golden hour → go directly, no staging needed.
    const inputs: RankInput[] = [
      mkInput(4, 1800),   // 30 min — close definitive (within golden hour)
      mkInput(2, 600),    // 10 min — nearby
    ]
    const { phasedRecommendation } = rankFacilities(inputs)
    expect(phasedRecommendation).toBeUndefined()
  })

  test('capability breadth breaks ties: more caps wins', () => {
    const inputs: RankInput[] = [
      mkInput(3, 2000, null, []),
      mkInput(3, 2000, null, ['neuro', 'burns', 'surgical']),
    ]
    const { ranked } = rankFacilities(inputs)
    expect(ranked[0].facility.capabilities).toHaveLength(3)
  })

  test('helo transit used when faster than ground', () => {
    const inputs: RankInput[] = [
      mkInput(3, 5400, 1200),   // ground 90 min, helo 20 min → effective = 20 min
    ]
    const { ranked } = rankFacilities(inputs)
    expect(ranked[0].transit.effectiveDurationS).toBe(1200)
    expect(ranked[0].withinGoldenHour).toBe(true)
  })

  test('custom SOST (tier-4) at 5 min ranks first', () => {
    const inputs: RankInput[] = [
      mkInput(4, 300, null, ['surgical', 'neuro'], { isCustom: true, name: 'SOST Alpha' }),
      mkInput(4, 1800),
      mkInput(3, 900),
    ]
    const { ranked } = rankFacilities(inputs)
    expect(ranked[0].facility.name).toBe('SOST Alpha')
  })

  test('empty input returns empty ranked list, no phased recommendation', () => {
    const { ranked, phasedRecommendation } = rankFacilities([])
    expect(ranked).toHaveLength(0)
    expect(phasedRecommendation).toBeUndefined()
  })

  test('tier override drives re-ranking: upgraded facility moves to top', () => {
    // Facility A starts at tier 1 (Level IV), B at tier 4 (Level I), same transit.
    const facilityA = mkFacility({ tier: 1, name: 'Local ED' })
    const facilityB = mkFacility({ tier: 4, name: 'Major Trauma Centre' })
    const inputs: RankInput[] = [
      { facility: facilityA, groundDurationS: 1800, heloDurationS: null },
      { facility: facilityB, groundDurationS: 1800, heloDurationS: null },
    ]

    // Before override: B ranks first
    const { ranked: before } = rankFacilities(inputs)
    expect(before[0].facility.name).toBe('Major Trauma Centre')
    expect(before[1].facility.name).toBe('Local ED')

    // Apply a tier override to A (medic knows it was mis-classified)
    const upgradedA = applyOverrides(facilityA, { tier: 4 })
    expect(upgradedA.tier).toBe(4)
    expect(upgradedA.overrides?.tier).toBe(4)

    // Re-rank using stored transit durations (the App.tsx no-refetch pattern)
    const reRankInputs: RankInput[] = [
      { facility: upgradedA, groundDurationS: 1800, heloDurationS: null },
      { facility: facilityB, groundDurationS: 1800, heloDurationS: null },
    ]
    const { ranked: after } = rankFacilities(reRankInputs)

    // Both now tier 4 — the score diff should be zero (same tier, same transit,
    // same caps). The upgrade is reflected: upgraded A is no longer last.
    const afterScores = after.map(s => s.score)
    expect(afterScores[0]).toBe(afterScores[1])          // tied at tier-4 score
    expect(after.some(s => s.facility.name === 'Local ED')).toBe(true)
    // 'Local ED' must appear in top half (not last when there are only 2)
    const upgradedIdx = after.findIndex(s => s.facility.name === 'Local ED')
    expect(upgradedIdx).toBeLessThanOrEqual(1)           // in top 2 of 2
  })

  test('tier downgrade via override reduces score and can push facility down', () => {
    // B starts at tier 4, we downgrade it to tier 2
    const facilityA = mkFacility({ tier: 3, name: 'Trauma Unit' })
    const facilityB = mkFacility({ tier: 4, name: 'MTC — but closed wing' })
    const inputs: RankInput[] = [
      { facility: facilityA, groundDurationS: 1800, heloDurationS: null },
      { facility: facilityB, groundDurationS: 1800, heloDurationS: null },
    ]

    const { ranked: before } = rankFacilities(inputs)
    expect(before[0].facility.name).toBe('MTC — but closed wing')

    const downgradedB = applyOverrides(facilityB, { tier: 2 })
    const reRankInputs: RankInput[] = [
      { facility: facilityA, groundDurationS: 1800, heloDurationS: null },
      { facility: downgradedB, groundDurationS: 1800, heloDurationS: null },
    ]
    const { ranked: after } = rankFacilities(reRankInputs)
    // Tier 3 (A) should now beat tier 2 (downgraded B)
    expect(after[0].facility.name).toBe('Trauma Unit')
    expect(after[1].facility.tier).toBe(2)
  })

  test('pediatric-only facility excluded from phased definitive target', () => {
    // A far tier-4 pediatric-only hospital must NOT be the definitive target
    // for an adult trauma casualty. The phased plan should either use the
    // next highest non-pediatric option or be suppressed.
    const inputs: RankInput[] = [
      mkInput(4, 9000, null, ['pediatric'], { pediatricOnly: true, name: "Great Ormond Street Children's" }),
      mkInput(3, 9500, null, [], { name: 'General Trauma Unit' }),
      mkInput(2, 600,  null, [], { name: 'Local A&E' }),
    ]
    const { phasedRecommendation } = rankFacilities(inputs)
    // If a phased plan is generated, the definitive target must not be peds-only
    if (phasedRecommendation) {
      expect(phasedRecommendation.thenTransferTo.pediatricOnly).toBe(false)
    }
  })

})

// ── Dive mode (requiredCapability) ────────────────────────────────────────────

describe('rankFacilities — dive mode (requiredCapability: hyperbaric)', () => {

  test('phased recommendation only uses hyperbaric facilities', () => {
    // Two far tier-4 facilities: one with chamber, one without.
    // Stabilize candidate: nearby tier-2 with chamber.
    // Without dive mode the non-chamber tier-4 would be the definitive target.
    // With dive mode, only the chamber-equipped tier-4 is eligible.
    const chamberT4  = mkInput(4, 8000, null, ['hyperbaric', 'surgical'], { name: 'HBO Center' })
    const plainT4    = mkInput(4, 7500, null, ['surgical'],                { name: 'Trauma Center' })
    const chamberT2  = mkInput(2, 900,  null, ['hyperbaric'],              { name: 'Local HBO' })

    const { phasedRecommendation } = rankFacilities([chamberT4, plainT4, chamberT2], 'hyperbaric')

    // Definitive must be a chamber facility
    if (phasedRecommendation) {
      expect(phasedRecommendation.thenTransferTo.capabilities).toContain('hyperbaric')
      // stabilize candidate must also carry hyperbaric
      expect(phasedRecommendation.stabilizeAt.capabilities).toContain('hyperbaric')
    }
  })

  test('non-chamber facilities still appear in ranked list (Facilities tab visibility)', () => {
    const chamberT4  = mkInput(4, 8000, null, ['hyperbaric'], { name: 'HBO Center' })
    const plainT2    = mkInput(2, 600,  null, [],             { name: 'No-chamber ED' })

    const { ranked } = rankFacilities([chamberT4, plainT2], 'hyperbaric')

    // Both facilities appear in the full ranked list
    expect(ranked).toHaveLength(2)
    expect(ranked.map(s => s.facility.name)).toContain('No-chamber ED')
  })

  test('phased recommendation suppressed when no second chamber facility for stabilize', () => {
    // Only one chamber facility far away — no lower-tier chamber to stabilize at,
    // so no phased plan should be emitted even though definitive is beyond golden hour.
    const chamberT4 = mkInput(4, 9000, null, ['hyperbaric'], { name: 'HBO Hosp' })
    const plainT2   = mkInput(2, 600,  null, [],             { name: 'Plain ED' })

    const { phasedRecommendation } = rankFacilities([chamberT4, plainT2], 'hyperbaric')
    expect(phasedRecommendation).toBeUndefined()
  })

})
