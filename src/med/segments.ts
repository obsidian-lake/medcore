/**
 * Multi-segment / phased infil-exfil med plan support.
 *
 * For long-range operations with geographically separated phases, the medic
 * can define multiple "segments" (named areas along the route/infil/exfil).
 * Each segment has its own target coordinates and produces an independent
 * facility PACE and imagery.
 *
 * v1 implementation: N independent segments, each reusing the single-area
 * pipeline (fetch → rank → PACE). Segments do NOT share routing cache —
 * each segment makes its own ORS calls (cached per-coord-pair).
 */

import type { LatLon } from '../calc/geo'
import type { FacilityRecord } from './facilities/merge'
import type { FacilityPace, TreatmentPace } from './pace'
import type { RankResult } from './rank'

export interface MedSegment {
  id: string
  /** Label shown in UI and on the slide (e.g. "OBJ ALPHA", "Phase 2 — Exfil"). */
  label: string
  /** Target/area coordinates for this phase. */
  target: LatLon
  /** Search radius in metres (default 80 km). */
  searchRadiusM: number
}

export interface SegmentPlan {
  segment: MedSegment
  /** Merged facility list for this segment. */
  facilities: FacilityRecord[]
  /** Ranking result. */
  rankResult: RankResult
  /** Facility PACE (may have override applied). */
  facilityPace: FacilityPace
  /** Treatment PACE (shared config, per-segment for local emergency number). */
  treatmentPace: TreatmentPace
}

/** Default segment for a single-area mission (most common case). */
export function defaultSegment(target: LatLon): MedSegment {
  return {
    id: `seg-${Date.now()}`,
    label: 'OBJ / MSN Area',
    target,
    searchRadiusM: 80_000,
  }
}
