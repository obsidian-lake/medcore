/**
 * OSM Overpass API — hospital and helipad fetching.
 *
 * Queries the public Overpass API for hospitals and helipads within a radius
 * of a target coordinate. Keyless; responses cached in localStorage for
 * offline reuse (TTL: 7 days).
 *
 * Returns raw OSM elements; callers use merge.ts to combine with HIFLD data
 * and custom facilities.
 */

import type { LatLon } from '../../calc/geo'
import {
  osmSpecialitiesToCaps,
  osmHeuristicTier,
  ukClassificationToTier,
  inferCapsFromName,
  inferCapsFromClassifiedTier,
  type CareTier,
  type CapabilityFlag,
} from '../careLevel'
import { matchesKnownMtc } from './knownMtc'

export interface OsmFacility {
  source: 'osm'
  osmId: number
  /** OSM element type — needed for Nominatim lookup (N<id> / W<id> / R<id>). */
  osmType?: 'node' | 'way' | 'relation'
  name: string
  lat: number
  lon: number
  phone: string
  address: string
  hasEmergency: boolean
  beds: number
  specialities: string[]
  /** Whether a helipad was found within HELIPAD_ASSOC_RADIUS_M of this facility. */
  hasHelipad: boolean
  capabilities: CapabilityFlag[]
  /** Subset of `capabilities` inferred from a formal designation (not keyword-matched in source data). */
  inferredCapabilities: CapabilityFlag[]
  tier: CareTier
  /** True for healthcare=hyperbaric elements — standalone recompression/hyperbaric units. */
  isChamber?: boolean
}

export interface OsmHelipad {
  osmId: number
  lat: number
  lon: number
}

// Global planet-wide Overpass mirrors, CORS-enabled for browser use.
// All three hold complete OSM data. overpass-api.de is the canonical instance but
// returns 504 under load; the others are community-run global mirrors.
//
// NOTE: do NOT add regional/national Overpass instances (e.g. overpass.osm.ch —
// Swiss only). A regional server returns HTTP 200 with 0 elements for areas outside
// its coverage, which is indistinguishable from a genuinely empty search area and
// silently masks the server failure.
//
// Mirrors are raced in parallel; OVERPASS_TIMEOUT_MS is the budget for the whole
// race (not per-mirror).
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
// Must exceed the server-side query timeout (35 s) so we don't abort before the
// server can reply. 45 s gives 10 s of network + queuing headroom.
const OVERPASS_TIMEOUT_MS = 45_000

const CACHE_PREFIX = 'medplanner-overpass-v2-'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000   // 7 days
const HELIPAD_ASSOC_RADIUS_M = 300              // associate helipad to hospital within this distance

interface CacheEntry {
  ts: number
  hospitals: OsmFacility[]
  helipads: OsmHelipad[]
}

function cacheKey(lat: number, lon: number, radiusM: number): string {
  // Round to 2 dp (~1 km) for cache hit tolerance
  return `${CACHE_PREFIX}${lat.toFixed(2)},${lon.toFixed(2)},${radiusM}`
}

function readCache(key: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry: CacheEntry = JSON.parse(raw)
    if (Date.now() - entry.ts > CACHE_TTL_MS) { localStorage.removeItem(key); return null }
    return entry
  } catch { return null }
}

function writeCache(key: string, entry: CacheEntry): void {
  try { localStorage.setItem(key, JSON.stringify(entry)) } catch { /* quota exceeded — ignore */ }
}

