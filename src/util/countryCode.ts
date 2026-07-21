/**
 * Lightweight country-code detection from lat/lon.
 *
 * Strategy (in order):
 *  1. localStorage cache (30-day TTL)
 *  2. geonames.org country-code API (free, but shared `demo` account is
 *     rate-limited — treat any missing countryCode in the response as a miss,
 *     not a US default)
 *  3. Offline bounding-box fallback covering common operational theatres
 *
 * Key fix: the geonames `demo` account frequently returns HTTP 200 with a
 * status/error body instead of a countryCode. Previously this silently
 * defaulted to 'US'. Now it falls through to the bbox table.
 */

const CACHE_PREFIX = 'medplanner-cc3-'
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30 days

function cacheKey(lat: number, lon: number): string {
  return `${CACHE_PREFIX}${lat.toFixed(1)},${lon.toFixed(1)}`
}

/** Ordered bounding-box table. First match wins. */
const BBOX_TABLE: {
  code: string
  minLat: number; maxLat: number
  minLon: number; maxLon: number
}[] = [
  // UK — wider box to cover NI, western Scotland, Scilly, Shetland
  { code: 'GB', minLat: 49.5, maxLat: 61.1, minLon: -9.0, maxLon:  2.2 },
  // Ireland
  { code: 'IE', minLat: 51.3, maxLat: 55.5, minLon: -10.7, maxLon: -5.9 },
  // Continental USA
  { code: 'US', minLat: 24.0, maxLat: 49.5, minLon: -125.0, maxLon: -66.0 },
  // Canada
  { code: 'CA', minLat: 41.7, maxLat: 83.0, minLon: -141.0, maxLon: -52.0 },
  // Germany
  { code: 'DE', minLat: 47.3, maxLat: 55.1, minLon:   6.0, maxLon:  15.1 },
  // France (mainland; excludes overseas territories)
  { code: 'FR', minLat: 41.3, maxLat: 51.2, minLon:  -5.2, maxLon:   9.6 },
  // Italy
  { code: 'IT', minLat: 35.5, maxLat: 47.1, minLon:   6.6, maxLon:  18.6 },
  // Spain (mainland + Balearics)
  { code: 'ES', minLat: 36.0, maxLat: 43.8, minLon:  -9.3, maxLon:   4.3 },
  // Portugal
  { code: 'PT', minLat: 36.9, maxLat: 42.2, minLon:  -9.5, maxLon:  -6.2 },
  // Netherlands
  { code: 'NL', minLat: 50.7, maxLat: 53.6, minLon:   3.3, maxLon:   7.2 },
  // Belgium
  { code: 'BE', minLat: 49.5, maxLat: 51.5, minLon:   2.5, maxLon:   6.4 },
  // Luxembourg
  { code: 'LU', minLat: 49.4, maxLat: 50.2, minLon:   5.7, maxLon:   6.5 },
  // Switzerland
  { code: 'CH', minLat: 45.8, maxLat: 47.8, minLon:   5.9, maxLon:  10.5 },
  // Austria
  { code: 'AT', minLat: 46.4, maxLat: 49.0, minLon:   9.5, maxLon:  17.2 },
  // Czech Republic
  { code: 'CZ', minLat: 48.5, maxLat: 51.1, minLon:  12.1, maxLon:  18.9 },
  // Slovakia
  { code: 'SK', minLat: 47.7, maxLat: 49.6, minLon:  16.8, maxLon:  22.6 },
  // Hungary
  { code: 'HU', minLat: 45.7, maxLat: 48.6, minLon:  16.1, maxLon:  22.9 },
  // Romania
  { code: 'RO', minLat: 43.6, maxLat: 48.3, minLon:  20.2, maxLon:  29.7 },
  // Bulgaria
  { code: 'BG', minLat: 41.2, maxLat: 44.2, minLon:  22.4, maxLon:  28.6 },
  // Greece
  { code: 'GR', minLat: 34.8, maxLat: 41.8, minLon:  19.3, maxLon:  29.7 },
  // Croatia
  { code: 'HR', minLat: 42.4, maxLat: 46.6, minLon:  13.5, maxLon:  19.5 },
  // Slovenia
  { code: 'SI', minLat: 45.4, maxLat: 46.9, minLon:  13.4, maxLon:  16.6 },
  // Estonia
  { code: 'EE', minLat: 57.5, maxLat: 59.7, minLon:  21.8, maxLon:  28.2 },
  // Latvia
  { code: 'LV', minLat: 55.7, maxLat: 57.9, minLon:  20.9, maxLon:  28.2 },
  // Lithuania
  { code: 'LT', minLat: 53.9, maxLat: 56.5, minLon:  20.9, maxLon:  26.8 },
  // Finland
  { code: 'FI', minLat: 59.8, maxLat: 70.1, minLon:  20.0, maxLon:  31.6 },
  // Sweden
  { code: 'SE', minLat: 55.3, maxLat: 69.1, minLon:  10.9, maxLon:  24.2 },
  // Denmark
  { code: 'DK', minLat: 54.6, maxLat: 57.8, minLon:   8.0, maxLon:  15.3 },
  // Iceland
  { code: 'IS', minLat: 63.2, maxLat: 66.6, minLon: -24.5, maxLon: -13.5 },
  // Australia
  { code: 'AU', minLat: -43.7, maxLat: -10.7, minLon: 112.9, maxLon: 153.7 },
  // New Zealand
  { code: 'NZ', minLat: -47.3, maxLat: -34.0, minLon: 166.3, maxLon: 178.6 },
  // Norway
  { code: 'NO', minLat: 57.9, maxLat: 71.2, minLon:   4.5, maxLon:  31.2 },
  // Poland
  { code: 'PL', minLat: 49.0, maxLat: 54.8, minLon:  14.1, maxLon:  24.2 },
  // China
  { code: 'CN', minLat: 18.0, maxLat: 53.6, minLon:  73.0, maxLon: 135.1 },
  // India
  { code: 'IN', minLat:  8.0, maxLat: 37.1, minLon:  68.0, maxLon:  97.5 },
  // Turkey
  { code: 'TR', minLat: 35.8, maxLat: 42.2, minLon:  26.0, maxLon:  44.8 },
  // Pakistan
  { code: 'PK', minLat: 23.5, maxLat: 37.1, minLon:  60.0, maxLon:  77.8 },
  // Bangladesh
  { code: 'BD', minLat: 20.6, maxLat: 26.7, minLon:  88.0, maxLon:  92.7 },
  // Indonesia
  { code: 'ID', minLat: -11.1, maxLat:  6.1, minLon:  95.0, maxLon: 141.1 },
  // Brazil
  { code: 'BR', minLat: -33.8, maxLat:   5.3, minLon: -73.9, maxLon: -28.8 },
  // Japan
  { code: 'JP', minLat:  24.0, maxLat:  45.7, minLon: 122.7, maxLon: 153.0 },
  // South Korea
  { code: 'KR', minLat:  33.1, maxLat:  38.6, minLon: 124.6, maxLon: 129.6 },
  // Russia (vast; listed last so tighter boxes above take priority in overlapping zones)
  { code: 'RU', minLat: 41.0, maxLat: 82.0, minLon:  27.0, maxLon: 190.0 },
]

