/**
 * Echelons-of-care plan assembly.
 *
 * Pure module — no side effects. All transit numbers are passed in;
 * network calls stay in App.tsx.
 *
 * Two-phase flow:
 *  1. selectEchelonNodes() — identifies which facilities to use as
 *     stabilize and definitive nodes. Runs AFTER the Facility PACE plan is
 *     built (so the PACE Primary facility is known) but BEFORE the Leg-2
 *     network fetch so App.tsx knows what coordinates to query.
 *  2. buildEchelonPlan() — assembles the structured two-leg plan once
 *     Leg-2 transit has been computed by the caller.
 *
 * Standard echelon flow:
 *   POI —(organic lift)→ stabilizing facility (= PACE Primary)
 *       —(transfer asset)→ Level I definitive care
 *
 * The echelon plan is the MACRO layer — it shows where the casualty
 * ultimately ends up for definitive care when the PACE facilities cannot
 * handle the injuries. It is built whenever the PACE Primary is not itself
 * a Level I trauma center (i.e., the PACE plan does not lead with Level I).
 *
 * Special cases:
 *  - Operational + SOST present: SOST supersedes PACE Primary as stabilize node.
 *  - Training Leg 2: rendered as "Civilian EMS / hospital transfer" handoff.
 *  - Transfer air leg requires helipads at both endpoints; falls back to ground.
 *
 * This module is pure — no side effects. Keep it unit-testable.
 */

import type { FacilityRecord } from './facilities/merge'
import type { FacilityScore, TransitInfo } from './rank'
import type { CapabilityFlag } from './careLevel'
import { formatTransit } from './rank'

// ── Types ──────────────────────────────────────────────────────────────────────

export type LegRole = 'evac-to-stabilize' | 'stabilize-to-definitive'

export interface EchelonLeg {
  role: LegRole
  from: { kind: 'poi' | 'facility'; facility?: FacilityRecord; label: string }
  to: FacilityRecord
  /** Transport mode for this leg. */
  mode: 'ground' | 'rotary' | 'fixed-wing'
  /** Human-readable asset name, e.g. "UH-60 (organic)" or "Civilian EMS / hospital". */
  assetLabel: string
  transit: TransitInfo
  /** Optional caveats or sub-notes (rendered as ↳ lines). */
  notes?: string[]
}

/**
 * Selected stabilize + definitive facility pair — output of selectEchelonNodes().
 * Used by App.tsx to drive the Leg-2 network fetch before buildEchelonPlan().
 */
export interface EchelonNodes {
  stabilizeAt:       FacilityRecord
  stabilizeTransit:  TransitInfo
  definitive:        FacilityRecord
  definitiveTransit: TransitInfo
  /** True when stabilizeAt is a SOST-type custom facility. */
  stabilizeIsSost: boolean
}

export interface EchelonPlan {
  legs: [EchelonLeg, EchelonLeg]
  stabilizeAt: FacilityRecord
  definitive:  FacilityRecord
  environment: 'training' | 'operational'
}

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Leg-2 distance thresholds (straight-line geodesic, metres).
 *
 * ≥ LEG2_DROP_GROUND_DIST_M — ground transport is not listed (road evac impractical).
 * ≥ LEG2_FIXED_WING_DIST_M  — a C-130 fixed-wing time is added alongside rotary/ground.
 *
 * These thresholds only apply in operational mode.  Training Leg 2 is a civilian
 * EMS handoff and is not subject to these rules.
 */
export const LEG2_DROP_GROUND_DIST_M = 100_000   // 100 km
export const LEG2_FIXED_WING_DIST_M  = 300_000   // 300 km

// ── selectEchelonNodes ─────────────────────────────────────────────────────────

/**
 * Identify the stabilize and definitive nodes for an echelon plan.
 *
 * Returns null when no echelon plan is needed — i.e., the PACE Primary is
 * already a Level I trauma center (direct definitive care is the plan),
 * no Level I exists anywhere in the ranked set, or there is no valid stabilize
 * node (pacePrimary is undefined and no SOST is available).
 *
 * Definitive node: nearest non-pediatric, non-custom Level I (tier 4) facility
 * from the ranked list. When `requiredCapability` is set (dive mode), the
 * definitive must also carry that capability.
 *
 * Stabilize node selection:
 *  - Operational + SOST (tier ≥ 3 custom facility with helipad): SOST wins.
 *  - Otherwise: the PACE Primary facility passed in as `pacePrimary`.
 *
 * Custom facilities (SOST etc.) are always stabilize candidates, never definitive
 * targets — they are forward-deployed surgical assets, not destination hospitals.
 */
