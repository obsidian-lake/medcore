/**
 * Nominatim address enrichment for OSM facilities that lack addr:* tags.
 *
 * Uses the Nominatim OSM Lookup API to batch-fetch structured address data for
 * hospitals where the Overpass query returned empty address fields. Nominatim
 * infers street/city/postcode from the surrounding road network even when the
 * OSM node or way has no explicit addr:* tags.
 *
 * Usage Policy: https://operations.osmfoundation.org/policies/nominatim/
 * Public API: max 1 request/second. We stay under this by batching up to 50
 * IDs per request and only fetching facilities with empty addresses.
 *
 * Results are cached in localStorage (30 days). Caching is skipped on network
 * error so the next fetch will retry; empty strings are cached for IDs Nominatim
 * has no data for, to avoid re-querying them.
 */

import type { OsmFacility } from './overpass'

const CACHE_PREFIX = 'medplanner-nominatim-'
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000   // 30 days
const BATCH_SIZE = 50
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/lookup'

interface NominatimAddr {
  road?: string
  house_number?: string
  suburb?: string
  neighbourhood?: string
  city?: string
  town?: string
  village?: string
  county?: string
  state?: string
  postcode?: string
  country?: string
}

interface NominatimItem {
  osm_type: string
  osm_id: number
  address?: NominatimAddr
}

interface CacheEntry { ts: number; address: string }

function cacheKey(osmId: number): string {
  return `${CACHE_PREFIX}${osmId}`
}

function readCache(osmId: number): string | null {
  try {
    const raw = localStorage.getItem(cacheKey(osmId))
    if (!raw) return null
    const e: CacheEntry = JSON.parse(raw)
    if (Date.now() - e.ts > CACHE_TTL_MS) { localStorage.removeItem(cacheKey(osmId)); return null }
    return e.address   // may be '' — Nominatim had no data
  } catch { return null }
}

function writeCache(osmId: number, address: string): void {
  try { localStorage.setItem(cacheKey(osmId), JSON.stringify({ ts: Date.now(), address })) } catch {}
}

function buildAddress(addr: NominatimAddr | undefined): string {
  if (!addr) return ''
  const parts: string[] = []
  if (addr.house_number && addr.road) parts.push(`${addr.house_number} ${addr.road}`)
  else if (addr.road) parts.push(addr.road)
  const city = addr.city ?? addr.town ?? addr.village ?? addr.county ?? ''
  if (city) parts.push(city)
  if (addr.state) parts.push(addr.state)
  if (addr.postcode) parts.push(addr.postcode)
  if (addr.country) parts.push(addr.country)
  return parts.join(', ')
}

/**
 * Enrich OSM facilities that lack address data via Nominatim OSM element lookup.
 *
 * Only queries facilities where `address === ''`. Results are cached per osmId.
 * Returns a Map<osmId, address> containing only non-empty addresses.
 */
export async function enrichOsmAddresses(
  facilities: OsmFacility[],
): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  const needsFetch: OsmFacility[] = []

  for (const fac of facilities) {
    if (fac.address) continue   // already has address from OSM tags — skip
    const cached = readCache(fac.osmId)
    if (cached !== null) {
      if (cached) result.set(fac.osmId, cached)
      // empty string cached → Nominatim has no data, don't re-query
    } else {
      needsFetch.push(fac)
    }
  }

  for (let i = 0; i < needsFetch.length; i += BATCH_SIZE) {
    const batch = needsFetch.slice(i, i + BATCH_SIZE)

    // osmType is optional (old cache entries won't have it).
    // Default to 'way' — most large hospitals in OSM are mapped as way areas.
    // Relations (multipolygon campuses) use the 'R' Nominatim prefix.
    const osmIds = batch
      .map(f => {
        const t = f.osmType ?? 'way'
        const prefix = t === 'relation' ? 'R' : t === 'node' ? 'N' : 'W'
        return `${prefix}${f.osmId}`
      })
      .join(',')

    try {
      const url = `${NOMINATIM_URL}?osm_ids=${encodeURIComponent(osmIds)}&format=json&addressdetails=1`
      const resp = await fetch(url, {
        headers: {
          'Accept-Language': 'en',
          'User-Agent': 'medplanner-pipehittertools/1.0 (codeword.actual@erine.eu)',
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (!resp.ok) throw new Error(`Nominatim HTTP ${resp.status}`)
      const items = await resp.json() as NominatimItem[]

      const fetched = new Map<number, string>()
      for (const item of items) {
        fetched.set(item.osm_id, buildAddress(item.address))
      }

      // Write cache for all items in batch (including empty = not found in Nominatim)
      for (const fac of batch) {
        const addr = fetched.get(fac.osmId) ?? ''
        writeCache(fac.osmId, addr)
        if (addr) result.set(fac.osmId, addr)
      }
    } catch (err) {
      console.warn('[nominatim] address enrichment failed — will retry next fetch:', err)
      // Do NOT write cache on network error so we retry next time
    }

    // Rate limit: 1 req/s between batches (only relevant when > 50 facilities)
    if (i + BATCH_SIZE < needsFetch.length) {
      await new Promise(r => setTimeout(r, 1100))
    }
  }

  return result
}
