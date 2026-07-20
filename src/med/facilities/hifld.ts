/**
 * HIFLD (Homeland Infrastructure Foundation-Level Data) hospital enrichment.
 *
 * Uses the HIFLD "Hospitals" open dataset to enrich OSM facilities when the
 * target is within CONUS (contiguous United States). The dataset is fetched
 * on-demand from the HIFLD ArcGIS Feature Service (public, no key) and cached
 * in localStorage for offline use.
 *
 * Bounding box: CONUS roughly -125°W to -66°W, 24°N to 49°N.
 * If the target falls outside this box, this module is a no-op.
 *
 * HIFLD fields used:
 *   NAME, ADDRESS, CITY, STATE, ZIP, TELEPHONE, BEDS, HELIPAD,
 *   TRAUMA (trauma designation string or level number),
 *   TYPE (service line CSV), EMERGENCY, LATITUDE, LONGITUDE
 *
 * Data source:
 *   https://hifld-geoplatform.hub.arcgis.com/datasets/hospitals
 *   Licensed under HIFLD Open Data — attribution required in production.
 */

import type { LatLon } from '../../calc/geo'
import {
  usTraumaLevelToTier,
  hifldServiceLinesToCaps,
  inferCapsFromName,
  inferCapsFromTraumaLevel,
  osmHeuristicTier,
  type CareTier,
  type CapabilityFlag,
} from '../careLevel'

export interface HifldFacility {
  source: 'hifld'
  hifldId: string
  name: string
  lat: number
  lon: number
  phone: string
  address: string
  city: string
  state: string
  zip: string
  beds: number
  hasHelipad: boolean
  hasEmergency: boolean
  traumaLevel: number | null   // 1–5 (US ACS numbering), null = undesignated
  capabilities: CapabilityFlag[]
  /** Subset of `capabilities` inferred from a formal designation (not keyword-matched in source data). */
  inferredCapabilities: CapabilityFlag[]
  tier: CareTier
}

// CONUS bounding box (rough)
const CONUS_BBOX = { minLat: 24, maxLat: 49, minLon: -125, maxLon: -66 }

export function isConus(ll: LatLon): boolean {
  return ll.lat >= CONUS_BBOX.minLat && ll.lat <= CONUS_BBOX.maxLat &&
    ll.lon >= CONUS_BBOX.minLon && ll.lon <= CONUS_BBOX.maxLon
}

const CACHE_KEY_PREFIX = 'medplanner-hifld-'
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000   // 30 days

// HIFLD public Feature Service URL (GeoJSON output format)
// Filtered server-side by bounding box to keep payload manageable.
const HIFLD_BASE_URL =
  'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Hospitals_1/FeatureServer/0/query'

interface HifldAttr {
  OBJECTID: number
  NAME?: string | null
  ADDRESS?: string | null
  CITY?: string | null
  STATE?: string | null
  ZIP?: string | null
  TELEPHONE?: string | null
  BEDS?: number | null
  HELIPAD?: string | null
  TRAUMA?: string | null
  TYPE?: string | null
  EMERGENCY?: string | null
  LATITUDE?: number | null
  LONGITUDE?: number | null
}

interface HifldResponse {
  features: { attributes: HifldAttr; geometry: { x: number; y: number } | null }[]
}

/** Parse HIFLD TRAUMA field string to a US trauma level number (1–5) or null. */
function parseTraumaLevel(trauma: string | null | undefined): number | null {
  if (!trauma) return null
  const t = trauma.toUpperCase().replace(/\s+/g, '')
  // Common formats: "LEVEL I", "LEVEL 1", "LEVELII", "I", "1"
  if (t.includes('LEVELIII') || t === 'III' || t === '3') return 3
  if (t.includes('LEVELII')  || t === 'II'  || t === '2') return 2
  if (t.includes('LEVELI')   || t === 'I'   || t === '1') return 1
  if (t.includes('LEVELIV')  || t === 'IV'  || t === '4') return 4
  if (t.includes('LEVELV')   || t === 'V'   || t === '5') return 5
  if (t === 'NOT APPLICABLE' || t === 'NOTAPPLICABLE' || t === 'NA') return null
  return null
}

