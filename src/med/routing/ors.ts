/**
 * OpenRouteService (ORS) routing — ground transit times, route polylines,
 * and 60-minute isochrones for the medplanner PACE algorithm.
 *
 * API key: VITE_ORS_API_KEY (set in .env or .env.local).
 * Free tier allows 500 req/day; results cached aggressively in localStorage.
 *
 * Helo routes are point-to-point geodesic (no road network) and computed
 * inline using geo.ts — no ORS call required.
 *
 * Fallback: if ORS is unavailable (no key, rate-limited, offline), transit
 * time is estimated from straight-line distance ÷ assumed average road speed
 * and a warning is attached.
 */

import type { LatLon } from '../../calc/geo'
import { inverse } from '../../calc/geo'

const ORS_BASE = 'https://api.openrouteservice.org'

/**
 * Resolve the active ORS API key at call time.
 * Priority: runtime key saved in localStorage → build-time env var → undefined.
 * The runtime key lets medics paste a key in-app without touching .env files.
 */
function getApiKey(): string | undefined {
  // Runtime override: stored by TargetScreen ORS key field
  try {
    const runtimeKey = localStorage.getItem('medplanner-ors-key')
    if (runtimeKey) return runtimeKey
  } catch { /* localStorage unavailable */ }
  return import.meta.env.VITE_ORS_API_KEY as string | undefined
}

const CACHE_PREFIX = 'medplanner-ors-'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000   // 24 hours

// Assumed average road speed (km/h) for straight-line fallback estimate.
// Conservative — typically much slower than crow-flies due to roads.
const FALLBACK_ROAD_SPEED_KPH = 60

export interface RouteResult {
  /** Ground transit time in seconds. */
  durationS: number
  /** Distance in metres. */
  distanceM: number
  /** GeoJSON LineString coordinates [lon, lat]. */
  polyline: [number, number][]
  /** True if this is an estimated result (ORS unavailable). */
  estimated: boolean
  warning?: string
}

export interface IsochroneResult {
  /** GeoJSON polygon of 60-min reachable area. */
  geometry: GeoJSON.Polygon
}

// ── Cache helpers ──────────────────────────────────────────────────────────────

function routeCacheKey(from: LatLon, to: LatLon): string {
  // Round to 4 dp (~11 m) to allow minimal cache tolerance
  return `${CACHE_PREFIX}route-${from.lat.toFixed(4)},${from.lon.toFixed(4)}-${to.lat.toFixed(4)},${to.lon.toFixed(4)}`
}

function isoCacheKey(origin: LatLon): string {
  return `${CACHE_PREFIX}iso-${origin.lat.toFixed(3)},${origin.lon.toFixed(3)}`
}

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { ts, data } = JSON.parse(raw) as { ts: number; data: T }
    if (Date.now() - ts > CACHE_TTL_MS) { localStorage.removeItem(key); return null }
    return data
  } catch { return null }
}

function writeCache<T>(key: string, data: T): void {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })) } catch { /* quota */ }
}

// ── Encoded polyline decoder ───────────────────────────────────────────────────

