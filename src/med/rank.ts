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
import { careLevelLabel } from './careLevel'

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

const TIER_WEIGHT = 100            // score contribution per tier point
const CAP_WEIGHT  = 8              // score per capability flag
const GOLDEN_HOUR_S = 3600         // 60 minutes (soft priority boundary)
const TRANSIT_BONUS = 30           // bonus score if within golden hour

/**
 * Golden-hour transit cost: returns a negative score penalty for transit time.
 *
 * Behaviour:
 *  - t ≤ 60 min: small linear penalty (1 point per 6 min → up to -10 at 60 min).
 *  - t > 60 min: steep additional penalty that grows with overage, discouraging
 *    long transits without eliminating far facilities.
 *
 * The TRANSIT_BONUS (+30) rewards facilities within the golden hour so they
 * outcompete same-tier far facilities by a meaningful margin.
 */
function transitScorePenalty(durationS: number): number {
  if (durationS <= GOLDEN_HOUR_S) {
    // Smooth linear cost: 0 at 0 min, -10 at 60 min
    return -(durationS / GOLDEN_HOUR_S) * 10
  }
  // Beyond 60 min: base -10 + steep overage penalty
  const overageMin = (durationS - GOLDEN_HOUR_S) / 60
  return -10 - overageMin * 2.5   // -10 at 60 min, -85 at ~90 min, -160 at 120 min
}

/**
 * Trauma-relevance weight for a capability flag.
 * Neurosurgery and burns are highest priority for penetrating trauma.
 */
function capWeight(cap: CapabilityFlag): number {
  switch (cap) {
    case 'neuro':          return 1.5
    case 'burns':          return 1.4
    case 'vascular':       return 1.3
    case 'cardiothoracic': return 1.2
    case 'surgical':       return 1.1
    default:               return 1.0
  }
}

function scoreFacility(record: FacilityRecord, transit: TransitInfo): number {
  const t = transit.effectiveDurationS
  const withinGH = t <= GOLDEN_HOUR_S

  const tierScore    = (record.tier as number) * TIER_WEIGHT
  const transitScore = transitScorePenalty(t)
  const bonusScore   = withinGH ? TRANSIT_BONUS : 0
  const capScore     = record.capabilities.reduce((acc, c) => acc + capWeight(c) * CAP_WEIGHT, 0)

  return tierScore + transitScore + bonusScore + capScore
}

// ── Stabilize-then-transfer detection ────────────────────────────────────────

/**
 * Threshold: the definitive-care transit must be ≥ this multiple of the
 * nearest lower-tier facility's transit to trigger a phased recommendation.
 */
const STABILIZE_TRANSFER_RATIO = 2.0
/**
 * Phased plans are only emitted when the closest definitive-care facility is
 * beyond the golden hour. If definitive care is within 60 min, go directly.
 */
const PHASE_MIN_TRANSIT_S = GOLDEN_HOUR_S

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
  if (closestDefinitive.transit.effectiveDurationS <= PHASE_MIN_TRANSIT_S) return undefined

  // Among lower-tier capable facilities, find the nearest (stabilization candidate)
  const lowerTierOptions = capable.filter(s =>
    (s.facility.tier as number) < highestTier
  )
  if (lowerTierOptions.length === 0) return undefined

  const nearestLower = lowerTierOptions.reduce((a, b) =>
    a.transit.effectiveDurationS < b.transit.effectiveDurationS ? a : b
  )

  // Only recommend phased approach if definitive care is significantly further
  const ratio = closestDefinitive.transit.effectiveDurationS / nearestLower.transit.effectiveDurationS
  if (ratio < STABILIZE_TRANSFER_RATIO) return undefined

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
 * @returns ranked list + optional phasedRecommendation
 */
export function rankFacilities(inputs: RankInput[], requiredCapability?: CapabilityFlag): RankResult {
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
      score: scoreFacility(inp.facility, transit),
      withinGoldenHour: effective <= GOLDEN_HOUR_S,
    }
  })

  // Sort descending by score
  const ranked = [...scored].sort((a, b) => b.score - a.score)

  let phasedRecommendation: PhasedRecommendation | undefined
  if (ranked.length >= 2) {
    phasedRecommendation = shouldPhasePlan(ranked, requiredCapability)
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
export function transitColorClass(s: number | null): string {
  if (s === null || s === Infinity) return 'dim'
  if (s <= GOLDEN_HOUR_S) return 'fast'
  if (s <= GOLDEN_HOUR_S * 2) return 'slow'
  return 'dim'
}

/**
 * Derive care level display label.
 * Delegates to careLevelLabel() — single source of truth for Level I–IV wording.
 */
export function tierDisplayLabel(tier: CareTier): string {
  return careLevelLabel(tier)
}