/** Haversine distance in metres between two lat/lon points. */
function haversineM(a: LatLon, b: LatLon): number {
  const R = 6371000
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLon = (b.lon - a.lon) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

/**
 * Build Overpass QL query for hospitals + helipads around a point.
 *
 * Relations are included so that large hospital campuses mapped as multipolygons
 * (e.g. Addenbrooke's, OSM relation 2048374) are fetched. `out center tags;` emits
 * a centroid for relations, which `parseElement` reads via `el.center?.lat/lon`.
 *
 * @internal exported for unit tests
 */
export function buildQuery(lat: number, lon: number, radiusM: number): string {
  const r = Math.round(radiusM)
  return `
[out:json][timeout:35];
(
  node["amenity"="hospital"](around:${r},${lat},${lon});
  way["amenity"="hospital"](around:${r},${lat},${lon});
  relation["amenity"="hospital"](around:${r},${lat},${lon});
  node["healthcare"="hospital"](around:${r},${lat},${lon});
  way["healthcare"="hospital"](around:${r},${lat},${lon});
  relation["healthcare"="hospital"](around:${r},${lat},${lon});
  node["healthcare"="hyperbaric"](around:${r},${lat},${lon});
  way["healthcare"="hyperbaric"](around:${r},${lat},${lon});
  node["aeroway"="helipad"](around:${r},${lat},${lon});
  way["aeroway"="helipad"](around:${r},${lat},${lon});
);
out center tags;
`.trim()
}

/**
 * Raw OSM element as returned by the Overpass API.
 * @internal exported for unit tests
 */
export interface RawElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

/** @internal exported for unit tests */
export function parseElement(el: RawElement): { hospital?: Omit<OsmFacility, 'hasHelipad'>; helipad?: OsmHelipad } {
  const tags = el.tags ?? {}
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (lat === undefined || lon === undefined) return {}

  const isHelipad    = tags['aeroway'] === 'helipad'
  const isHospital   = tags['amenity'] === 'hospital' || tags['healthcare'] === 'hospital'
  const isHyperbaric = tags['healthcare'] === 'hyperbaric'

  if (isHelipad) {
    return { helipad: { osmId: el.id, lat, lon } }
  }

  if (isHyperbaric) {
    const name    = tags['name'] ?? tags['official_name'] ?? 'Hyperbaric Chamber'
    const phone   = tags['phone'] ?? tags['contact:phone'] ?? tags['telephone'] ?? ''
    const addrParts = [
      tags['addr:housenumber'], tags['addr:street'],
      tags['addr:city'], tags['addr:postcode'],
    ].filter(Boolean)
    return {
      hospital: {
        source: 'osm', osmId: el.id, osmType: el.type,
        name, lat, lon, phone, address: addrParts.join(', '),
        hasEmergency: true,
        beds: 0, specialities: [],
        capabilities: ['hyperbaric'],
        inferredCapabilities: [],
        tier: 2,
        isChamber: true,
      },
    }
  }

  if (!isHospital) return {}

  const name         = tags['name'] ?? tags['official_name'] ?? 'Unknown Hospital'
  const phone        = tags['phone'] ?? tags['contact:phone'] ?? tags['telephone']
                    ?? tags['contact:mobile'] ?? tags['emergency:phone'] ?? ''
  const beds         = parseInt(tags['beds'] ?? tags['capacity:beds'] ?? '0', 10) || 0
  const hasEmergency = tags['emergency'] === 'yes'
  const specialStr   = tags['healthcare:speciality'] ?? tags['medical_system:speciality'] ?? ''
  const specialities = specialStr ? specialStr.split(/[;,]/).map(s => s.trim()).filter(Boolean) : []

  // Build address from OSM addr: tags
  const addrParts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:city'],
    tags['addr:postcode'],
    tags['addr:country'],
  ].filter(Boolean)
  const address = addrParts.join(', ')

  const heuristicTier = osmHeuristicTier({ hasEmergency, specialities, beds })

  // Classify care tier from explicit OSM trauma/level tags.
  // Takes the better of the heuristic tier and any formal designation.
  //
  // OSM tags checked (in priority order):
  //  1. `trauma` tag — UK MTC/TU designations AND international trauma_centre values
  //  2. `healthcare:classification` — alternate tag; also handles level_1/level_2 etc.
  //  3. `healthcare:level` — numeric or roman level (e.g. "1", "i", "level 1")
  //  4. Name contains "Major Trauma Centre" — common pattern in NHS records
  //  5. Specialities include "major trauma" — via healthcare:speciality tag
  //  6. Curated known-MTC registry — catches facilities whose OSM tags carry no
  //     trauma designation (e.g. Addenbrooke's, which is a relation with no trauma tag)
  const traumaTag = tags['trauma'] ?? tags['healthcare:classification'] ?? ''
  const levelTag  = tags['healthcare:level'] ?? ''
  let classifiedTier: CareTier | null = null
  if (traumaTag) {
    classifiedTier = ukClassificationToTier(traumaTag)
  } else if (levelTag) {
    classifiedTier = ukClassificationToTier(levelTag)
  } else if (/major trauma centre/i.test(name) || /\bMTC\b/.test(name)) {
    classifiedTier = 4
  } else if (specialities.some(s => s.toLowerCase().includes('major trauma'))) {
    classifiedTier = 4
  } else if (matchesKnownMtc(name, lat, lon)) {
    classifiedTier = 4
  }

  const tier = (classifiedTier !== null && classifiedTier > heuristicTier)
    ? classifiedTier
    : heuristicTier

  // Capability assembly:
  //  - documentedCaps: keyword-matched from source tags / name
  //  - tierInferred: derived from formal designation (classifiedTier only, never heuristic)
  //    Skipped for pediatric-named facilities — a children's MTC operates on children, not adults.
  const isPedName = /child|paediatric|pediatric/i.test(name)
  const documentedCaps = [...new Set([...osmSpecialitiesToCaps(specialStr), ...inferCapsFromName(name)])]
  const tierInferred = isPedName ? [] : inferCapsFromClassifiedTier(classifiedTier)
  const capabilities: CapabilityFlag[] = [...new Set([...documentedCaps, ...tierInferred])]
  // Track which caps came purely from the designation (not found in source text).
  const inferredCapabilities: CapabilityFlag[] = tierInferred.filter(c => !documentedCaps.includes(c))

  return {
    hospital: {
      source: 'osm',
      osmId: el.id,
      osmType: el.type,
      name,
      lat,
      lon,
      phone,
      address,
      hasEmergency,
      beds,
      specialities,
      capabilities,
      inferredCapabilities,
      tier,
    },
  }
}

