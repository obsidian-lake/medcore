/**
 * Expanded Level-I facility finder.
 *
 * When no Level I (tier 4) facility appears in the normal search radius, this
 * module runs a wider fetch to locate the nearest one. The result drives the
 * Level-I guarantee echelon plan in App.tsx.
 *
 * Data source strategy (tried in order, stopping when a result is found):
 *  1. Bundled registry (`nearestLevelITraumaCenter`) — network-free, instant.
 *     Covers all ACS-verified US Level I centers + Landstuhl + Queen's Medical
 *     Center (Hawaii). This is the primary path; the network fetches below are
 *     fallbacks only.
 *  2. CONUS targets: HIFLD only. HIFLD is the authoritative US trauma center
 *     registry and its bounding-box ArcGIS query stays well within server limits
 *     at 500 km. Overpass is not called — a 500 km all-hospital+helipad Overpass
 *     query saturates public mirror memory and returns ok(0), an empty clean-200
 *     that is indistinguishable from "genuinely no hospitals".
 *  3. Non-CONUS targets: targeted Overpass query via fetchOverpassLevelIOnly,
 *     which fetches only hospitals with explicit Level-I indicators (trauma tags,
 *     healthcare:classification, healthcare:level, neurosurgery speciality). This
 *     is 10–100× smaller than a full hospital query at 500 km radius.
 *  4. Non-CONUS global anchor fallback — if both (1) and (3) find nothing (common
 *     for Europe, UK, Africa, Pacific where the 500 km registry cap misses
 *     Landstuhl and OSM lacks Level-I tags), pick the globally nearest registry
 *     Level I with no radius cap. This ensures:
 *       - Europe / UK / Africa → Landstuhl Regional Medical Center
 *       - Hawaii / Pacific     → The Queen's Medical Center, Honolulu
 *
 * Design constraints:
 *  - Re-uses mergeFacilities so all tier-promotion logic (knownMtc, HIFLD
 *    classifications, OSM heuristics) is applied identically to the main fetch.
 *  - Returns the single nearest Level I by geodesic distance from the target,
 *    with excludeFromPace already set to true so it drives the echelon plan
 *    without appearing in P/A/C/E slots.
 *  - Custom facilities and hyperbaric chambers are excluded — Level I must be a
 *    real hospital; SOST assets and chambers are never definitive-care targets.
 */

import type { LatLon } from '../../calc/geo'
import { inverse } from '../../calc/geo'
import { fetchOverpassLevelIOnly } from './overpass'
import { fetchHifld } from './hifld'
import { mergeFacilities, fromTraumaCenter } from './merge'
import type { FacilityRecord } from './merge'
import { nearestLevelITraumaCenter } from './traumaCenters'

/** Expanded search radius cap — will not exceed this even if the inner radius
 *  is already large. We go to 500 km; beyond this, onward logistics become a
 *  strategic rather than tactical planning question. */
export const EXPANDED_LEVELI_RADIUS_M = 500_000

/**
 * Search beyond the normal radius for the nearest Level I (tier 4, non-pediatric,
 * non-custom) facility.
 *
 * @param target        POI coordinate.
 * @param innerRadiusM  The radius already searched (used only as a floor for the
 *                      expanded radius; always at least EXPANDED_LEVELI_RADIUS_M).
 * @param isConusTarget Pass the result of isConus(target) so we choose the right
 *                      data source without re-importing isConus.
 * @returns The nearest Level I FacilityRecord with `excludeFromPace: true`, or
 *          null when none is found (CONUS only — non-CONUS always resolves to a
 *          global strategic anchor).
 */
export async function findNearestLevelIBeyondRadius(
  target:        LatLon,
  innerRadiusM:  number,
  isConusTarget: boolean,
): Promise<FacilityRecord | null> {
  const expandedRadius = Math.max(EXPANDED_LEVELI_RADIUS_M, innerRadiusM)

  // ── Step 1: Bundled registry (network-free, instant) ─────────────────────
  //
  // The registry covers all ACS-verified US Level I centers + Landstuhl +
  // Queen's (Hawaii). If a Level I is within the expanded radius, return it
  // immediately without any network call. Covers the vast majority of cases.
  const registryLevelI = nearestLevelITraumaCenter(target, expandedRadius)
  if (registryLevelI) {
    return { ...fromTraumaCenter(registryLevelI), excludeFromPace: true }
  }

  // ── Step 2 (non-CONUS): global strategic anchor before any network call ──
  //
  // For non-CONUS targets the curated registry always has the right answer:
  //   Europe / UK / Africa → Landstuhl Regional Medical Center
  //   Hawaii / Pacific     → The Queen's Medical Center, Honolulu
  // Check globally (no radius cap) before hitting the network. This avoids a
  // slow, rarely-productive Overpass query for European and African targets
  // where the 500 km cap in Step 1 missed Landstuhl (e.g. UK ~650 km away).
  if (!isConusTarget) {
    const globalAnchor = nearestLevelITraumaCenter(target, Infinity)
    if (globalAnchor) return { ...fromTraumaCenter(globalAnchor), excludeFromPace: true }
  }

  // ── Step 3: Network fallback (CONUS only, or exotic non-registry locations) ─
  let merged: FacilityRecord[]

  if (isConusTarget) {
    // HIFLD is the authoritative US trauma center registry. Its ArcGIS bounding-box
    // query is efficient at 500 km — no Overpass call needed for CONUS.
    const hifldFacilities = await fetchHifld(target, expandedRadius)
    merged = mergeFacilities([], hifldFacilities, [], [])
  } else {
    // Non-CONUS with no registry anchor (unusual): targeted Overpass query
    // restricted to hospitals with explicit Level-I indicators.
    const osmFacilities = await fetchOverpassLevelIOnly(target, expandedRadius)
    merged = mergeFacilities(osmFacilities, [], [], [])
  }

  const candidates = merged.filter(
    f => f.tier === 4 && !f.pediatricOnly && !f.isCustom,
  )
  if (candidates.length === 0) {
    return null
  }

  let nearest: FacilityRecord | null = null
  let nearestDistM = Infinity
  for (const f of candidates) {
    const { distM } = inverse(target, { lat: f.lat, lon: f.lon })
    if (distM < nearestDistM) {
      nearestDistM = distM
      nearest = f
    }
  }

  if (!nearest) return null

  return { ...nearest, excludeFromPace: true }
}