function bboxFallback(lat: number, lon: number): string {
  for (const b of BBOX_TABLE) {
    if (lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon) {
      return b.code
    }
  }
  // Unknown region — falls through to the 112 international default in getEmergencyNumbers().
  return 'ZZ'
}

export async function detectCountryCode(lat: number, lon: number): Promise<string> {
  const key = cacheKey(lat, lon)
  const cached = localStorage.getItem(key)
  if (cached) {
    try {
      const { ts, code } = JSON.parse(cached) as { ts: number; code: string }
      if (Date.now() - ts < CACHE_TTL_MS) return code
    } catch { /* ignore */ }
  }

  let code: string

  try {
    const url = `https://secure.geonames.org/countryCodeJSON?lat=${lat}&lng=${lon}&username=demo`
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const json = await resp.json() as { countryCode?: string }
    if (!json.countryCode) {
      // geonames returned a valid HTTP 200 but no countryCode field (typical
      // when the demo account hits its hourly limit). Fall through to bbox.
      code = bboxFallback(lat, lon)
    } else {
      code = json.countryCode
    }
  } catch {
    // Network failure or non-2xx — use offline bbox table
    code = bboxFallback(lat, lon)
  }

  localStorage.setItem(key, JSON.stringify({ ts: Date.now(), code }))
  return code
}
