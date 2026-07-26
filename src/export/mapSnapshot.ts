/**
 * Off-screen Leaflet map snapshot for the med-plan imagery.
 *
 * Produces a single HTMLCanvasElement:
 *  - Main tile: PACE facilities + ground/helo routes, zoomed to PACE geography.
 *  - Echelon PiP (when an echelon plan exists): small inset placed in the emptiest
 *    corner (avoids the north arrow, target, and facility markers) showing the macro
 *    two-leg route (TARGET → stabilize → Level I definitive).
 *    PACE facilities appear as single-letter markers (P/A/C/E) to reduce clutter.
 *
 * Both tiles use Esri World Imagery + the World Boundaries and Places labels overlay (hybrid).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { LatLon } from '../calc/geo'
import type { FacilityRecord } from '../med/facilities/merge'
import type { FacilityPace } from '../med/pace'
import type { RouteResult } from '../med/routing/ors'
import type { EchelonPlan } from '../med/echelon'
import { LEG2_DROP_GROUND_DIST_M } from '../med/echelon'
import { composeMapCanvas } from './composeMapCanvas'
import type { MapLabel } from '../types/mapLabel'
import { formatTransit } from '../med/rank'
import { inverse } from '../calc/geo'
import { careLevelRoman } from '../med/careLevel'

// ── Constants ──────────────────────────────────────────────────────────────────

const SNAP_W = 900
const SNAP_H = 910   // ~0.988:1 — matches PDF map slot (640×648) to eliminate cover-crop side bleed
const EXPORT_SCALE = 3

// Echelon PiP inset dimensions (logical pixels, composited at EXPORT_SCALE)
const INSET_W      = 270
const INSET_H      = 200
const INSET_MARGIN = 30   // logical px from canvas edge (must exceed PPTX top-crop ~16px)

// ── Helpers ────────────────────────────────────────────────────────────────────

function tierColor(tier: number): string {
  switch (tier) {
    case 4: return '#4caf50'
    case 3: return '#2196f3'
    case 2: return '#ff9800'
    default: return '#9e9e9e'
  }
}

function paceLetterColor(letter: string): string {
  switch (letter) {
    case 'P': return '#4caf50'
    case 'A': return '#2196f3'
    case 'C': return '#ff9800'
    case 'E': return '#e53935'
    default:  return '#9e9e9e'
  }
}

function paceLetterForFacility(facilityId: string, pace: FacilityPace | null): string {
  if (!pace) return ''
  for (const e of pace.entries) {
    if (e.facility.id === facilityId) return e.letter
  }
  return ''
}

/** IDs of all facilities in the PACE plan. */
function paceFacilityIds(pace: FacilityPace | null): Set<string> {
  const ids = new Set<string>()
  if (!pace) return ids
  for (const e of pace.entries) ids.add(e.facility.id)
  return ids
}

const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'

const waitForTiles = (map: any): Promise<void> => new Promise(resolve => {
  const POLL_MS = 150
  const MAX_MS  = 10_000
  let elapsed   = 0

  const allTilesComplete = (): boolean => {
    let hasTile    = false
    let incomplete = false
    map.eachLayer((layer: any) => {
      if (!layer._tiles) return
      for (const key of Object.keys(layer._tiles)) {
        const img = layer._tiles[key]?.el as HTMLImageElement | undefined
        if (img) {
          hasTile = true
          if (!img.complete || img.naturalWidth === 0) incomplete = true
        }
      }
    })
    return hasTile && !incomplete
  }

  const check = () => {
    if (allTilesComplete()) {
      setTimeout(resolve, 200)
    } else if (elapsed >= MAX_MS) {
      resolve()
    } else {
      elapsed += POLL_MS
      setTimeout(check, POLL_MS)
    }
  }

  setTimeout(check, POLL_MS)
})

function makeOffscreenDiv(w: number, h: number): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `
    position:fixed; left:-9999px; top:0;
    width:${w}px; height:${h}px; overflow:hidden; z-index:-1;
  `
  document.body.appendChild(el)
  return el
}

// ── Echelon PiP inset renderer ─────────────────────────────────────────────────

/**
 * Render a small macro-view canvas for the echelon plan (TARGET → stabilize → definitive).
 * PACE facilities appear as letter-only markers (P/A/C/E). No north arrow.
 */
