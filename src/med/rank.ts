/**
 * Facility ranking algorithm.
 *
 * Produces a scored, ordered list of facilities for the PACE plan builder.
 * Scoring is SOFT — no hard 1-hour cutoff. The algorithm encodes the intent
 * priority order:
 *
 *   1. Golden-hour weighting: transit cost rises steeply beyond 60 min but
 *      never excludes a facility entirely.
 *   2. Care tier: higher definitive tier strongly preferred (4 > 3 > 2 > 1).
 *   3. Capability breadth: count of exquisite-capability flags weighted for
 *      trauma relevance.
 *
 * Transit: uses the FASTEST of ground and helo (if facility has a helipad).
 *
 * Stabilize-then-transfer:
 *   When the top-ranked definitive-care facility is far away AND a lower-tier
 *   facility is significantly closer, emits a phasedRecommendation so the PACE
 *   builder can render "P: stabilize at X → transfer to Y (definitive)".
 *
 * This module is pure — no side effects. Keep it unit-testable.
 */

import type { FacilityRecord } from './facilities/merge'
import type { CareTier, CapabilityFlag } from './careLevel'
import { careLevelLabel, isNonTraumaCenter } from './careLevel'
import type { RankingParams } from './rankingParams'
import { DEFAULT_RANKING_PARAMS } from './rankingParams'

export interface TransitInfo {
  groundDurationS:    number | null   // null = not computed / unavailable
  heloDurationS:      number | null   // null = no helipad or not computed
  /** C-130 geodesic estimate; null/undefined = not applicable (short haul or training). */
  fixedWingDurationS?: number | null
  effectiveDurationS: number          // min(ground, helo) — used for scoring
}

export interface FacilityScore {
  facility: FacilityRecord
  transit: TransitInfo
  score: number                    // composite score (higher = better)
  /** Whether effective transit is within the soft golden-hour window. */
  withinGoldenHour: boolean
}

export interface PhasedRecommendation {
  /** Stabilize-first facility (closer, lower tier). */
  stabilizeAt: FacilityRecord
  stabilizeTransit: TransitInfo
  /** Definitive-care facility (further, higher tier). */
  thenTransferTo: FacilityRecord
  transferTransit: TransitInfo
}

export interface RankResult {
  ranked: FacilityScore[]
  /** Present when stabilize-then-transfer is the recommended approach. */
  phasedRecommendation?: PhasedRecommendation
}

// ── Scoring constants ──────────────────────────────────────────────────────────
//
// All tunable values now live in rankingParams.ts (DEFAULT_RANKING_PARAMS).
// Every function below takes a `params: RankingParams` argument (defaulting
// to DEFAULT_RANKING_PARAMS at the public rankFacilities() boundary).

/**
 * Golden-hour transit cost: returns a negative score penalty for transit time.
 *
 * Behaviour:
 *  - t ≤ goldenHour: small linear penalty (0 at 0 min, up to -inWindowPenaltyMax
 *    at the golden-hour boundary).
 *  - t > goldenHour: steep additional penalty that grows with overage, discouraging
 *    long transits without eliminating far facilities.
 *
 * The goldenHourBonus rewards facilities within the golden hour so they
 * outcompete same-tier far facilities by a meaningful margin.
 */
function transitScorePenalty(durationS: number, params: RankingParams): number {
  const goldenHourS = params.goldenHourMin * 60
  if (durationS <= goldenHourS) {
    // Smooth linear cost: 0 at 0 min, -inWindowPenaltyMax at the boundary
    return -(durationS / goldenHourS) * params.inWindowPenaltyMax
  }
  // Beyond the golden hour: base penalty + steep overage penalty
  const overageMin = (durationS - goldenHourS) / 60
  return -params.inWindowPenaltyMax - overageMin * params.lateMinutePenalty
}

/**
 * Trauma-relevance weight for a capability flag.
 * Neurosurgery and burns are highest priority for penetrating trauma.
 */
function capWeight(cap: CapabilityFlag, params: RankingParams): number {
  switch (cap) {
    case 'neuro':          return params.capWeights.neuro
    case 'burns':          return params.capWeights.burns
    case 'vascular':       return params.capWeights.vascular
    case 'cardiothoracic': return params.capWeights.cardiothoracic
    case 'surgical':       return params.capWeights.surgical
    default:               return params.capWeights.other
  }
}

export function scoreFacility(record: FacilityRecord, transit: TransitInfo, params: RankingParams): number {
  const t = transit.effectiveDurationS
  const goldenHourS = params.goldenHourMin * 60
  const withinGH = t <= goldenHourS

  const tierScore    = (record.tier as number) * params.levelWeight
  const transitScore = transitScorePenalty(t, params)
  const bonusScore   = withinGH ? params.goldenHourBonus : 0
  const capScore     = record.capabilities.reduce((acc, c) => acc + capWeight(c, params) * params.capabilityPoints, 0)

  return tierScore + transitScore + bonusScore + capScore
}

// ── Stabilize-then-transfer detection ────────────────────────────────────────

/**
 * Determines whether a stabilize-then-transfer approach should be recommended.
 *
 * Rather than keying off the top-scored facility, this looks at the
 * HIGHEST-TIER facility available (the definitive care target). If that
 * facility is far away AND a lower-tier facility is significantly closer,
 * emit a phased recommendation so the PACE plan can render:
 *   "P: stabilize at X → transfer to Y (definitive)"
 *
 * When `requiredCapability` is set (e.g. 'hyperbaric' in dive mode), only
 * facilities that carry that capability are considered for either leg.
 */
