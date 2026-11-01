/**
 * Unit tests for ranking-parameter normalization/defaults.
 *
 * Tests:
 *  - normalizeRankingParams() with no argument reproduces the defaults
 *  - partial objects are merged over the defaults, not replacing them wholesale
 *  - out-of-range values are clamped rather than accepted verbatim
 *  - isDefaultRankingParams() correctly distinguishes default from tuned params
 */

import { DEFAULT_RANKING_PARAMS, normalizeRankingParams, isDefaultRankingParams } from './rankingParams'

describe('normalizeRankingParams', () => {

  test('no argument returns the defaults', () => {
    expect(normalizeRankingParams()).toEqual(DEFAULT_RANKING_PARAMS)
    expect(normalizeRankingParams(null)).toEqual(DEFAULT_RANKING_PARAMS)
  })

  test('partial top-level object merges over defaults (old saved shape)', () => {
    const result = normalizeRankingParams({ goldenHourMin: 45 })
    expect(result.goldenHourMin).toBe(45)
    expect(result.levelWeight).toBe(DEFAULT_RANKING_PARAMS.levelWeight)
    expect(result.stabilizeTransferRatio).toBe(DEFAULT_RANKING_PARAMS.stabilizeTransferRatio)
  })

  test('partial capWeights object merges per-field over the default cap weights', () => {
    const result = normalizeRankingParams({ capWeights: { neuro: 3 } as any })
    expect(result.capWeights.neuro).toBe(3)
    expect(result.capWeights.burns).toBe(DEFAULT_RANKING_PARAMS.capWeights.burns)
    expect(result.capWeights.other).toBe(DEFAULT_RANKING_PARAMS.capWeights.other)
  })

  test('out-of-range goldenHourMin is clamped to [15, 180]', () => {
    expect(normalizeRankingParams({ goldenHourMin: 5 }).goldenHourMin).toBe(15)
    expect(normalizeRankingParams({ goldenHourMin: 500 }).goldenHourMin).toBe(180)
  })

  test('out-of-range stabilizeTransferRatio is clamped to [1.1, 5]', () => {
    expect(normalizeRankingParams({ stabilizeTransferRatio: 0 }).stabilizeTransferRatio).toBe(1.1)
    expect(normalizeRankingParams({ stabilizeTransferRatio: 99 }).stabilizeTransferRatio).toBe(5)
  })

  test('out-of-range minPrimaryAlternateLevel is clamped to the CareTier range [0, 4]', () => {
    expect(normalizeRankingParams({ minPrimaryAlternateLevel: -1 as any }).minPrimaryAlternateLevel).toBe(0)
    expect(normalizeRankingParams({ minPrimaryAlternateLevel: 9 as any }).minPrimaryAlternateLevel).toBe(4)
  })

  test('negative weights are clamped to 0, never a hard cutoff below zero', () => {
    expect(normalizeRankingParams({ levelWeight: -50 }).levelWeight).toBe(0)
    expect(normalizeRankingParams({ lateMinutePenalty: -10 }).lateMinutePenalty).toBe(0)
  })

  test('a non-finite value falls back to the clamp minimum rather than propagating NaN', () => {
    expect(normalizeRankingParams({ goldenHourMin: NaN }).goldenHourMin).toBe(15)
  })
})

describe('isDefaultRankingParams', () => {

  test('true for the defaults object itself', () => {
    expect(isDefaultRankingParams(DEFAULT_RANKING_PARAMS)).toBe(true)
  })

  test('true for a freshly normalized empty partial', () => {
    expect(isDefaultRankingParams(normalizeRankingParams())).toBe(true)
  })

  test('false once any field has been tuned away from default', () => {
    expect(isDefaultRankingParams(normalizeRankingParams({ goldenHourMin: 45 }))).toBe(false)
    expect(isDefaultRankingParams(normalizeRankingParams({ minPrimaryAlternateLevel: 4 }))).toBe(false)
  })
})