export interface OverpassResult {
  hospitals: OsmFacility[]
  helipads: OsmHelipad[]
  /** Set when the full requested radius timed out and results were fetched at a smaller radius. */
  reducedRadiusM?: number
}

/**
 * Race all global Overpass mirrors simultaneously and return the first to respond with
 * non-empty elements.
 *
 * Outcome semantics:
 *  - A mirror returning non-empty elements → winner; cancel the rest.
 *  - A mirror returning HTTP 200 with 0 elements → recorded as `sawClean200` (the area
 *    may genuinely have no hospitals); keep waiting for a mirror with real data.
 *  - All mirrors fail (non-2xx / network / timeout) and no clean-200 was seen → throw
 *    with a clear message so `App.tsx` can surface it to the user.
 *  - All mirrors return clean-200 empty → return empty (genuinely empty area).
 *
 * Always emits a one-line summary via `console.info` showing each mirror's outcome so
 * that any 404, 504, or network error is immediately visible in DevTools — no silent
 * swallowing of individual mirror failures.
 */
async function fetchFromMirrors(encoded: string): Promise<{ elements: RawElement[] }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS)

  // Per-mirror outcome strings for the final summary log.
  const outcomes: Record<string, string> = {}
  // Set to true if any global mirror returned HTTP 200 with 0 elements.
  // (A regional server returning 0 is why we only list global mirrors above.)
  let sawClean200 = false

  const makeAttempt = (base: string) => {
    const host = new URL(base).hostname
    return fetch(`${base}?data=${encoded}`, { signal: controller.signal })
      .then(async resp => {
        if (!resp.ok) {
          outcomes[host] = `HTTP ${resp.status}`
          throw new Error(`Overpass HTTP ${resp.status} @ ${host}`)
        }
        const data = await resp.json() as { elements: RawElement[] }
        if (!data.elements.length) {
          outcomes[host] = 'ok(0)'
          sawClean200 = true
          // Treat as soft failure so Promise.any keeps waiting for a mirror with data.
          throw new Error(`${host} returned 0 elements`)
        }
        outcomes[host] = `ok(${data.elements.length})`
        return data
      })
      .catch(err => {
        const isAbort = err instanceof DOMException && err.name === 'AbortError'
        if (!outcomes[host]) {
          outcomes[host] = isAbort ? 'timeout' : 'network-err'
        }
        throw err
      })
  }

  try {
    return await Promise.any(OVERPASS_ENDPOINTS.map(makeAttempt))
  } catch {
    if (sawClean200) {
      // At least one global mirror responded cleanly — area is genuinely empty.
      return { elements: [] }
    }
    throw new Error(
      'All Overpass servers are unavailable. Try again shortly or reduce the search radius.',
    )
  } finally {
    clearTimeout(timeoutId)
    controller.abort()
    // Always log a one-line summary so any 404/504/network error is visible in DevTools.
    const summary = OVERPASS_ENDPOINTS
      .map(b => `${new URL(b).hostname}=${outcomes[new URL(b).hostname] ?? 'pending'}`)
      .join('  ')
    console.info('[overpass] mirrors:', summary)
  }
}