async function renderEchelonInsetCanvas(
  L:            any,
  target:       LatLon,
  echelonPlan:  EchelonPlan,
  facilityPace: FacilityPace | null,
  groundRoutes: Record<string, RouteResult>,
): Promise<HTMLCanvasElement | undefined> {
  const container = makeOffscreenDiv(INSET_W, INSET_H)
  try {
    const map = (L as any).map(container, {
      center:              [target.lat, target.lon],
      zoom:                7,
      zoomControl:         false,
      attributionControl:  false,
      preferCanvas:        true,
      zoomAnimation:       false,
      fadeAnimation:       false,
      markerZoomAnimation: false,
    })
    map.invalidateSize()

    ;(L as any).tileLayer(ESRI_TILES, { attribution: '', maxZoom: 18, crossOrigin: true }).addTo(map)
    ;(L as any).tileLayer(ESRI_LABELS, { attribution: '', maxZoom: 18, crossOrigin: true, opacity: 1 }).addTo(map)

    const labels: MapLabel[] = []
    const bounds: [number, number][] = [[target.lat, target.lon]]

    // TARGET
    ;(L as any).circleMarker([target.lat, target.lon], {
      radius: 5, color: '#ffcc02', fillColor: '#ffcc02', fillOpacity: 1, weight: 2,
    }).addTo(map)
    labels.push({ text: 'TARGET', lat: target.lat, lon: target.lon, color: '#ffcc02', variant: 'icon' })

    // PACE facilities — letter only
    if (facilityPace) {
      for (const entry of facilityPace.entries) {
        const { facility, letter } = entry
        const color = paceLetterColor(letter)
        ;(L as any).circleMarker([facility.lat, facility.lon], {
          radius: 4, color, fillColor: color, fillOpacity: 0.85, weight: 2,
        }).addTo(map)
        labels.push({ text: letter, lat: facility.lat, lon: facility.lon, color, variant: 'icon' })
        bounds.push([facility.lat, facility.lon])
      }
    }

    const stab = echelonPlan.stabilizeAt
    const def  = echelonPlan.definitive

    // SOST as stabilize node (not in PACE entries) — add a dedicated marker
    const stabInPace = facilityPace?.entries.some(e => e.facility.id === stab.id) ?? false
    if (!stabInPace) {
      ;(L as any).circleMarker([stab.lat, stab.lon], {
        radius: 5, color: '#26c6da', fillColor: '#26c6da', fillOpacity: 0.85, weight: 2,
      }).addTo(map)
      labels.push({ text: 'SOST', lat: stab.lat, lon: stab.lon, color: '#26c6da', variant: 'icon' })
      bounds.push([stab.lat, stab.lon])
    }

    // Definitive (Level I) node
    const defLabel = def.name.length > 20 ? def.name.slice(0, 19) + '…' : def.name
    ;(L as any).circleMarker([def.lat, def.lon], {
      radius: 6, color: '#4caf50', fillColor: '#4caf50', fillOpacity: 0.9, weight: 2.5,
    }).addTo(map)
    labels.push({ text: defLabel, lat: def.lat, lon: def.lon, color: '#4caf50', variant: 'icon' })
    bounds.push([def.lat, def.lon])

    const leg2Color = echelonPlan.environment === 'training' ? '#ff9800' : '#26c6da'
    const [, leg2] = echelonPlan.legs

    // Leg-1: TARGET → stabilize
    const leg1Route = groundRoutes[stab.id]
    if (leg1Route && leg1Route.polyline.length > 1) {
      const latlngs = leg1Route.polyline.map(([ln, lt]) => [lt, ln] as [number, number])
      ;(L as any).polyline(latlngs, { color: '#4caf50', weight: 2, opacity: 0.85 }).addTo(map)
    } else {
      ;(L as any).polyline(
        [[target.lat, target.lon], [stab.lat, stab.lon]],
        { color: '#4caf50', weight: 2, dashArray: '4 6', opacity: 0.7 }
      ).addTo(map)
    }

    // Leg-2: stabilize → definitive — mode drives flying vs ground, same as MapScreen
    const leg2Key   = `leg2:${stab.id}->${def.id}`
    const leg2Route = groundRoutes[leg2Key]
    if (leg2.mode === 'rotary') {
      ;(L as any).polyline(
        [[stab.lat, stab.lon], [def.lat, def.lon]],
        { color: leg2Color, weight: 2, dashArray: '3 5', opacity: 0.75 }
      ).addTo(map)
      const heloS = leg2.transit.heloDurationS
      if (heloS !== null) {
        labels.push({
          text: formatTransit(heloS),
          lat: (stab.lat + def.lat) / 2,
          lon: (stab.lon + def.lon) / 2,
          color: leg2Color, variant: 'label',
        })
      }
    } else if (leg2.mode === 'fixed-wing') {
      ;(L as any).polyline(
        [[stab.lat, stab.lon], [def.lat, def.lon]],
        { color: '#ba68c8', weight: 2, dashArray: '6 5', opacity: 0.75 }
      ).addTo(map)
      const fwS = leg2.transit.fixedWingDurationS
      if (fwS != null) {
        labels.push({
          text: `${formatTransit(fwS)} (airfield TBD)`,
          lat: (stab.lat + def.lat) / 2,
          lon: (stab.lon + def.lon) / 2,
          color: '#ba68c8', variant: 'label',
        })
      }
    } else {
      // Ground mode (civilian EMS in training, or no helipads in operational).
      // Beyond the threshold, draw a geodesic. Under the threshold, use the ORS road polyline.
      const leg2DistM = inverse({ lat: stab.lat, lon: stab.lon }, { lat: def.lat, lon: def.lon }).distM
      if (leg2DistM > LEG2_DROP_GROUND_DIST_M) {
        // Long haul: straight-line geodesic
        ;(L as any).polyline(
          [[stab.lat, stab.lon], [def.lat, def.lon]],
          { color: leg2Color, weight: 1.5, dashArray: '4 8', opacity: 0.6 }
        ).addTo(map)
        const groundDurS = leg2.transit.groundDurationS ?? leg2Route?.durationS
        const timeS = groundDurS ?? leg2.transit.effectiveDurationS
        labels.push({
          text: formatTransit(timeS),
          lat: (stab.lat + def.lat) / 2,
          lon: (stab.lon + def.lon) / 2,
          color: leg2Color, variant: 'label',
        })
      } else if (leg2Route && leg2Route.polyline.length > 1) {
        // Near ground transfer: ORS road polyline (solid)
        const latlngs = leg2Route.polyline.map(([ln, lt]) => [lt, ln] as [number, number])
        ;(L as any).polyline(latlngs, {
          color: leg2Color, weight: 2, opacity: 0.85,
        }).addTo(map)
        const mid = latlngs[Math.floor(latlngs.length / 2)]
        if (mid) {
          labels.push({
            text: formatTransit(leg2Route.durationS),
            lat: mid[0], lon: mid[1], color: leg2Color, variant: 'label',
          })
        }
      } else {
        // No ORS route: geodesic fallback
        ;(L as any).polyline(
          [[stab.lat, stab.lon], [def.lat, def.lon]],
          { color: leg2Color, weight: 1.5, dashArray: '4 8', opacity: 0.6 }
        ).addTo(map)
      }
    }

    if (bounds.length > 1) {
      map.fitBounds((L as any).latLngBounds(bounds).pad(0.14))
    }

    await waitForTiles(map)
    await new Promise<void>(r => requestAnimationFrame(() => r()))

    const canvas = composeMapCanvas(L, map, {
      width: INSET_W, height: INSET_H, scale: EXPORT_SCALE,
      labels,
      backgroundColor: '#1a1a1a',
      northArrow: false,
    })

    map.remove()
    return canvas

  } catch (err) {
    console.error('[renderEchelonInsetCanvas] failed:', err)
    return undefined
  } finally {
    document.body.removeChild(container)
  }
}