// ORS Directions (non-/geojson endpoint) returns geometry as a Google-encoded
// polyline string. Decode it to [lon, lat] pairs matching the GeoJSON convention
// used everywhere else in the app.
function decodePolyline(encoded: string): [number, number][] {
  const result: [number, number][] = []
  let index = 0
  let lat = 0
  let lon = 0
  while (index < encoded.length) {
    let shift = 0, delta = 0, b: number
    do { b = encoded.charCodeAt(index++) - 63; delta |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += (delta & 1) ? ~(delta >> 1) : delta >> 1
    shift = 0; delta = 0
    do { b = encoded.charCodeAt(index++) - 63; delta |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lon += (delta & 1) ? ~(delta >> 1) : delta >> 1
    result.push([lon / 1e5, lat / 1e5])
  }
  return result
}

// ── ORS failure signal ─────────────────────────────────────────────────────────
//
// Tracks the most recent ORS degradation cause so App.tsx can surface it as a
// visible PACE warning instead of silently falling back to straight-line estimates.
// Intentionally a plain module variable (no React state) — it spans multiple
// async calls within a single runFetch invocation.

export type OrsFailureReason =
  | { kind: 'no-key' }
  | { kind: 'auth';      status: number }   // 401 / 403
  | { kind: 'rate-limit' }                  // 429
  | { kind: 'server';    status: number }   // 5xx / other 4xx
  | { kind: 'network' }                     // CORS / fetch threw

let _lastOrsFailure: OrsFailureReason | null = null

/** Clear before each runFetch pass so stale signals don't persist. */
export function resetOrsFailure(): void { _lastOrsFailure = null }

/** Return the most severe ORS failure seen since last reset, or null if ORS is healthy. */
export function getOrsFailure(): OrsFailureReason | null { return _lastOrsFailure }

function recordOrsFailure(reason: OrsFailureReason): void {
  // Keep the most actionable signal: no-key < network < server < rate-limit < auth
  const rank = (r: OrsFailureReason) =>
    r.kind === 'auth' ? 4 : r.kind === 'rate-limit' ? 3 : r.kind === 'server' ? 2 : r.kind === 'network' ? 1 : 0
  if (!_lastOrsFailure || rank(reason) > rank(_lastOrsFailure)) _lastOrsFailure = reason
}

// ── Fallback estimator ─────────────────────────────────────────────────────────

function straightLineEstimate(from: LatLon, to: LatLon): RouteResult {
  const { distM } = inverse(from, to)
  // Straight-line time at fallback speed — always slower in reality
  const durationS = Math.round((distM / 1000) / FALLBACK_ROAD_SPEED_KPH * 3600)
  return {
    durationS,
    distanceM: distM,
    polyline: [[from.lon, from.lat], [to.lon, to.lat]],
    estimated: true,
    warning: 'ORS unavailable — transit time is a straight-line estimate',
  }
}

// ── ORS Directions ─────────────────────────────────────────────────────────────

/**
 * Get ground route from origin → destination.
 * Returns cached result if available; falls back to straight-line estimate
 * if ORS is unavailable.
 */
export async function getGroundRoute(from: LatLon, to: LatLon): Promise<RouteResult> {
  const key = routeCacheKey(from, to)
  const cached = readCache<RouteResult>(key)
  if (cached) return cached

  const apiKey = getApiKey()
  if (!apiKey) {
    console.warn('[ors] No ORS API key configured — using straight-line estimate')
    recordOrsFailure({ kind: 'no-key' })
    return straightLineEstimate(from, to)
  }

  try {
    const resp = await fetch(`${ORS_BASE}/v2/directions/driving-car`, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        coordinates: [[from.lon, from.lat], [to.lon, to.lat]],
        radiuses: [-1, -1],   // unlimited snapping radius — avoids code-2010 "no routable point" 404s
        instructions: false,
        geometry_simplify: true,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      if (resp.status === 401 || resp.status === 403) recordOrsFailure({ kind: 'auth', status: resp.status })
      else if (resp.status === 429)                   recordOrsFailure({ kind: 'rate-limit' })
      else                                             recordOrsFailure({ kind: 'server', status: resp.status })
      throw new Error(`ORS Directions HTTP ${resp.status} — ${body}`)
    }

    const json = await resp.json() as {
      routes: [{
        summary: { duration: number; distance: number }
        geometry: string
      }]
    }

    const route = json.routes[0]
    const result: RouteResult = {
      durationS: Math.round(route.summary.duration),
      distanceM: Math.round(route.summary.distance),
      polyline: decodePolyline(route.geometry),
      estimated: false,
    }

    writeCache(key, result)
    return result

  } catch (err) {
    console.warn('[ors] Directions failed — using straight-line estimate:', err)
    // Only record network failure if not already recorded as auth/rate-limit above
    recordOrsFailure({ kind: 'network' })
    return straightLineEstimate(from, to)
  }
}

/**
 * Batch route requests using ORS Matrix API.
 * Returns duration in seconds for each destination; [-1] on per-leg failure.
 * More efficient than individual /directions calls for many facilities.
 */
export async function getRouteMatrix(
  origin: LatLon,
  destinations: LatLon[],
): Promise<number[]> {
  if (destinations.length === 0) return []
  const apiKey = getApiKey()
  if (!apiKey) {
    recordOrsFailure({ kind: 'no-key' })
    return destinations.map(d => {
      const { distM } = inverse(origin, d)
      return Math.round((distM / 1000) / FALLBACK_ROAD_SPEED_KPH * 3600)
    })
  }

  const coords = [[origin.lon, origin.lat], ...destinations.map(d => [d.lon, d.lat])]
  const sources = [0]
  const dests   = destinations.map((_, i) => i + 1)

  try {
    const resp = await fetch(`${ORS_BASE}/v2/matrix/driving-car`, {
      method: 'POST',
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: coords, sources, destinations: dests, metrics: ['duration'] }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) recordOrsFailure({ kind: 'auth', status: resp.status })
      else if (resp.status === 429)                   recordOrsFailure({ kind: 'rate-limit' })
      else                                             recordOrsFailure({ kind: 'server', status: resp.status })
      throw new Error(`ORS Matrix HTTP ${resp.status}`)
    }
    const json = await resp.json() as { durations: number[][] }
    return (json.durations[0] ?? []).map((d, i) => {
      if (d != null) return Math.round(d)
      // ORS couldn't snap this destination to the road network — straight-line estimate.
      const { distM } = inverse(origin, destinations[i])
      return Math.round((distM / 1000) / FALLBACK_ROAD_SPEED_KPH * 3600)
    })
  } catch (err) {
    console.warn('[ors] Matrix failed — falling back to estimates:', err)
    recordOrsFailure({ kind: 'network' })
    return destinations.map(d => {
      const { distM } = inverse(origin, d)
      return Math.round((distM / 1000) / FALLBACK_ROAD_SPEED_KPH * 3600)
    })
  }
}

// ── ORS Isochrones ─────────────────────────────────────────────────────────────

/**
 * Get the 60-minute driving isochrone around the origin.
 * Returns null if ORS is unavailable or the call fails.
 * Cached for 24 hours.
 */
export async function getIsochrone60min(origin: LatLon): Promise<IsochroneResult | null> {
  const key = isoCacheKey(origin)
  const cached = readCache<IsochroneResult>(key)
  if (cached) return cached

  const apiKey = getApiKey()
  if (!apiKey) return null

  try {
    const resp = await fetch(`${ORS_BASE}/v2/isochrones/driving-car`, {
      method: 'POST',
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: [[origin.lon, origin.lat]],
        range: [3600],   // 60 minutes in seconds
        range_type: 'time',
        smoothing: 25,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!resp.ok) throw new Error(`ORS Isochrone HTTP ${resp.status}`)
    const json = await resp.json() as { features: [{ geometry: GeoJSON.Polygon }] }
    const result: IsochroneResult = { geometry: json.features[0].geometry }
    writeCache(key, result)
    return result
  } catch (err) {
    console.warn('[ors] Isochrone failed:', err)
    return null
  }
}

// ── Helo transit ───────────────────────────────────────────────────────────────

/** Default helicopter cruise speed (knots). Editable in app state. */
export const DEFAULT_HELO_SPEED_KT = 130

/** C-130 Hercules cruise speed (knots) — used for fixed-wing Leg-2 estimates on long hauls. */
export const FIXED_WING_SPEED_KT = 290

/** A rotary-wing airframe entry for the asset-type dropdown. */
export interface Airframe {
  id: string
  label: string
  /** Approximate cruise speed in knots; 0 = custom (keep current speed). */
  speedKt: number
}

/** Joint/SOF airframe roster with approximate cruise speeds. All speeds are overridable. */
export const AIRFRAMES: Airframe[] = [
  { id: 'uh60',   label: 'UH-60 Black Hawk',   speedKt: 130 },
  { id: 'hh60',   label: 'HH-60 Pave Hawk',    speedKt: 130 },
  { id: 'ch47',   label: 'CH-47 Chinook',       speedKt: 140 },
  { id: 'ch46',   label: 'CH-46 Sea Knight',    speedKt: 120 },
  { id: 'ch53',   label: 'CH-53',               speedKt: 150 },
  { id: 'mh6',    label: 'MH-6 Little Bird',    speedKt: 120 },
  { id: 'uh1',    label: 'UH-1 Huey',           speedKt: 110 },
  { id: 'ah64',   label: 'AH-64 Apache',        speedKt: 145 },
  { id: 'cv22',   label: 'CV-22 / MV-22 Osprey', speedKt: 240 },
  { id: 'hems',   label: 'HEMS / AW139',        speedKt: 150 },
  { id: 'custom', label: 'Custom / Other',       speedKt: 0   },
]

/**
 * Compute helo transit time in seconds from origin to destination.
 * Point-to-point geodesic; speed in knots.
 */
export function heloTransitS(from: LatLon, to: LatLon, speedKt = DEFAULT_HELO_SPEED_KT): number {
  const { distM } = inverse(from, to)
  const distNm = distM / 1852  // metres → nautical miles
  return Math.round((distNm / speedKt) * 3600)
}
