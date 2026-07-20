/**
 * Curated registry of Major Trauma Centres (MTCs) and equivalent Level-I trauma
 * facilities outside the US (where HIFLD, our main trauma-level datasource, gives no
 * coverage).
 *
 * Matching strategy: BOTH conditions must hold to promote a facility to tier 4 (Level I):
 *   1. The facility's coordinates are within PROXIMITY_M of the registry entry's coords.
 *   2. The facility's normalized name contains the entry's `token` string.
 *
 * Two-condition matching prevents false promotions where a neighbouring non-MTC hospital
 * shares a generic word, or where a distant hospital happens to share a name.
 *
 * To add an entry: determine the canonical name, pick the most distinctive lowercase
 * substring as `token`, and note the centroid lat/lon from OSM or Google Maps.
 * The proximity radius (5 km) is intentionally generous to absorb relation-centroid
 * offsets and site boundary variation.
 */

const PROXIMITY_M = 5_000  // metres

interface KnownMtcEntry {
  name: string    // human-readable canonical name (for logging / docs)
  /** Distinctive normalized substring that appears in the OSM name after lower-casing
   *  and stripping non-alphanumeric characters to spaces. */
  token: string
  lat: number
  lon: number
}

// ---------------------------------------------------------------------------
// Registry — UK adult Major Trauma Centres
// Sources: NHS England Major Trauma Networks (2023); NHS Wales; Scotland QUEH/MTC 2021;
//          Northern Ireland Department of Health.
// ---------------------------------------------------------------------------
const KNOWN_MTCS: readonly KnownMtcEntry[] = [
  // ── England: London ────────────────────────────────────────────────────────
  { name: "King's College Hospital",             token: 'kings college',              lat: 51.4038, lon: -0.0942 },
  { name: 'The Royal London Hospital',           token: 'royal london',               lat: 51.5183, lon: -0.0599 },
  { name: "St George's Hospital",                token: 'george',                     lat: 51.4274, lon: -0.1754 },
  { name: 'University College Hospital London',  token: 'university college hospital', lat: 51.5246, lon: -0.1340 },

  // ── England: East of England ──────────────────────────────────────────────
  { name: "Addenbrooke's Hospital",              token: 'addenbrooke',                lat: 52.1748, lon:  0.1403 },

  // ── England: East Midlands ────────────────────────────────────────────────
  { name: "Queen's Medical Centre",              token: 'queens medical',             lat: 52.9422, lon: -1.1858 },

  // ── England: West Midlands ────────────────────────────────────────────────
  { name: 'Queen Elizabeth Hospital Birmingham', token: 'queen elizabeth',            lat: 52.4530, lon: -1.9433 },
  { name: 'Royal Stoke University Hospital',     token: 'royal stoke',                lat: 53.0084, lon: -2.1880 },

  // ── England: Yorkshire & Humber ───────────────────────────────────────────
  { name: 'Leeds General Infirmary',             token: 'leeds general',              lat: 53.8027, lon: -1.5517 },
  { name: 'Northern General Hospital',           token: 'northern general',           lat: 53.4043, lon: -1.4520 },

  // ── England: North West ───────────────────────────────────────────────────
  { name: 'Salford Royal Hospital',              token: 'salford',                    lat: 53.4922, lon: -2.3389 },
  { name: 'Manchester Royal Infirmary',          token: 'manchester royal',           lat: 53.4631, lon: -2.2346 },
  { name: 'Royal Preston Hospital',              token: 'royal preston',              lat: 53.7641, lon: -2.6919 },
  { name: 'Aintree University Hospital',         token: 'aintree',                    lat: 53.4660, lon: -2.9040 },

  // ── England: North East ───────────────────────────────────────────────────
  // Note: "victoria infirmary" vs "victoria hospital" disambiguates Newcastle from Belfast.
  { name: 'Royal Victoria Infirmary',            token: 'victoria infirmary',         lat: 54.9837, lon: -1.6141 },
  { name: 'James Cook University Hospital',      token: 'james cook',                 lat: 54.5679, lon: -1.2139 },

  // ── England: South West ───────────────────────────────────────────────────
  { name: 'Southmead Hospital',                  token: 'southmead',                  lat: 51.4962, lon: -2.5939 },
  { name: 'Derriford Hospital',                  token: 'derriford',                  lat: 50.4153, lon: -4.1051 },

  // ── England: South / South East ───────────────────────────────────────────
  { name: 'University Hospital Southampton',     token: 'southampton',                lat: 50.9324, lon: -1.4019 },
  { name: 'John Radcliffe Hospital',             token: 'radcliffe',                  lat: 51.7631, lon: -1.2212 },

  // ── Wales ─────────────────────────────────────────────────────────────────
  { name: 'University Hospital of Wales',        token: 'hospital of wales',          lat: 51.4960, lon: -3.1978 },

  // ── Northern Ireland ──────────────────────────────────────────────────────
  // Note: "victoria hospital" matches the Belfast hospital; "victoria infirmary" is Newcastle.
  { name: 'Royal Victoria Hospital',             token: 'victoria hospital',          lat: 54.5985, lon: -5.9488 },

  // ── Scotland (4 Major Trauma Centres since 2021) ──────────────────────────
  { name: 'Royal Infirmary of Edinburgh',        token: 'edinburgh',                  lat: 55.9265, lon: -3.1406 },
  { name: 'Queen Elizabeth University Hospital', token: 'queen elizabeth university', lat: 55.8589, lon: -4.3144 },
  { name: 'Aberdeen Royal Infirmary',            token: 'aberdeen',                   lat: 57.1497, lon: -2.1018 },
  { name: 'Ninewells Hospital',                  token: 'ninewells',                  lat: 56.4578, lon: -3.0176 },
]

// ---------------------------------------------------------------------------
// Helpers (inlined to avoid a circular-dependency with overpass.ts → knownMtc → merge)
// ---------------------------------------------------------------------------

/** Haversine distance in metres. */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const dφ = ((lat2 - lat1) * Math.PI) / 180
  const dλ = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Lowercase, remove apostrophes/curly quotes, then collapse remaining non-alphanumeric to spaces.
 *  Removing apostrophes first ensures "King's" → "kings" (not "king s"). */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`]/g, '')         // strip apostrophes so possessives collapse: king's → kings
    .replace(/[^a-z0-9]+/g, ' ')  // remaining punctuation/whitespace → space
    .trim()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the given hospital name and coordinates match a known Level-I
 * Major Trauma Centre in the registry, indicating the facility should be promoted to
 * tier 4 regardless of what OSM tags (or lack thereof) say.
 *
 * Both conditions must pass:
 *  - Within {@link PROXIMITY_M} metres of the registry entry
 *  - Normalised name contains the entry's distinctive token
 */
export function matchesKnownMtc(name: string, lat: number, lon: number): boolean {
  const normName = normalise(name)
  return KNOWN_MTCS.some(
    entry =>
      haversineM(lat, lon, entry.lat, entry.lon) <= PROXIMITY_M &&
      normName.includes(entry.token),
  )
}

/** Exported for tests only — do not use in production code. */
export const _testOnly = { PROXIMITY_M, KNOWN_MTCS }
