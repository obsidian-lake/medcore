/**
 * Build a Google Maps universal directions URL from coordinates.
 * Opens the native maps app on iOS/Android; falls back to browser Google Maps.
 */
export function directionsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
}