/** Parse raw Overpass elements into hospitals and helipads, associating helipads to nearby hospitals. */
function parseElements(elements: RawElement[]): { hospitals: OsmFacility[]; helipads: OsmHelipad[] } {
  const rawHospitals: Omit<OsmFacility, 'hasHelipad'>[] = []
  const helipads: OsmHelipad[] = []

  for (const el of elements) {
    const parsed = parseElement(el)
    if (parsed.hospital) rawHospitals.push(parsed.hospital)
    if (parsed.helipad) helipads.push(parsed.helipad)
  }

  const hospitals: OsmFacility[] = rawHospitals.map(h => {
    const nearHelipad = helipads.some(hp =>
      haversineM({ lat: h.lat, lon: h.lon }, { lat: hp.lat, lon: hp.lon }) <= HELIPAD_ASSOC_RADIUS_M
    )
    return { ...h, hasHelipad: nearHelipad }
  })

  return { hospitals, helipads }
}

/**
 * Fetch hospitals and helipads around a target from the OSM Overpass API.
 *
 * Tries multiple public mirrors in order so that a 504 on overpass-api.de does
 * not block the request. Caches results in localStorage. Pass `forceRefresh: true`
 * to bypass cache. On total network failure, returns the cached value if present.
 */
export async function fetchOverpass(
  target: LatLon,
  radiusM = 80_000,   // 80 km default; ORS will filter by reachability
  forceRefresh = false,
): Promise<OverpassResult> {
  const key = cacheKey(target.lat, target.lon, radiusM)

  if (!forceRefresh) {
    const cached = readCache(key)
    if (cached) return { hospitals: cached.hospitals, helipads: cached.helipads }
  }

  // Effective radius may be reduced if the full-radius query times out (see fallback below).
  let effectiveRadiusM = radiusM
  let data: { elements: RawElement[] }

  try {
    data = await fetchFromMirrors(encodeURIComponent(buildQuery(target.lat, target.lon, radiusM)))
  } catch (firstErr) {
    // First attempt failed — wait briefly and retry once. Transient 504s / mirror
    // overload often resolve within a few seconds.
    try {
      await new Promise(r => setTimeout(r, 3_000))
      data = await fetchFromMirrors(encodeURIComponent(buildQuery(target.lat, target.lon, radiusM)))
    } catch (err) {
      // Both attempts at full radius failed — check stale cache first.
      const stale = readCache(key)
      if (stale) {
        console.warn('[overpass] all endpoints failed (2 attempts), using stale cache:', err)
        return { hospitals: stale.hospitals, helipads: stale.helipads }
      }

      // Large-radius queries (>60 km) frequently exhaust Overpass server memory on cold
      // start. Fall back to 50 km: lighter query, almost always succeeds, and warms the
      // server so a subsequent full-radius reload usually works.
      if (radiusM > 60_000) {
        const fallbackR = 50_000
        const fallbackKey = cacheKey(target.lat, target.lon, fallbackR)
        const cachedFallback = readCache(fallbackKey)
        if (cachedFallback) {
          console.warn(`[overpass] ${radiusM}m failed — using cached ${fallbackR}m result`)
          return { hospitals: cachedFallback.hospitals, helipads: cachedFallback.helipads, reducedRadiusM: fallbackR }
        }
        try {
          data = await fetchFromMirrors(encodeURIComponent(buildQuery(target.lat, target.lon, fallbackR)))
          effectiveRadiusM = fallbackR
          console.warn(`[overpass] ${radiusM}m query failed — fell back to ${fallbackR}m`)
        } catch {
          throw err
        }
      } else {
        throw err
      }
    }
  }

  const { hospitals, helipads } = parseElements(data.elements)

  const entry: CacheEntry = { ts: Date.now(), hospitals, helipads }
  writeCache(cacheKey(target.lat, target.lon, effectiveRadiusM), entry)

  return {
    hospitals,
    helipads,
    ...(effectiveRadiusM < radiusM ? { reducedRadiusM: effectiveRadiusM } : {}),
  }
}

