/**
 * Facility merge + deduplication.
 *
 * Combines OSM Overpass results, HIFLD enrichment, and custom facilities
 * (e.g. SOST) into a single canonical FacilityRecord list.
 *
 * Merge rules:
 *  1. Custom facilities always win — they are never overridden.
 *  2. HIFLD enriches/replaces OSM hospital data when both refer to the same
 *     real-world hospital (matched by proximity + name similarity).
 *  3. Remaining OSM-only hospitals are included as-is.
 *
 * Deduplication uses a combined name-similarity + proximity test:
 *  - Within DEDUP_RADIUS_M metres AND name Jaro-Winkler similarity > DEDUP_NAME_THRESHOLD
 *    → treat as the same facility; keep the higher-quality record.
 */

import type { LatLon } from '../../calc/geo'
import type { OsmFacility } from './overpass'
import type { HifldFacility } from './hifld'
import type { CustomFacility } from '../../types/customFacility'
import type { CareTier, CapabilityFlag } from '../careLevel'
import { isPediatricOnly, usTraumaLevelToTier, inferCapsFromClassifiedTier } from '../careLevel'
import type { HyperbaricChamber } from './hyperbaricChambers'
import type { TraumaCenter } from './traumaCenters'

export interface FacilityRecord {
  /**
   * Stable id — survives re-fetches.
   * Format: 'osm-<osmId>' | 'hifld-<objectId>' | 'custom-<timestamp>'
   */
  id: string
  name: string
  lat: number
  lon: number
  phone: string
  address: string
  beds: number
  hasHelipad: boolean
  hasEmergency: boolean
  tier: CareTier
  capabilities: CapabilityFlag[]
  /**
   * Subset of `capabilities` inferred from a formal designation (e.g. US trauma level,
   * UK MTC classification) rather than keyword-matched in source text.
   * UI renders these with a dashed badge so the medic knows they're derived, not documented.
   */
  inferredCapabilities: CapabilityFlag[]
  /**
   * True when the facility is a children's/paediatric-only hospital with no
   * general trauma surgery capability. Such facilities are excluded from all
   * PACE slots for adult TCCC casualties.
   */
  pediatricOnly: boolean
  /** Source of truth for this record. */
  source: 'custom' | 'hifld' | 'osm' | 'chamber' | 'registry'
  /** HIFLD trauma level (if available). */
  traumaLevel?: number | null
  /** Whether this is a deployed custom facility (e.g. SOST). */
  isCustom: boolean
  /**
   * True when this record originates from the curated hyperbaric chamber registry
   * (not a hospital that *has* a chamber — those are normal FacilityRecords with
   * 'hyperbaric' in their capabilities). Used to exclude standalone chambers from
   * the hospital PACE plan (poolMode:'trauma') and to render the CHAMBER badge.
   */
  isChamber?: boolean
  /** Medic notes for this facility (displayed on PACE screen, not on slide). */
  notes?: string
  /** When true, the medic has flagged this facility as unsuitable for the PACE plan. */
  excludeFromPace?: boolean
  /** Any field the medic has manually overridden. */
  overrides?: Partial<FacilityRecord>
}

const DEDUP_RADIUS_M = 200        // same building if within 200 m
const DEDUP_NAME_THRESHOLD = 0.82  // Jaro-Winkler threshold

