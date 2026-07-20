/**
 * Geodesic and coordinate utilities.
 *
 * Uses:
 *   mgrs                      — lat/lon ⇄ MGRS conversion
 *   geographiclib-geodesic     — WGS-84 geodesic direct/inverse
 */
import { forward as mgrsForward, toPoint as mgrsToPoint } from 'mgrs'
import { Geodesic } from 'geographiclib-geodesic'

const geod = Geodesic.WGS84

export interface LatLon {
  lat: number   // decimal degrees
  lon: number   // decimal degrees
}

export interface GeoPoint extends LatLon {
  mgrs: string
}

/** Convert MGRS string to lat/lon (degrees). */
export function mgrsToLatLon(mgrsStr: string): LatLon {
  const pt = mgrsToPoint(mgrsStr)
  // toPoint returns [lon, lat] for a point, [lon, lat, lon, lat] for bbox
  const lon = pt[0]
  const lat = pt[1]
  return { lat, lon }
}

/** Convert lat/lon to MGRS (1-metre precision), returned with standard spacing. */
export function latLonToMgrs(lat: number, lon: number): string {
  return formatMgrs(mgrsForward([lon, lat], 5))  // 5 = 1 m precision
}

/** Compute destination point from origin + distance (metres) + bearing (°T true).
 *  Uses WGS-84 geodesic direct problem. */
export function destination(origin: LatLon, distanceM: number, bearingDegT: number): GeoPoint {
  const result = geod.Direct(origin.lat, origin.lon, bearingDegT, distanceM)
  const lat = result.lat2!
  const lon = result.lon2!
  return { lat, lon, mgrs: latLonToMgrs(lat, lon) }
}

/** Back-azimuth: opposite of a heading. */
export function backAzimuth(headingDeg: number): number {
  return headingDeg < 180 ? headingDeg + 180 : headingDeg - 180
}

/** Apply magnetic declination to convert from °True to °Grid.
 *  declinationDeg > 0 = East, < 0 = West (standard convention). */
export function trueToGrid(bearingDegT: number, declinationDeg: number): number {
  return ((bearingDegT + declinationDeg) % 360 + 360) % 360
}

/**
 * Compute bearing and distance from point a to point b (geodesic inverse problem).
 * Returns bearing 0–360°T and distance in metres.
 */
export function inverse(a: LatLon, b: LatLon): { bearingDegT: number; distM: number } {
  const r = geod.Inverse(a.lat, a.lon, b.lat, b.lon)
  const bearing = ((r.azi1! % 360) + 360) % 360
  return { bearingDegT: bearing, distM: r.s12! }
}

/**
 * Convert a °True bearing to °Magnetic.
 * Declination > 0 = East (True > Mag), < 0 = West (True < Mag).
 * Mag = True − decl  (e.g. decl = +2°E → Mag = True − 2).
 */
export function trueToMagnetic(bearingDegT: number, declinationDeg: number): number {
  return ((bearingDegT - declinationDeg) % 360 + 360) % 360
}

/** Format a raw (unspaced) MGRS string as the standard spaced form.
 *  e.g. "31UCU4947157633" → "31U CU 49471 57633"
 *  Handles 1m (10-digit), 10m (8-digit), 100m (6-digit) precision.
 *  Returns the original string unchanged if it cannot be parsed. */
export function formatMgrs(raw: string): string {
  const s = raw.replace(/\s+/g, '').toUpperCase()
  // GZD: 1–2 digit zone number + row letter, e.g. "31U" or "4Q"
  const m = s.match(/^(\d{1,2}[A-Z])([A-Z]{2})(\d{2,10})$/)
  if (!m) return raw
  const [, gzd, sq, digits] = m
  if (digits.length % 2 !== 0) return raw  // odd digit count — can't split evenly
  const half = digits.length / 2
  return `${gzd} ${sq} ${digits.slice(0, half)} ${digits.slice(half)}`
}

/** Parse a lat/lon string of the forms:
 *    "52.847, 0.765"
 *    "52° 50.842′ N, 000° 45.883′ E"
 *    "52.8470° N, 0.7650° E"
 */
export function parseLatLon(s: string): LatLon | null {
  // Decimal degrees  "52.847, 0.765"  or  "52.847 0.765"
  const dec = s.match(/^(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)$/)
  if (dec) return { lat: parseFloat(dec[1]), lon: parseFloat(dec[2]) }

  // DMS/DM with N/S/E/W  "52° 50.842′ N, 000° 45.883′ E"
  const dms = s.match(
    /(\d+)[°\s]+(\d+\.?\d*)['′\s]+([NS])[,\s]+(\d+)[°\s]+(\d+\.?\d*)['′\s]+([EW])/i
  )
  if (dms) {
    let lat = parseInt(dms[1]) + parseFloat(dms[2]) / 60
    let lon = parseInt(dms[4]) + parseFloat(dms[5]) / 60
    if (dms[3].toUpperCase() === 'S') lat = -lat
    if (dms[6].toUpperCase() === 'W') lon = -lon
    return { lat, lon }
  }

  // Decimal with N/S/E/W  "52.8470° N, 0.7650° E"
  const ddo = s.match(/(\d+\.?\d*)[°\s]*([NS])[,\s]+(\d+\.?\d*)[°\s]*([EW])/i)
  if (ddo) {
    let lat = parseFloat(ddo[1])
    let lon = parseFloat(ddo[3])
    if (ddo[2].toUpperCase() === 'S') lat = -lat
    if (ddo[4].toUpperCase() === 'W') lon = -lon
    return { lat, lon }
  }

  return null
}