function parseHifldFeature(feat: { attributes: HifldAttr; geometry: { x: number; y: number } | null }): HifldFacility | null {
  const a = feat.attributes
  const lat = a.LATITUDE ?? feat.geometry?.y ?? null
  const lon = a.LONGITUDE ?? feat.geometry?.x ?? null
  if (lat === null || lon === null) return null

  const name    = a.NAME?.trim()    ?? 'Unknown'
  const phone   = a.TELEPHONE?.trim() ?? ''
  const address = [a.ADDRESS, a.CITY, a.STATE, a.ZIP].filter(Boolean).join(', ')
  const beds    = a.BEDS ?? 0
  const hasHelipad   = (a.HELIPAD  ?? '').toUpperCase() === 'Y'
  const hasEmergency = (a.EMERGENCY ?? '').toUpperCase() === 'Y'
  const traumaLevel  = parseTraumaLevel(a.TRAUMA)

  // Don't infer surgical/neuro from trauma level for pediatric-sounding hospitals —
  // a Level I pediatric trauma center can operate on children, not adult casualties.
  const isPedName = /child|paediatric|pediatric/i.test(name)
  const documentedCaps = [...hifldServiceLinesToCaps(a.TYPE ?? ''), ...inferCapsFromName(name)]
  const tierInferred = isPedName ? [] : inferCapsFromTraumaLevel(traumaLevel)
  const capabilities: CapabilityFlag[] = [...new Set([...documentedCaps, ...tierInferred])]
  // Track which caps came purely from the trauma designation (not in TYPE/name source text).
  const inferredCapabilities: CapabilityFlag[] = tierInferred.filter(c => !documentedCaps.includes(c))

  let tier: CareTier
  if (traumaLevel !== null) {
    tier = usTraumaLevelToTier(traumaLevel)
  } else {
    // Fallback heuristic when no trauma designation
    tier = osmHeuristicTier({
      hasEmergency,
      specialities: (a.TYPE ?? '').split(',').map(s => s.trim()),
      beds,
    })
  }

  return {
    source: 'hifld',
    hifldId: String(a.OBJECTID),
    name,
    lat,
    lon,
    phone,
    address,
    city: a.CITY ?? '',
    state: a.STATE ?? '',
    zip: a.ZIP ?? '',
    beds,
    hasHelipad,
    hasEmergency,
    traumaLevel,
    capabilities,
    inferredCapabilities,
    tier,
  }
}

function cacheKey(lat: number, lon: number, radiusM: number): string {
  return `${CACHE_KEY_PREFIX}${lat.toFixed(1)},${lon.toFixed(1)},${radiusM}`
}

interface CacheEntry { ts: number; facilities: HifldFacility[] }

function readCache(key: string): HifldFacility[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry: CacheEntry = JSON.parse(raw)
    if (Date.now() - entry.ts > CACHE_TTL_MS) { localStorage.removeItem(key); return null }
    return entry.facilities
  } catch { return null }
}

function writeCache(key: string, facilities: HifldFacility[]): void {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), facilities })) } catch { /* quota */ }
}

/**
 * Fetch HIFLD hospital data for a CONUS target.
 * Returns [] immediately if target is outside CONUS.
 */
export async function fetchHifld(target: LatLon, radiusM = 80_000): Promise<HifldFacility[]> {
  if (!isConus(target)) return []

  const key = cacheKey(target.lat, target.lon, radiusM)
  const cached = readCache(key)
  if (cached) return cached

  // Convert radius to approximate degree offset for bbox query
  const degLat = radiusM / 111_320
  const degLon = radiusM / (111_320 * Math.cos(target.lat * Math.PI / 180))

  const xmin = target.lon - degLon
  const ymin = target.lat - degLat
  const xmax = target.lon + degLon
  const ymax = target.lat + degLat

  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    outFields: 'OBJECTID,NAME,ADDRESS,CITY,STATE,ZIP,TELEPHONE,BEDS,HELIPAD,TRAUMA,TYPE,EMERGENCY,LATITUDE,LONGITUDE',
    geometry: JSON.stringify({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    resultRecordCount: '500',
  })

  let resp: Response
  try {
    resp = await fetch(`${HIFLD_BASE_URL}?${params}`)
    if (!resp.ok) throw new Error(`HIFLD HTTP ${resp.status}`)
  } catch (err) {
    console.warn('[hifld] fetch failed — falling back to OSM only:', err)
    return []
  }

  const json = await resp.json() as HifldResponse
  const facilities: HifldFacility[] = []
  for (const feat of json.features ?? []) {
    const f = parseHifldFeature(feat)
    if (f) facilities.push(f)
  }

  writeCache(key, facilities)
  return facilities
}