function shouldPhasePlan(
  allScored: FacilityScore[],
  params: RankingParams,
  requiredCapability?: CapabilityFlag,
): PhasedRecommendation | undefined {
  if (allScored.length < 2) return undefined

  const hasCap = (s: FacilityScore) =>
    !requiredCapability || s.facility.capabilities.includes(requiredCapability)

  // Identify the highest tier present in the set (among capable facilities only)
  const capable = allScored.filter(hasCap)
  if (capable.length < 2) return undefined
  const highestTier = Math.max(...capable.map(s => s.facility.tier as number))

  // Among highest-tier facilities, find the one with the shortest transit.
  // Exclude pediatric-only facilities — they are not appropriate definitive
  // destinations for adult trauma casualties.
  const definitiveOptions = capable.filter(s =>
    (s.facility.tier as number) === highestTier && !s.facility.pediatricOnly
  )
  // If all highest-tier options are pediatric-only, no valid definitive target
  // exists at this tier — don't emit a phased plan.
  if (definitiveOptions.length === 0) return undefined
  const closestDefinitive = definitiveOptions.reduce((a, b) =>
    a.transit.effectiveDurationS < b.transit.effectiveDurationS ? a : b
  )

  // If definitive care is within golden hour, go directly — no staging needed
  const goldenHourS = params.goldenHourMin * 60
  if (closestDefinitive.transit.effectiveDurationS <= goldenHourS) return undefined

  // Among lower-tier capable facilities, find the nearest (stabilization candidate).
  // Excludes NTC (no 24/7 ED) — a stabilize leg must land at a trauma-capable facility.
  const lowerTierOptions = capable.filter(s =>
    (s.facility.tier as number) < highestTier &&
    !isNonTraumaCenter(s.facility.tier)
  )
  if (lowerTierOptions.length === 0) return undefined

  const nearestLower = lowerTierOptions.reduce((a, b) =>
    a.transit.effectiveDurationS < b.transit.effectiveDurationS ? a : b
  )

  // Only recommend phased approach if definitive care is significantly further
  const ratio = closestDefinitive.transit.effectiveDurationS / nearestLower.transit.effectiveDurationS
  if (ratio < params.stabilizeTransferRatio) return undefined

  return {
    stabilizeAt: nearestLower.facility,
    stabilizeTransit: nearestLower.transit,
    thenTransferTo: closestDefinitive.facility,
    transferTransit: closestDefinitive.transit,
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface RankInput {
  facility: FacilityRecord
  groundDurationS: number | null
  heloDurationS:   number | null
}

/**
 * Rank facilities and detect phased plan opportunities.
 *
 * @param inputs - facilities with their pre-computed transit times
 * @param requiredCapability - when set (e.g. 'hyperbaric' for dive mode), only
 *   facilities with this capability are considered for the phased recommendation.
 *   All facilities still appear in the ranked list so the Facilities tab can
 *   show them; the constraint is enforced only in the plan builders.
 * @param params - tunable scoring/doctrine parameters (see rankingParams.ts).
 *   Defaults to DEFAULT_RANKING_PARAMS, reproducing the historical behaviour.
 * @returns ranked list + optional phasedRecommendation
 */
export function rankFacilities(
  inputs: RankInput[],
  requiredCapability?: CapabilityFlag,
  params: RankingParams = DEFAULT_RANKING_PARAMS,
): RankResult {
  const goldenHourS = params.goldenHourMin * 60
  const scored: FacilityScore[] = inputs.map(inp => {
    const ground = inp.groundDurationS
    const helo   = inp.heloDurationS
    // Effective transit: minimum of available modes
    const modes: number[] = []
    if (ground !== null) modes.push(ground)
    if (helo   !== null) modes.push(helo)
    const effective = modes.length > 0 ? Math.min(...modes) : Infinity

    const transit: TransitInfo = {
      groundDurationS: ground,
      heloDurationS: helo,
      effectiveDurationS: effective,
    }

    return {
      facility: inp.facility,
      transit,
      score: scoreFacility(inp.facility, transit, params),
      withinGoldenHour: effective <= goldenHourS,
    }
  })

  // Sort descending by score
  const ranked = [...scored].sort((a, b) => b.score - a.score)

  let phasedRecommendation: PhasedRecommendation | undefined
  if (ranked.length >= 2) {
    phasedRecommendation = shouldPhasePlan(ranked, params, requiredCapability)
  }

  return { ranked, phasedRecommendation }
}

/** Format transit duration in seconds to human-readable string. */
export function formatTransit(s: number | null): string {
  if (s === null || s < 0) return 'N/A'
  if (s === Infinity) return '—'
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`
}

/** Return a CSS colour variable name based on transit urgency. */
export function transitColorClass(s: number | null, goldenHourS: number = DEFAULT_RANKING_PARAMS.goldenHourMin * 60): string {
  if (s === null || s === Infinity) return 'dim'
  if (s <= goldenHourS) return 'fast'
  if (s <= goldenHourS * 2) return 'slow'
  return 'dim'
}

/**
 * Hex-colour equivalent of transitColorClass(), for surfaces that render
 * directly to a colour (DOM inline styles, PPTX cell fills) rather than CSS classes.
 */
export function transitColorHex(s: number | null, goldenHourS: number = DEFAULT_RANKING_PARAMS.goldenHourMin * 60): string {
  return s !== null && s <= goldenHourS ? '#4caf50' : '#ffcc02'
}

/**
 * Derive care level display label.
 * Delegates to careLevelLabel() — single source of truth for Level I–IV wording.
 */
export function tierDisplayLabel(tier: CareTier): string {
  return careLevelLabel(tier)
}