/** Haversine distance in metres. */
function distM(a: LatLon, b: LatLon): number {
  const R = 6371000
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLon = (b.lon - a.lon) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

/** Simplified Jaro similarity (sufficient for name dedup). */
function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const a = s1.toLowerCase(), b = s2.toLowerCase()
  const matchDist = Math.floor(Math.max(a.length, b.length) / 2) - 1
  const aMatched = new Array(a.length).fill(false)
  const bMatched = new Array(b.length).fill(false)
  let matches = 0, transpositions = 0
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDist)
    const end   = Math.min(i + matchDist + 1, b.length)
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue
      aMatched[i] = bMatched[j] = true
      matches++; break
    }
  }
  if (matches === 0) return 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue
    while (!bMatched[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  return (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3
}

function namesSimilar(n1: string, n2: string): boolean {
  return jaro(n1, n2) >= DEDUP_NAME_THRESHOLD
}

/** Convert an OsmFacility to FacilityRecord. */
function fromOsm(o: OsmFacility): FacilityRecord {
  return {
    // Stable ID: survives re-fetches so medic overrides persist across sessions
    id: `osm-${o.osmId}`,
    name: o.name,
    lat: o.lat,
    lon: o.lon,
    phone: o.phone,
    address: o.address,
    beds: o.beds,
    hasHelipad: o.hasHelipad,
    hasEmergency: o.hasEmergency,
    tier: o.tier,
    capabilities: o.capabilities,
    inferredCapabilities: o.inferredCapabilities,
    pediatricOnly: isPediatricOnly(o.name, o.capabilities),
    source: 'osm',
    isCustom: false,
    ...(o.isChamber ? { isChamber: true } : {}),
  }
}

/** Convert a HifldFacility to FacilityRecord. */
function fromHifld(h: HifldFacility): FacilityRecord {
  return {
    // Stable ID: survives re-fetches so medic overrides persist across sessions
    id: `hifld-${h.hifldId}`,
    name: h.name,
    lat: h.lat,
    lon: h.lon,
    phone: h.phone,
    address: h.address,
    beds: h.beds,
    hasHelipad: h.hasHelipad,
    hasEmergency: h.hasEmergency,
    tier: h.tier,
    capabilities: h.capabilities,
    inferredCapabilities: h.inferredCapabilities,
    pediatricOnly: isPediatricOnly(h.name, h.capabilities),
    source: 'hifld',
    traumaLevel: h.traumaLevel,
    isCustom: false,
  }
}

/** Convert a CustomFacility to FacilityRecord. */
function fromCustom(c: CustomFacility): FacilityRecord {
  return {
    id: c.id,
    name: c.name,
    lat: c.lat,
    lon: c.lon,
    phone: c.phone,
    address: c.address,
    beds: c.beds,
    hasHelipad: c.hasHelipad,
    hasEmergency: true,    // custom facilities (SOST etc.) always assumed to have ER
    tier: c.tier,
    capabilities: c.capabilities,
    inferredCapabilities: [],   // medic-entered caps are confirmed by definition
    // Custom facilities are medic-defined — assume they're appropriate for the patient
    pediatricOnly: false,
    source: 'custom',
    isCustom: true,
  }
}

/** Slugify a chamber name to a stable, URL-safe id component. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Convert a HyperbaricChamber registry entry to a standalone FacilityRecord. */
function fromChamber(c: HyperbaricChamber): FacilityRecord {
  const notes = [c.availability, c.notes].filter(Boolean).join(' — ') || undefined
  return {
    id: `chamber-${slugify(c.name)}`,
    name: c.name,
    lat: c.lat,
    lon: c.lon,
    phone: c.phone ?? '',
    address: c.address ?? '',
    beds: 0,
    hasHelipad: false,
    hasEmergency: true,   // recompression chambers accept dive emergencies by definition
    // Tier 2 (basic/intermediate): avoids the "Level IV basic care" warning in trauma PACE
    // without falsely claiming Level III+ surgical capability. The dive-mode Chamber PACE
    // skips the tier eligibility gate entirely, so this only affects hospital-PACE ranking.
    tier: 2,
    capabilities: ['hyperbaric'],
    inferredCapabilities: [],
    pediatricOnly: false,
    source: 'chamber',
    isCustom: false,
    isChamber: true,
    notes,
  }
}

/**
 * Deduplicate a list of OSM facilities by proximity + name similarity.
 * When two entries refer to the same physical hospital (e.g. main building
 * and a department node both tagged amenity=hospital), keep the one with
 * more data (higher tier, emergency, helipad, more capabilities).
 */
function deduplicateOsm(facilities: OsmFacility[]): OsmFacility[] {
  const kept: OsmFacility[] = []
  const suppressed = new Set<number>()

  for (let i = 0; i < facilities.length; i++) {
    if (suppressed.has(i)) continue
    let best = facilities[i]
    for (let j = i + 1; j < facilities.length; j++) {
      if (suppressed.has(j)) continue
      const other = facilities[j]
      const dist = distM({ lat: best.lat, lon: best.lon }, { lat: other.lat, lon: other.lon })
      if (dist <= DEDUP_RADIUS_M && namesSimilar(best.name, other.name)) {
        suppressed.add(j)
        const bestScore  = best.tier  * 10 + (best.hasEmergency  ? 4 : 0) + (best.hasHelipad  ? 2 : 0) + best.capabilities.length
        const otherScore = other.tier * 10 + (other.hasEmergency ? 4 : 0) + (other.hasHelipad ? 2 : 0) + other.capabilities.length
        if (otherScore > bestScore) best = other
      }
    }
    kept.push(best)
  }
  return kept
}

/**
 * Match radius for co-locating registry trauma centers with already-merged
 * hospital records. Wider than DEDUP_RADIUS_M (200 m) because curated
 * coordinates may be the main entrance or campus centroid rather than the
 * building centroid used by OSM/HIFLD — hospital campuses can span 1–2 km.
 */
const TRAUMA_MATCH_RADIUS_M = 2_000

/**
 * Name-similarity threshold for trauma-center co-location.
 * Lower than the dedup threshold (0.82) to catch hospital renames and
 * official/colloquial name differences (e.g. "Harris Health Ben Taub" vs
 * "Ben Taub General Hospital").
 */
const TRAUMA_MATCH_NAME_THRESHOLD = 0.65

/** Convert a curated TraumaCenter registry entry to a standalone FacilityRecord. */
export function fromTraumaCenter(tc: TraumaCenter): FacilityRecord {
  const tier = usTraumaLevelToTier(tc.level) as CareTier
  const inferred = inferCapsFromClassifiedTier(tier)
  return {
    id: `registry-${slugify(tc.name)}`,
    name: tc.name,
    lat: tc.lat,
    lon: tc.lon,
    phone: tc.phone ?? '',
    address: tc.address ?? '',
    beds: 0,
    hasHelipad: tc.hasHelipad ?? true,
    hasEmergency: true,
    tier,
    capabilities: [...inferred],
    inferredCapabilities: [...inferred],
    pediatricOnly: false,
    source: 'registry',
    traumaLevel: tc.level,
    isCustom: false,
    notes: tc.notes,
  }
}

/**
 * Merge OSM hospitals, HIFLD hospitals, custom facilities, and curated hyperbaric
 * chambers into a deduplicated FacilityRecord list.
 *
 * Custom facilities are added without deduplication.
 * OSM + HIFLD are matched by proximity + name; HIFLD wins when matched.
 *
 * Chamber injection logic (applied after OSM/HIFLD merge):
 *  - If a registry chamber is within DEDUP_RADIUS_M of an already-merged hospital
 *    AND names are similar, 'hyperbaric' is added to that hospital's capabilities
 *    (no new record — the hospital has a chamber). isChamber stays unset.
 *  - Otherwise, a standalone `fromChamber` record (isChamber: true) is appended.
 */
export function mergeFacilities(
  osmFacilities: OsmFacility[],
  hifldFacilities: HifldFacility[],
  customFacilities: CustomFacility[],
  chambers: readonly HyperbaricChamber[] = [],
  traumaCenters: readonly TraumaCenter[] = [],
): FacilityRecord[] {
  const result: FacilityRecord[] = []

  // 0. Deduplicate OSM list before cross-source matching — removes department
  //    nodes that duplicate the main hospital way entry.
  const dedupedOsm = deduplicateOsm(osmFacilities)

  // 1. Track which HIFLD facilities have been paired with an OSM one
  const hifldUsed = new Set<number>()

  for (const osm of dedupedOsm) {
    let matched: HifldFacility | null = null
    for (let i = 0; i < hifldFacilities.length; i++) {
      const h = hifldFacilities[i]
      if (hifldUsed.has(i)) continue
      const dist = distM({ lat: osm.lat, lon: osm.lon }, { lat: h.lat, lon: h.lon })
      if (dist <= DEDUP_RADIUS_M && namesSimilar(osm.name, h.name)) {
        matched = h
        hifldUsed.add(i)
        break
      }
    }
    if (matched) {
      result.push(fromHifld(matched))
    } else {
      result.push(fromOsm(osm))
    }
  }

  // 2. Add unmatched HIFLD facilities (within target area but no OSM counterpart)
  for (let i = 0; i < hifldFacilities.length; i++) {
    if (!hifldUsed.has(i)) result.push(fromHifld(hifldFacilities[i]))
  }

  // 3. Inject curated hyperbaric chambers.
  //    For each chamber, check if an already-merged hospital is co-located (same
  //    building). If so, enrich that hospital's capabilities; otherwise add a
  //    standalone chamber record.
  for (const chamber of chambers) {
    const chamberCoord: LatLon = { lat: chamber.lat, lon: chamber.lon }
    const matchIdx = result.findIndex(r =>
      distM({ lat: r.lat, lon: r.lon }, chamberCoord) <= DEDUP_RADIUS_M &&
      namesSimilar(r.name, chamber.name),
    )
    if (matchIdx >= 0) {
      // Hospital already in list — just ensure 'hyperbaric' capability is present
      const existing = result[matchIdx]
      if (!existing.capabilities.includes('hyperbaric')) {
        result[matchIdx] = {
          ...existing,
          capabilities: [...existing.capabilities, 'hyperbaric'],
        }
      }
    } else {
      result.push(fromChamber(chamber))
    }
  }

  // 4. Inject curated trauma centers (ACS-verified Level I/II registry).
  //
  //    For each registry entry, search for a co-located already-merged hospital
  //    (within TRAUMA_MATCH_RADIUS_M AND sufficient name similarity). When found:
  //      - Promote `tier` to the registry tier if the registry tier is higher
  //        (fixes the common case where HIFLD TRAUMA field is null → tier 2/3
  //        for a real Level I/II center).
  //      - Merge in inferred capabilities from the formal ACS designation.
  //      - Set `traumaLevel` so downstream UI and rank logic see the formal level.
  //    When not found (center wasn't fetched — outside radius, offline, fetch
  //    failure), inject a standalone `'registry'` record so it still surfaces.
  //
  //    This step deliberately runs AFTER chambers so it never demotes a chamber.
  for (const tc of traumaCenters) {
    const tcCoord: LatLon = { lat: tc.lat, lon: tc.lon }
    const registryTier = usTraumaLevelToTier(tc.level) as CareTier
    const registryInferred = inferCapsFromClassifiedTier(registryTier)

    const matchIdx = result.findIndex(r => {
      if (r.isChamber) return false
      const d = distM({ lat: r.lat, lon: r.lon }, tcCoord)
      if (d > TRAUMA_MATCH_RADIUS_M) return false
      // Accept if Jaro similarity meets the (lower) name threshold.
      return jaro(r.name, tc.name) >= TRAUMA_MATCH_NAME_THRESHOLD
    })

    if (matchIdx >= 0) {
      const existing = result[matchIdx]
      // Only promote — never demote an already-correct higher tier.
      if (registryTier > existing.tier) {
        const mergedCaps: CapabilityFlag[] = [
          ...new Set([...existing.capabilities, ...registryInferred]),
        ]
        const mergedInferred: CapabilityFlag[] = [
          ...new Set([...existing.inferredCapabilities,
            ...registryInferred.filter(c => !existing.capabilities.includes(c))]),
        ]
        result[matchIdx] = {
          ...existing,
          tier: registryTier,
          traumaLevel: tc.level,
          capabilities: mergedCaps,
          inferredCapabilities: mergedInferred,
        }
      } else if (existing.traumaLevel == null) {
        // Tier already correct (or higher) but HIFLD left traumaLevel null —
        // backfill so the rank/export code sees the formal designation.
        result[matchIdx] = { ...existing, traumaLevel: tc.level }
      }
    } else {
      // Not fetched — inject a standalone registry record so the facility
      // surfaces even in offline use or when outside the OSM/HIFLD radius.
      result.push(fromTraumaCenter(tc))
    }
  }

  // 5. Custom facilities always prepended (will be highest-ranked if deserved)
  const customs = customFacilities.map(fromCustom)

  return [...customs, ...result]
}

/**
 * Apply medic overrides to a facility.
 * Returns a new record with override fields patched in.
 */
export function applyOverrides(
  facility: FacilityRecord,
  overrides: Partial<FacilityRecord>,
): FacilityRecord {
  return { ...facility, ...overrides, overrides }
}
