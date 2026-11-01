/**
 * Tunable ranking/PACE parameters.
 *
 * Single source of truth for every constant that used to be hard-coded
 * separately in rank.ts and pace.ts (and duplicated between them — the
 * golden-hour window and the capability weight table each existed twice).
 * The medic can tune these from the Ranking Settings pop-up; everything
 * else that depends on care level/"tier" math stays fixed by design (see
 * the doc comment on `minPrimaryAlternateLevel` below).
 */

import type { CareTier } from './careLevel'

export interface CapWeights {
  neuro: number
  burns: number
  vascular: number
  cardiothoracic: number
  surgical: number
  /** Weight applied to any capability flag not listed above (e.g. pediatric, obstetric). */
  other: number
}

export interface RankingParams {
  /** Soft golden-hour boundary, in minutes. Never a hard cutoff — see transitScorePenalty(). */
  goldenHourMin: number
  /** Score contribution per care-level point (tier 0–4). Dominates the composite score by design. */
  levelWeight: number
  /** Bonus score added when effective transit is within the golden hour. */
  goldenHourBonus: number
  /** Max penalty applied at exactly the golden-hour boundary (linear from 0 up to this). */
  inWindowPenaltyMax: number
  /** Additional penalty per minute of transit beyond the golden hour. */
  lateMinutePenalty: number
  /** Score per capability flag, multiplied by that flag's weight below. */
  capabilityPoints: number
  /** Trauma-relevance weight per capability flag. */
  capWeights: CapWeights
  /**
   * The closest definitive-care (highest-level) facility's transit must be at
   * least this multiple of the nearest lower-level facility's transit to
   * trigger a stabilize-then-transfer recommendation.
   */
  stabilizeTransferRatio: number
  /**
   * Minimum care level eligible for the Primary/Alternate PACE slots before
   * falling back to any tier with a warning. Internal CareTier scale (0–4).
   * Default 2 = "Level III or better". This is the ONE PACE doctrine rule
   * that's user-tunable; the rest — a golden-hour Level I always becomes
   * Primary, Level I beyond the golden hour routes to the Echelons of Care
   * plan instead, and Non-Trauma Centers are never PACE-eligible — stay
   * fixed so the plan always matches published TCCC/PACE doctrine.
   */
  minPrimaryAlternateLevel: CareTier
}

export const DEFAULT_RANKING_PARAMS: RankingParams = {
  goldenHourMin: 60,
  levelWeight: 100,
  goldenHourBonus: 30,
  inWindowPenaltyMax: 10,
  lateMinutePenalty: 2.5,
  capabilityPoints: 8,
  capWeights: {
    neuro: 1.5,
    burns: 1.4,
    vascular: 1.3,
    cardiothoracic: 1.2,
    surgical: 1.1,
    other: 1.0,
  },
  stabilizeTransferRatio: 2.0,
  minPrimaryAlternateLevel: 2,
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, v))
}

function clampCapWeights(partial?: Partial<CapWeights>): CapWeights {
  const d = DEFAULT_RANKING_PARAMS.capWeights
  const p = partial ?? {}
  return {
    neuro:          clamp(p.neuro          ?? d.neuro,          0, 5),
    burns:          clamp(p.burns          ?? d.burns,          0, 5),
    vascular:       clamp(p.vascular       ?? d.vascular,       0, 5),
    cardiothoracic: clamp(p.cardiothoracic ?? d.cardiothoracic, 0, 5),
    surgical:       clamp(p.surgical       ?? d.surgical,       0, 5),
    other:          clamp(p.other          ?? d.other,          0, 5),
  }
}

/**
 * Merge a partial/legacy-shaped params object over the defaults and clamp
 * every field to a sane range, so a corrupt localStorage value or an old
 * saved shape can never produce nonsensical or hard-cutoff-like behavior.
 */
export function normalizeRankingParams(partial?: Partial<RankingParams> | null): RankingParams {
  const d = DEFAULT_RANKING_PARAMS
  const p = partial ?? {}
  return {
    goldenHourMin:        clamp(p.goldenHourMin        ?? d.goldenHourMin,        15, 180),
    levelWeight:          clamp(p.levelWeight          ?? d.levelWeight,          0, 500),
    goldenHourBonus:      clamp(p.goldenHourBonus      ?? d.goldenHourBonus,      0, 200),
    inWindowPenaltyMax:   clamp(p.inWindowPenaltyMax   ?? d.inWindowPenaltyMax,   0, 100),
    lateMinutePenalty:    clamp(p.lateMinutePenalty    ?? d.lateMinutePenalty,    0, 50),
    capabilityPoints:     clamp(p.capabilityPoints     ?? d.capabilityPoints,     0, 50),
    capWeights:           clampCapWeights(p.capWeights),
    stabilizeTransferRatio: clamp(p.stabilizeTransferRatio ?? d.stabilizeTransferRatio, 1.1, 5),
    minPrimaryAlternateLevel: clamp(
      p.minPrimaryAlternateLevel ?? d.minPrimaryAlternateLevel, 0, 4,
    ) as CareTier,
  }
}

export function isDefaultRankingParams(params: RankingParams): boolean {
  return JSON.stringify(normalizeRankingParams(params)) === JSON.stringify(DEFAULT_RANKING_PARAMS)
}