/**
 * Targeted Overpass query that fetches only hospitals with explicit Level-I
 * indicators (trauma tags, healthcare:classification, healthcare:level, or
 * neurosurgery speciality). Used by the expanded Level-I guarantee search.
 *
 * Key differences from fetchOverpass:
 *  - Query is tag-filtered (not all hospitals) — returns tens, not thousands, of
 *    elements even at 500 km radius, so it stays within Overpass memory limits.
 *  - No helipads or hyperbaric chambers included.
 *  - hasHelipad is always false on returned facilities (caller may enrich later).
 *  - Separate localStorage cache slot (prefix 'medplanner-overpass-l1-').
 *  - Errors are swallowed — returns [] on total failure so the caller can fall
 *    back to a warning rather than surfacing an unrecoverable error.
 */
export async function fetchOverpassLevelIOnly(
  target: LatLon,
  radiusM: number,
): Promise<OsmFacility[]> {
  const key = `medplanner-overpass-l1-${target.lat.toFixed(2)},${target.lon.toFixed(2)},${radiusM}`
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const entry: { ts: number; hospitals: OsmFacility[] } = JSON.parse(raw)
      if (Date.now() - entry.ts <= CACHE_TTL_MS) return entry.hospitals
      localStorage.removeItem(key)
    }
  } catch { /* ignore */ }

  const r = Math.round(radiusM)
  const { lat, lon } = target
  // Fetch only hospitals that carry an explicit Level-I indicator in their tags.
  // This is 10–100× smaller than a full hospital+helipad query at the same radius
  // and comfortably fits inside Overpass server memory limits at 500 km.
  const query = `
[out:json][timeout:25];
(
  node["amenity"="hospital"]["trauma"](around:${r},${lat},${lon});
  way["amenity"="hospital"]["trauma"](around:${r},${lat},${lon});
  node["amenity"="hospital"]["healthcare:classification"](around:${r},${lat},${lon});
  way["amenity"="hospital"]["healthcare:classification"](around:${r},${lat},${lon});
  node["amenity"="hospital"]["healthcare:level"](around:${r},${lat},${lon});
  way["amenity"="hospital"]["healthcare:level"](around:${r},${lat},${lon});
  node["amenity"="hospital"]["healthcare:speciality"~"neuro|major.trauma",i](around:${r},${lat},${lon});
  way["amenity"="hospital"]["healthcare:speciality"~"neuro|major.trauma",i](around:${r},${lat},${lon});
);
out center tags;
`.trim()

  const encoded = encodeURIComponent(query)
  let data: { elements: RawElement[] }
  try {
    data = await fetchFromMirrors(encoded)
  } catch {
    try {
      await new Promise(r => setTimeout(r, 3_000))
      data = await fetchFromMirrors(encoded)
    } catch {
      return []
    }
  }

  const hospitals: OsmFacility[] = []
  for (const el of data.elements) {
    const parsed = parseElement(el)
    if (parsed.hospital && !parsed.hospital.isChamber) {
      hospitals.push({ ...parsed.hospital, hasHelipad: false })
    }
  }

  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), hospitals }))
  } catch { /* quota */ }

  return hospitals
}