export function selectEchelonNodes(
  ranked:              FacilityScore[],
  pacePrimary:         FacilityScore | undefined,
  environment:         'training' | 'operational',
  requiredCapability?: CapabilityFlag,
): EchelonNodes | null {
  if (ranked.length < 2) return null

  const hasCap = (s: FacilityScore) =>
    !requiredCapability || s.facility.capabilities.includes(requiredCapability)

  // Gate: if the PACE Primary is already a Level I, no echelon plan is needed —
  // the PACE plan is already directing to definitive care.
  const pacePrimaryIsLevelI =
    !!pacePrimary &&
    (pacePrimary.facility.tier as number) === 4 &&
    !pacePrimary.facility.pediatricOnly &&
    !pacePrimary.facility.isCustom &&
    hasCap(pacePrimary)
  if (pacePrimaryIsLevelI) return null

  // Definitive pool: non-pediatric, non-custom Level I (tier 4) facilities.
  const definitivePool = ranked.filter(s =>
    (s.facility.tier as number) === 4 &&
    !s.facility.pediatricOnly &&
    !s.facility.isCustom &&
    hasCap(s)
  )
  if (definitivePool.length === 0) return null

  const closestDefinitive = definitivePool.reduce((a, b) =>
    a.transit.effectiveDurationS <= b.transit.effectiveDurationS ? a : b
  )

  // Operational: check for SOST-type custom facilities (tier ≥ 3, hasHelipad).
  // SOST supersedes PACE Primary as the stabilize node when present.
  let sostScore: FacilityScore | undefined
  if (environment === 'operational') {
    const sostPool = ranked.filter(s =>
      s.facility.isCustom &&
      (s.facility.tier as number) >= 3 &&
      s.facility.hasHelipad &&
      hasCap(s)
    )
    if (sostPool.length > 0) {
      sostScore = sostPool.reduce((a, b) =>
        a.transit.effectiveDurationS <= b.transit.effectiveDurationS ? a : b
      )
    }
  }

  // Stabilize node: SOST (operational) or the PACE Primary facility.
  const stabilizeScore: FacilityScore | undefined = sostScore ?? pacePrimary
  if (!stabilizeScore) return null

  // Degenerate: stabilize and definitive are the same facility — bail out.
  if (stabilizeScore.facility.id === closestDefinitive.facility.id) return null

  return {
    stabilizeAt:       stabilizeScore.facility,
    stabilizeTransit:  stabilizeScore.transit,
    definitive:        closestDefinitive.facility,
    definitiveTransit: closestDefinitive.transit,
    stabilizeIsSost:   !!sostScore,
  }
}

// ── buildEchelonPlan ───────────────────────────────────────────────────────────

export interface BuildEchelonPlanOpts {
  nodes:               EchelonNodes
  /** Pre-computed inter-facility (stabilize → definitive) transit. */
  leg2Transit:         TransitInfo
  environment:         'training' | 'operational'
  /** Label for the organic lift asset (e.g. "UH-60 Black Hawk"). */
  organicAssetLabel:   string
  /** Label for the secondary transfer asset. Ignored in training (civilian handoff). */
  transferAssetLabel:  string
}

/**
 * Assemble the structured two-leg echelon plan.
 *
 * Leg 1 (evac-to-stabilize): POI → stabilizing facility via organic lift.
 * Leg 2 (stabilize-to-definitive): stabilizing facility → definitive care via
 *   transfer asset (operational) or civilian EMS handoff (training).
 */