// ── Inset compositor ───────────────────────────────────────────────────────────

/**
 * Blit the echelon inset onto the main canvas in the corner with the fewest
 * obstacles.  Scores all four corners against:
 *   • obstaclesPx — pixel coords (post EXPORT_SCALE) of target + facility markers.
 *   • A large penalty for the bottom-right north-arrow reserved region so the
 *     inset never covers the compass unless every other corner is also busy.
 * targetPx is used as a tie-breaker (prefer the corner farthest from target).
 */
function blitEchelonInset(
  mainCanvas:   HTMLCanvasElement,
  insetCanvas:  HTMLCanvasElement,
  obstaclesPx:  { x: number; y: number }[],
  targetPx?:    { x: number; y: number },
): void {
  const ctx    = mainCanvas.getContext('2d')!
  const s      = EXPORT_SCALE
  const margin = INSET_MARGIN * s
  const iw     = insetCanvas.width
  const ih     = insetCanvas.height
  const W      = mainCanvas.width
  const H      = mainCanvas.height

  // Four candidate corners — UR is the legacy default, so it leads the list and
  // wins all tie-breaks when no obstacles are present.
  const corners = [
    { bx: W - iw - margin, by: margin          },  // UR
    { bx: margin,          by: margin          },  // UL
    { bx: margin,          by: H - ih - margin },  // LL
    { bx: W - iw - margin, by: H - ih - margin },  // LR
  ]

  // North-arrow reserved region (bottom-right corner).
  // Mirrors drawNorthArrowCanvas geometry: SIZE=36, MARGIN=10 (northArrow.ts).
  // Add 20 px of generous clearance so the "N" label is also protected.
  const naLogical = (36 + 2 * 10 + 20) * s   // ≈ 228 scaled px
  const naLeft   = W - naLogical
  const naTop    = H - naLogical
  const NORTH_ARROW_PENALTY = 1000   // swamps the obstacle count

  // Rect–rect overlap (half-open bounds are fine for our purposes).
  const rectsOverlap = (ax: number, ay: number, bx2: number, by2: number) =>
    ax < W && bx2 > naLeft && ay < H && by2 > naTop

  // Pick the lowest-scoring corner.  Tie-break: farthest from target.
  let bestIdx   = 0
  let bestScore = Infinity
  let bestDist  = -1

  for (let i = 0; i < corners.length; i++) {
    const { bx, by } = corners[i]
    let score = 0

    // Count marker hits inside this inset rect.
    for (const pt of obstaclesPx) {
      if (pt.x >= bx && pt.x <= bx + iw && pt.y >= by && pt.y <= by + ih) score++
    }

    // Heavy penalty for overlapping the north-arrow region.
    if (rectsOverlap(bx, by, bx + iw, by + ih)) score += NORTH_ARROW_PENALTY

    // Tie-break: prefer corner whose centre is farthest from the target.
    const dist = targetPx
      ? Math.hypot(bx + iw / 2 - targetPx.x, by + ih / 2 - targetPx.y)
      : 0

    if (score < bestScore || (score === bestScore && dist > bestDist)) {
      bestScore = score
      bestDist  = dist
      bestIdx   = i
    }
  }

  const { bx, by } = corners[bestIdx]

  // Dark border / shadow behind inset
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.70)'
  ctx.fillRect(bx - 2 * s, by - 2 * s, iw + 4 * s, ih + 4 * s)
  ctx.restore()

  // Inset imagery
  ctx.drawImage(insetCanvas, bx, by)

  // Thin bright border around inset
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.lineWidth = 1 * s
  ctx.strokeRect(bx - 1, by - 1, iw + 2, ih + 2)
  ctx.restore()

  // "ECHELONS OF CARE" chip label at top-left of inset
  const labelFS  = 7 * s
  const labelPad = 3 * s
  const labelTxt = 'ECHELONS OF CARE'
  ctx.save()
  ctx.font = `700 ${labelFS}px monospace`
  const tw = ctx.measureText(labelTxt).width
  const lx = bx + labelPad
  const ly = by + labelPad
  ctx.fillStyle = 'rgba(0,0,0,0.65)'
  ctx.fillRect(lx - labelPad, ly - labelPad, tw + labelPad * 2, labelFS + labelPad * 2)
  ctx.fillStyle = '#26c6da'
  ctx.shadowColor = 'rgba(0,0,0,0.9)'
  ctx.shadowBlur  = 3 * s
  ctx.fillText(labelTxt, lx, ly + labelFS * 0.85)
  ctx.restore()
}