export function buildEchelonPlan(opts: BuildEchelonPlanOpts): EchelonPlan {
  const { nodes, leg2Transit, environment, organicAssetLabel, transferAssetLabel } = opts

  // Leg 1: organic lift.
  // Use rotary mode when the stabilize facility has a helipad and a helo transit
  // was computed for it; otherwise fall back to ground.
  const leg1Mode: 'ground' | 'rotary' =
    nodes.stabilizeAt.hasHelipad && nodes.stabilizeTransit.heloDurationS !== null
      ? 'rotary' : 'ground'

  const leg1: EchelonLeg = {
    role: 'evac-to-stabilize',
    from: { kind: 'poi', label: 'POI' },
    to:   nodes.stabilizeAt,
    mode: leg1Mode,
    assetLabel: organicAssetLabel || 'Organic lift',
    transit: nodes.stabilizeTransit,
    // Team cedes control at the stabilize node — note lives here (Leg-1 endpoint).
    notes: environment === 'training' ? ['Team cedes control at stabilizing facility'] : undefined,
  }

  // Leg 2: transfer to definitive care.
  let leg2: EchelonLeg

  if (environment === 'training') {
    // Training: civilian EMS handoff; team has already ceded control at Leg-1 endpoint.
    leg2 = {
      role: 'stabilize-to-definitive',
      from: { kind: 'facility', facility: nodes.stabilizeAt, label: nodes.stabilizeAt.name },
      to:   nodes.definitive,
      mode: 'ground',
      assetLabel: 'Civilian EMS / hospital transfer',
      transit: leg2Transit,
    }
  } else {
    // Operational: determine mode and notes from the transit flags set by App.tsx.
    // fixedWingDurationS is set when Leg-2 geodesic distance ≥ LEG2_FIXED_WING_DIST_M.
    // groundDurationS is null when distance ≥ LEG2_DROP_GROUND_DIST_M (route not fetched).
    const canFly = nodes.stabilizeAt.hasHelipad && nodes.definitive.hasHelipad
    const hasFW  = leg2Transit.fixedWingDurationS != null
    const hasGnd = leg2Transit.groundDurationS != null

    // Mode priority: rotary (organic) > fixed-wing (C-130) > ground.
    const mode: 'ground' | 'rotary' | 'fixed-wing' =
      canFly ? 'rotary' : hasFW ? 'fixed-wing' : 'ground'

    const assetLabel =
      mode === 'fixed-wing'
        ? 'C-130 (fixed-wing)'
        : transferAssetLabel || organicAssetLabel || 'Transfer asset'

    const notes: string[] = []
    if (hasFW) {
      notes.push('Airfield must be located and coordinated for fixed-wing (C-130) transport')
    }
    if (!canFly && !hasFW && hasGnd) {
      notes.push('No helipad at one endpoint — ground transfer')
    }
    if (!canFly && !hasFW && !hasGnd) {
      notes.push('Long-haul transfer — no organic rotary or ground option; coordinate dedicated air asset')
    }

    leg2 = {
      role: 'stabilize-to-definitive',
      from: { kind: 'facility', facility: nodes.stabilizeAt, label: nodes.stabilizeAt.name },
      to:   nodes.definitive,
      mode,
      assetLabel,
      transit: leg2Transit,
      notes: notes.length > 0 ? notes : undefined,
    }
  }

  return {
    legs: [leg1, leg2],
    stabilizeAt: nodes.stabilizeAt,
    definitive:  nodes.definitive,
    environment,
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Return the nearest Level I (tier 4) facility in the ranked list, or null if
 * none exists. Excludes pediatric-only and custom facilities (same exclusions
 * used by selectEchelonNodes's definitive pool).
 *
 * Used by the Level-I guarantee pass in App.tsx to detect whether a true
 * Level I is already present in the fetched data before attempting a wider
 * search.
 */
export function pickNearestLevelI(ranked: FacilityScore[]): FacilityScore | null {
  const pool = ranked.filter(
    s =>
      (s.facility.tier as number) === 4 &&
      !s.facility.pediatricOnly &&
      !s.facility.isCustom,
  )
  if (pool.length === 0) return null
  return pool.reduce((a, b) =>
    a.transit.effectiveDurationS <= b.transit.effectiveDurationS ? a : b,
  )
}

// ── Formatting ─────────────────────────────────────────────────────────────────

/**
 * One-line summary of an echelon plan, suitable for the `phasedNote` field
 * (embedded in PACE entries and rendered on the PPTX/slide).
 *
 * Example:
 *   "POI →[UH-60]→ District Hospital (25 min) →[Civilian EMS]→ Level I Trauma Center (1 hr 10 min)"
 */
export function formatEchelonSummary(plan: EchelonPlan): string {
  const [leg1, leg2] = plan.legs
  const t1 = formatTransit(leg1.transit.effectiveDurationS)
  const t2 = formatTransit(leg2.transit.effectiveDurationS)
  return `POI →[${leg1.assetLabel}]→ ${leg1.to.name} (${t1}) →[${leg2.assetLabel}]→ ${leg2.to.name} (${t2})`
}