// ── Main renderer ──────────────────────────────────────────────────────────────

export async function renderMedMapToCanvas(
  target:              LatLon,
  facilities:          FacilityRecord[],
  facilityPace:        FacilityPace | null,
  groundRoutes:        Record<string, RouteResult>,
  heloSpeedKt:         number,
  rotaryWingAvailable: boolean,
  onProgress?:         (msg: string) => void,
  echelonPlan?:        EchelonPlan,
  chamberPace?:        FacilityPace | null,
): Promise<HTMLCanvasElement | undefined> {
  const log = (msg: string) => onProgress?.(msg)

  const L = await import('leaflet')
  // vite-ignore: CSS is provided by the consuming app's bundler; medcore never bundles it.
  await import(/* @vite-ignore */ 'leaflet/dist/leaflet.css').catch(() => { /* ok if not bundled */ })

  const container = makeOffscreenDiv(SNAP_W, SNAP_H)

  log('Imagery: initialising Leaflet…')

  try {
    delete (L.Icon.Default.prototype as any)._getIconUrl

    const map = (L as any).map(container, {
      center:              [target.lat, target.lon],
      zoom:                9,
      zoomControl:         false,
      attributionControl:  false,
      preferCanvas:        true,
      zoomAnimation:       false,
      fadeAnimation:       false,
      markerZoomAnimation: false,
    })
    map.invalidateSize()

    ;(L as any).tileLayer(ESRI_TILES, { attribution: '', maxZoom: 18, crossOrigin: true }).addTo(map)
    ;(L as any).tileLayer(ESRI_LABELS, { attribution: '', maxZoom: 18, crossOrigin: true, opacity: 1 }).addTo(map)

    const labels: MapLabel[] = []

    // Target marker
    ;(L as any).circleMarker([target.lat, target.lon], {
      radius: 6, color: '#ffcc02', fillColor: '#ffcc02', fillOpacity: 1, weight: 2,
    }).addTo(map)
    labels.push({ text: 'TARGET', lat: target.lat, lon: target.lon, color: '#ffcc02', variant: 'icon' })

    const bounds: [number, number][] = [[target.lat, target.lon]]

    // Only render PACE-plan facilities in the export imagery.
    // The echelon definitive (Level I) is shown in the PiP inset — exclude it
    // here so it doesn't inflate the main-map bounds or draw a redundant route.
    const paceIds = paceFacilityIds(facilityPace)
    const echelonDefId = echelonPlan?.definitive.id
    const renderFacilities = facilityPace
      ? facilities.filter(f => paceIds.has(f.id) && f.id !== echelonDefId)
      : facilities.filter(f => f.id !== echelonDefId)

    for (const fac of renderFacilities) {
      const paceLetter = paceLetterForFacility(fac.id, facilityPace)
      const color = paceLetter ? paceLetterColor(paceLetter) : tierColor(fac.tier)
      const levelStr = `Lvl ${careLevelRoman(fac.tier as 1 | 2 | 3 | 4)}`
      const label = paceLetter
        ? `[${paceLetter}] ${fac.name} — ${levelStr}`
        : `${fac.name} — ${levelStr}`

      ;(L as any).circleMarker([fac.lat, fac.lon], {
        radius: 6, color, fillColor: color, fillOpacity: 0.9, weight: 2.5,
      }).addTo(map)
      labels.push({ text: label, lat: fac.lat, lon: fac.lon, color, variant: 'icon' })
      bounds.push([fac.lat, fac.lon])

      // Ground route
      const route = groundRoutes[fac.id]
      if (route && route.polyline.length > 1) {
        const latlngs = route.polyline.map(([ln, lt]) => [lt, ln] as [number, number])
        ;(L as any).polyline(latlngs, {
          color, weight: route.estimated ? 1.5 : 2.5,
          dashArray: route.estimated ? '6 4' : undefined, opacity: 0.8,
        }).addTo(map)
        const mid = latlngs[Math.floor(latlngs.length / 2)]
        if (mid) {
          labels.push({
            text: formatTransit(route.durationS),
            lat: mid[0], lon: mid[1],
            color, variant: 'label',
          })
        }
      } else if (!rotaryWingAvailable || !fac.hasHelipad) {
        ;(L as any).polyline(
          [[target.lat, target.lon], [fac.lat, fac.lon]],
          { color, weight: 1.5, dashArray: '4 8', opacity: 0.45 }
        ).addTo(map)
      }

      // Helo route
      if (rotaryWingAvailable && fac.hasHelipad) {
        const { distM } = inverse(target, { lat: fac.lat, lon: fac.lon })
        const heloS = Math.round((distM / 1852) / heloSpeedKt * 3600)
        ;(L as any).polyline(
          [[target.lat, target.lon], [fac.lat, fac.lon]],
          { color, weight: 2.5, dashArray: '3 5', opacity: 0.6 }
        ).addTo(map)
        const midLat = (target.lat + fac.lat) / 2
        const midLon = (target.lon + fac.lon) / 2
        labels.push({
          text: `Helo ${formatTransit(heloS)}`,
          lat: midLat, lon: midLon,
          color, variant: 'label',
        })
      }
    }

    // Chamber PACE primary — dive mode only. Only the P slot appears on the exported map.
    // If the chamber primary deduped into a hospital already rendered above, we still push
    // a separate label so the CHMBR designation is visible; the dot marker is re-drawn in
    // green (overrides the hospital tier color), which is intentional for clarity.
    const chamberPrimary = chamberPace?.entries.find(e => e.letter === 'P')?.facility ?? null
    if (chamberPrimary) {
      const cpColor = paceLetterColor('P')  // #4caf50 — same green as standard primary
      ;(L as any).circleMarker([chamberPrimary.lat, chamberPrimary.lon], {
        radius: 6, color: cpColor, fillColor: cpColor, fillOpacity: 0.9, weight: 2.5,
      }).addTo(map)
      labels.push({
        text: `[P] ${chamberPrimary.name} — CHMBR`,
        lat: chamberPrimary.lat, lon: chamberPrimary.lon,
        color: cpColor,
        ringColor: '#00bcd4',
        variant: 'icon',
      })
      bounds.push([chamberPrimary.lat, chamberPrimary.lon])

      // Ground route to chamber primary (fetched during App.tsx chamber route pass)
      const cpRoute = groundRoutes[chamberPrimary.id]
      if (cpRoute && cpRoute.polyline.length > 1) {
        const latlngs = cpRoute.polyline.map(([ln, lt]) => [lt, ln] as [number, number])
        ;(L as any).polyline(latlngs, {
          color: cpColor, weight: cpRoute.estimated ? 1.5 : 2.5,
          dashArray: cpRoute.estimated ? '6 4' : undefined, opacity: 0.8,
        }).addTo(map)
        const mid = latlngs[Math.floor(latlngs.length / 2)]
        if (mid) {
          labels.push({ text: formatTransit(cpRoute.durationS), lat: mid[0], lon: mid[1], color: cpColor, variant: 'label' })
        }
      } else {
        ;(L as any).polyline(
          [[target.lat, target.lon], [chamberPrimary.lat, chamberPrimary.lon]],
          { color: cpColor, weight: 1.5, dashArray: '4 8', opacity: 0.45 }
        ).addTo(map)
      }
    }

    // Fit to PACE facilities + target only — echelon definitive is in the PiP, not here.
    // Extra padding (0.20 vs 0.12) pulls markers away from the edges so a clear corner
    // is available for the echelon inset and the north arrow stays unobstructed.
    if (bounds.length > 1) {
      map.fitBounds((L as any).latLngBounds(bounds).pad(0.20))
    }

    log('Imagery: waiting for tiles…')
    await waitForTiles(map)
    await new Promise<void>(r => requestAnimationFrame(() => r()))

    log('Imagery: compositing…')
    const canvas = composeMapCanvas(L, map, {
      width: SNAP_W, height: SNAP_H, scale: EXPORT_SCALE,
      labels,
      backgroundColor: '#1a1a1a',
    })

    // Capture pixel positions of all map markers before removing the map so the
    // inset compositor can score corners and avoid covering them.
    const toScaledPx = (lat: number, lon: number): { x: number; y: number } => {
      const pt = map.latLngToContainerPoint((L as any).latLng(lat, lon))
      return { x: pt.x * EXPORT_SCALE, y: pt.y * EXPORT_SCALE }
    }
    const targetPx = toScaledPx(target.lat, target.lon)
    const obstaclesPx: { x: number; y: number }[] = [
      targetPx,
      ...renderFacilities.map(f => toScaledPx(f.lat, f.lon)),
      ...(chamberPrimary ? [toScaledPx(chamberPrimary.lat, chamberPrimary.lon)] : []),
    ]

    map.remove()

    // ── Echelon PiP inset ───────────────────────────────────────────────────
    if (echelonPlan) {
      log('Imagery: rendering echelon inset…')
      const insetCanvas = await renderEchelonInsetCanvas(L, target, echelonPlan, facilityPace, groundRoutes)
      if (insetCanvas) blitEchelonInset(canvas, insetCanvas, obstaclesPx, targetPx)
    }

    return canvas

  } catch (err) {
    console.error('[renderMedMapToCanvas] failed:', err)
    log(`Imagery: failed — ${(err as Error).message}`)
    return undefined
  } finally {
    document.body.removeChild(container)
  }
}
