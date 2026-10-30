/**
 * MedMap — Leaflet satellite imagery with facility markers, routes, and
 * isochrones, extracted from medplanner/app/src/ui/MapScreen.tsx.
 *
 * Uses Esri World Imagery tiles (keyless, crossOrigin:true for canvas
 * export). Draws target area marker + label, facility markers (tier-
 * coloured, helipad badge), ground routes (ORS polylines) with transit time
 * labels, helo routes (geodesic point-to-point) for facilities with
 * helipads, 60-min isochrone shading (optional overlay), the north arrow,
 * and collision-avoided labels (render/labelPlacement.ts).
 *
 * IMPORTANT: Never run html2canvas on this Leaflet map. Export uses
 * export/composeMapCanvas.ts + export/mapSnapshot.ts instead.
 *
 * Fully controlled: `facilities`/`facilityPace`/`chamberPace`/`echelonPlan`
 * are all read off `state` (MedWorkspaceState) rather than as separate
 * props — `groundRoutes`/`isochrone60` stay separate because, in every
 * known consumer, they're network-fetch results that live OUTSIDE
 * persisted state entirely (medplanner's own App.tsx keeps them in local
 * `useState`, never in its AppState). The one state write this widget makes
 * — picking a new target by clicking the map — patches only `targetLat`/
 * `targetLon`/`targetRaw` via `onPatch`; a host that also tracks suite-
 * handoff import metadata (medplanner's `importedFrom`) outside this slice
 * is responsible for clearing it in its own `onFetch` handler, since that
 * field is deliberately not part of MedWorkspaceState.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useCallback, useState } from 'react'
import type { FacilityRecord } from '../med/facilities/merge'
import type { IsochroneResult, RouteResult } from '../med/routing/ors'
import { LEG2_DROP_GROUND_DIST_M } from '../med/echelon'
import { addNorthArrow } from '../render/northArrow'
import { latLonToMgrs, inverse } from '../calc/geo'
import type { PaceLetter, FacilityPace } from '../med/pace'
import { formatTransit } from '../med/rank'
import { careLevelRoman, type CareTier } from '../med/careLevel'
import { placeLabels } from '../render/labelPlacement'
import type { MedWorkspaceState, MedWorkspacePatch } from '../med/workspaceState'

// Tier-to-colour mapping (fallback for non-PACE facilities)
function tierColor(tier: number): string {
  switch (tier) {
    case 4: return '#4caf50'
    case 3: return '#2196f3'
    case 2: return '#ff9800'
    default: return '#9e9e9e'
  }
}

// Lighter pastel text colors for legibility against the dark tinted badge fill
function tierTextColor(tier: number): string {
  switch (tier) {
    case 4: return '#a5d6a7'
    case 3: return '#90caf9'
    case 2: return '#ffcc80'
    default: return '#e0e0e0'
  }
}

// PACE letter colors — matches --pace-p/a/c/e CSS variables
function paceLetterColor(letter: PaceLetter): string {
  switch (letter) {
    case 'P': return '#4caf50'
    case 'A': return '#2196f3'
    case 'C': return '#ff9800'
    case 'E': return '#e53935'
  }
}

// Lighter pastel tints of PACE letter colors for badge text
function paceLetterTextColor(letter: PaceLetter): string {
  switch (letter) {
    case 'P': return '#a5d6a7'
    case 'A': return '#90caf9'
    case 'C': return '#ffcc80'
    case 'E': return '#ef9a9a'
  }
}

/** CSS tier badge character for divIcon — uses canonical Level roman numeral (or "NTC"). */
function tierBadge(tier: number): string {
  return careLevelRoman(tier as CareTier)
}

// Returns the PACE letter entry for a facility, or null if not in the plan
function paceEntryForFacility(facilityId: string, pace: FacilityPace | null): { letter: PaceLetter } | null {
  if (!pace) return null
  return pace.entries.find(e => e.facility.id === facilityId) ?? null
}

interface Props {
  state: MedWorkspaceState
  onPatch: MedWorkspacePatch
  groundRoutes: Record<string, RouteResult>
  isochrone60: IsochroneResult | null
  onFetch: (lat: number, lon: number) => void
}

export function MedMap({ state, onPatch, groundRoutes, isochrone60, onFetch }: Props) {
  const { facilities, facilityPace, chamberPace, echelonPlan } = state
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<any>(null)
  const layersRef    = useRef<any[]>([])
  const [mapReady, setMapReady] = useState(false)
  const [showAllFacilities, setShowAllFacilities] = useState(false)
  const [overrideZoom, setOverrideZoom] = useState<'pace' | 'echelon' | null>(null)
  const [pickingTarget, setPickingTarget] = useState(false)

  const hasTarget = state.targetLat !== 0 || state.targetLon !== 0

  // Reset echelon zoom when echelon plan disappears
  useEffect(() => {
    if (!echelonPlan && overrideZoom === 'echelon') setOverrideZoom(null)
  }, [echelonPlan, overrideZoom])

  const clearLayers = useCallback(() => {
    for (const l of layersRef.current) {
      try { l.remove() } catch { /* already removed */ }
    }
    layersRef.current = []
  }, [])

  const track = useCallback((layer: any) => {
    layersRef.current.push(layer)
    return layer
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    let L: any
    let map: any

    const init = async () => {
      L = await import('leaflet')
      await import('leaflet/dist/leaflet.css')

      // Patch L.Polyline to support { offset: N } — N pixels perpendicular to each segment.
      // Miter join with bevel fallback for sharp angles; no circular arcs that squiggle at
      // low zoom. Runs once; safe to re-apply (idempotent prototype write).
      ;(L as any).Polyline.include({
        _projectLatlngs(latlngs: any[], result: any[], projectedBounds: any) {
          const isFlat = latlngs.length > 0 && latlngs[0] instanceof (L as any).LatLng
          if (!isFlat) {
            latlngs.forEach((ll: any) => this._projectLatlngs(ll, result, projectedBounds))
            return
          }

          // Project all waypoints, extending bounds as we go.
          const rawPts: {x: number, y: number}[] = latlngs.map((ll: any) => {
            const p = this._map.latLngToLayerPoint(ll)
            if (projectedBounds) projectedBounds.extend(p)
            return p
          })

          const offset: number = this.options.offset ?? 0
          if (!offset || rawPts.length < 2) {
            result.push(rawPts.map((p: any) => (L as any).point(p.x, p.y)))
            return
          }

          // At low zoom many waypoints project to the same pixel or 1-2px apart.
          // Those micro-segments have direction vectors dominated by rounding noise,
          // which creates phantom 140°+ turns and large miter spikes (zigzags).
          // Deduplicate: keep interior points only when they're ≥ MIN_PX from the
          // previous kept point; always keep first and last.
          const MIN_PX = 3
          const pts: typeof rawPts = [rawPts[0]]
          for (let i = 1; i < rawPts.length - 1; i++) {
            const prev = pts[pts.length - 1]
            if (Math.hypot(rawPts[i].x - prev.x, rawPts[i].y - prev.y) >= MIN_PX) {
              pts.push(rawPts[i])
            }
          }
          pts.push(rawPts[rawPts.length - 1])

          // Max miter extension as a multiple of |offset|; beyond this, bevel instead.
          const MITER_LIMIT = 3
          const out: {x: number, y: number}[] = []

          for (let i = 0; i < pts.length; i++) {
            const p = pts[i]

            if (i === 0) {
              const dx = pts[1].x - p.x, dy = pts[1].y - p.y
              const len = Math.hypot(dx, dy)
              out.push(len ? { x: p.x - dy/len*offset, y: p.y + dx/len*offset } : p)
            } else if (i === pts.length - 1) {
              const prev = pts[i - 1]
              const dx = p.x - prev.x, dy = p.y - prev.y
              const len = Math.hypot(dx, dy)
              out.push(len ? { x: p.x - dy/len*offset, y: p.y + dx/len*offset } : p)
            } else {
              const prev = pts[i - 1], next = pts[i + 1]
              const dx1 = p.x - prev.x, dy1 = p.y - prev.y
              const dx2 = next.x - p.x,  dy2 = next.y - p.y
              const len1 = Math.hypot(dx1, dy1), len2 = Math.hypot(dx2, dy2)
              if (!len1 || !len2) { out.push(p); continue }

              // Unit normals (right-hand side of travel direction)
              const n1x = -dy1/len1, n1y = dx1/len1
              const n2x = -dy2/len2, n2y = dx2/len2
              const mx = n1x + n2x, my = n1y + n2y
              const mLen = Math.hypot(mx, my)

              if (mLen < 2 / MITER_LIMIT) {
                // Near-reversal: flat bevel — two points instead of a spike
                out.push({ x: p.x + n1x*offset, y: p.y + n1y*offset })
                out.push({ x: p.x + n2x*offset, y: p.y + n2y*offset })
              } else {
                // Miter: M = p + (2·offset / |m|²) · m
                const s = 2 * offset / (mLen * mLen)
                out.push({ x: p.x + mx*s, y: p.y + my*s })
              }
            }
          }

          result.push(out.map((pt) => (L as any).point(pt.x, pt.y)))
        }
      })

      if (mapRef.current) return   // already initialised

      delete (L.Icon.Default.prototype as any)._getIconUrl

      map = (L as any).map(containerRef.current!, {
        center: hasTarget ? [state.targetLat, state.targetLon] : [39, -98],
        zoom: hasTarget ? 9 : 4,
        zoomControl: true,
        attributionControl: false,
        preferCanvas: true,
      })
      mapRef.current = map

      // Esri World Imagery base tile layer (crossOrigin:true required for canvas export)
      ;(L as any).tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: '', maxZoom: 18, crossOrigin: true }
      ).addTo(map)

      // Semi-transparent reference/labels overlay
      ;(L as any).tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { attribution: '', maxZoom: 18, crossOrigin: true, opacity: 0.5 }
      ).addTo(map)

      addNorthArrow(L, map)
      setMapReady(true)
    }

    void init()

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One-shot map-click-to-set-target when pick mode is armed
  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current
    if (!mapReady || !map || !container) return

    if (!pickingTarget) {
      container.style.cursor = ''
      return
    }

    container.style.cursor = 'crosshair'

    const handler = (e: any) => {
      const { lat, lng } = e.latlng
      const mgrs = latLonToMgrs(lat, lng)
      onPatch({ targetLat: lat, targetLon: lng, targetRaw: mgrs })
      onFetch(lat, lng)
      setPickingTarget(false)
    }

    map.on('click', handler)
    return () => {
      map.off('click', handler)
      container.style.cursor = ''
    }
  }, [mapReady, pickingTarget, onPatch, onFetch])

  // Redraw layers when data changes
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    clearLayers()
    if (!hasTarget) return

    const drawAsync = async () => {
      const L = await import('leaflet')

      // Wide invisible hit-target behind every route so tooltips are easy to trigger.
      const addRoute = (
        pts: [number, number][],
        visOpts: Record<string, unknown>,
        tip: string,
        tipOpts: Record<string, unknown> = { permanent: false, direction: 'center' },
      ) => {
        track((L as any).polyline(pts, { ...visOpts, interactive: false })).addTo(map)
        track((L as any).polyline(pts, { color: visOpts.color, weight: 20, opacity: 0, offset: visOpts.offset }))
          .addTo(map)
          .bindTooltip(tip, tipOpts)
      }

      const targetLL      = { lat: state.targetLat, lon: state.targetLon }
      const compactLabels = overrideZoom === 'echelon'

      // ── Isochrone (60-min reachable shading) ──────────────────────────────
      if (isochrone60 && state.showIsochrone) {
        const isoLayer = (L as any).geoJSON(isochrone60.geometry, {
          style: {
            fillColor: '#4caf50',
            fillOpacity: 0.08,
            color: '#4caf50',
            weight: 1.5,
            dashArray: '4 4',
          },
        })
        track(isoLayer).addTo(map)

        // Label at the northernmost vertex of the isochrone polygon
        const ring = isochrone60.geometry.coordinates[0] as [number, number][]
        const north = ring.reduce((best, pt) => pt[1] > best[1] ? pt : best, ring[0])
        track((L as any).marker([north[1], north[0]], {
          icon: (L as any).divIcon({
            className: '',
            html: `<span style="
              display:inline-block;
              transform:translate(-50%,4px);
              font-size:10px;font-weight:600;
              color:#4caf50;opacity:0.8;
              white-space:nowrap;letter-spacing:0.04em;
              text-shadow:0 0 4px #000,0 0 4px #000,0 0 4px #000;
            ">60 MIN GROUND</span>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          interactive: false,
        })).addTo(map)
      }

      // ── Target marker ──────────────────────────────────────────────────────
      const targetIcon = (L as any).divIcon({
        className: '',
        html: `<div style="
          width:14px;height:14px;border-radius:50%;
          background:#ffcc02;border:2px solid #fff;
          box-shadow:0 0 0 2px #ffcc02;
        "></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })

      track((L as any).marker([targetLL.lat, targetLL.lon], { icon: targetIcon }))
        .addTo(map)
        .bindTooltip('Target Area', { permanent: false, direction: 'top' })

      // ── Facility markers + ground routes + helo routes ────────────────────
      const bounds: [number, number][] = [[targetLL.lat, targetLL.lon]]

      // Pre-compute PACE IDs for filtering and highlight logic
      const paceIds = new Set(facilityPace?.entries.map(e => e.facility.id) ?? [])

      // Echelon node IDs — always rendered regardless of showAllFacilities
      const echelonIds = new Set<string>()
      if (echelonPlan) {
        echelonIds.add(echelonPlan.stabilizeAt.id)
        echelonIds.add(echelonPlan.definitive.id)
      }

      // Chamber primary facility — always rendered when dive mode is active.
      // Only the P slot is shown on the map; A/C/E chamber slots stay out of imagery.
      const chamberPrimaryId = chamberPace?.entries.find(e => e.letter === 'P')?.facility.id ?? null

      // By default only show PACE facilities + echelon nodes + chamber primary; toggle reveals all discovered ones
      const visibleFacilities = showAllFacilities
        ? facilities
        : facilities.filter(f => paceIds.has(f.id) || echelonIds.has(f.id) || f.id === chamberPrimaryId)

      // Assign pixel offsets so routes sharing the same road appear side by side.
      // Echelon definitive is excluded — it only receives the Leg-2 line, not a POI→target route.
      const routingFacilities = visibleFacilities.filter(f => f.id !== echelonPlan?.definitive.id)
      const routeCount = routingFacilities.length
      const facOffsets = new Map<string, number>(
        routingFacilities.map((f, i) => [
          f.id,
          routeCount <= 1 ? 0 : (i - (routeCount - 1) / 2) * 4,
        ])
      )

      // Phase 1: dot anchor markers + routes; collect label metadata for the placement pass.
      const labelQueue: Array<{
        fac: FacilityRecord
        isPace: boolean
        color: string
        textColor: string
        labelText: string
        labelW: number
        labelH: number
      }> = []

      for (const fac of visibleFacilities) {
        const badge     = tierBadge(fac.tier)
        const paceEntry = paceEntryForFacility(fac.id, facilityPace)
        const isPace    = paceIds.has(fac.id)

        // Chamber primary: only the P slot is shown. If it also deduped into a hospital
        // that is already in the PACE plan, the isChamberPrimary branch overrides its
        // standard label so the medic sees a single two-color marker rather than two.
        const isChamberPrimary = fac.id === chamberPrimaryId

        // Chamber primary always renders in P-green + cyan ring, even if the underlying
        // facility also occupies a hospital PACE slot (edge case: chamber deduped into a
        // hospital already selected as Alternate/Contingency etc). The CHMBR label takes
        // visual precedence so the medic sees one consistent two-color marker.
        const effectiveColor     = isChamberPrimary
          ? paceLetterColor('P')
          : isPace && paceEntry ? paceLetterColor(paceEntry.letter) : tierColor(fac.tier)
        const effectiveTextColor = isChamberPrimary
          ? paceLetterTextColor('P')
          : isPace && paceEntry ? paceLetterTextColor(paceEntry.letter) : tierTextColor(fac.tier)

        const shortName = fac.name.length > 20 ? fac.name.slice(0, 18) + '…' : fac.name
        const badgeSuffix = badge === 'NTC' ? badge : `L${badge}`
        const labelText = isChamberPrimary
          ? (compactLabels ? 'P' : `[P] ${shortName} CHMBR`)
          : (isPace && paceEntry)
            ? (compactLabels ? paceEntry.letter : `[${paceEntry.letter}] ${shortName} ${badgeSuffix}`)
            : `Lvl ${badge}`
        // Treat chamber primary same as PACE for sizing
        const isHighlighted = isPace || isChamberPrimary
        const charPx    = isHighlighted ? 7 : 5.8
        const labelW    = Math.round(labelText.length * charPx + 10)
        const labelH    = isHighlighted ? 18 : 16

        const transit = state.rankResult?.ranked.find(r => r.facility.id === fac.id)?.transit
        const groundS = transit?.groundDurationS ?? groundRoutes[fac.id]?.durationS ?? null
        const heloS   = state.rotaryWingAvailable && fac.hasHelipad ? (transit?.heloDurationS ?? null) : null

        const tooltipHtml = [
          `<b>${fac.name}</b>`,
          isChamberPrimary ? 'Hyperbaric Chamber (PACE Primary)' : `Level ${badge}${fac.beds > 0 ? ` | Beds: ${fac.beds}` : ''}`,
          groundS !== null ? `Ground: ${formatTransit(groundS)}` : null,
          heloS   !== null ? `Helo: ${formatTransit(heloS)}`     : null,
          fac.hasHelipad ? 'Helipad: Yes' : 'Helipad: No',
          fac.phone   ? `Ph: ${fac.phone}` : null,
          fac.address ? fac.address        : null,
        ].filter(Boolean).join('<br>')

        // Small dot: the interactive hover/click target carrying the tooltip.
        // Chamber primary gets a cyan outer ring (box-shadow) over the standard green dot.
        const dotDiam = isHighlighted ? 12 : 8
        const dotIcon = (L as any).divIcon({
          className: '',
          html: `<div style="
            width:${dotDiam}px;height:${dotDiam}px;border-radius:50%;
            background:${effectiveColor};border:2px solid #fff;
            box-shadow:0 0 0 2px ${effectiveColor}${isChamberPrimary ? ', 0 0 0 4px #00bcd4' : ''};
            ${fac.isCustom && !isChamberPrimary ? 'filter:drop-shadow(0 0 3px ' + effectiveColor + ');' : ''}
          "></div>`,
          iconSize:   [dotDiam, dotDiam],
          iconAnchor: [dotDiam / 2, dotDiam / 2],
        })

        track((L as any).marker([fac.lat, fac.lon], { icon: dotIcon }))
          .addTo(map)
          .bindTooltip(tooltipHtml, { permanent: false, direction: 'top', className: 'leaflet-tooltip' })

        bounds.push([fac.lat, fac.lon])
        labelQueue.push({ fac, isPace: isHighlighted, color: effectiveColor, textColor: effectiveTextColor, labelText, labelW, labelH })

        // Standard POI-origin routes are suppressed for the echelon definitive
        // node — the Leg-2 echelon line (stabilize → definitive) is the correct
        // representation; drawing a direct POI → Level I line is misleading.
        const isEchelonDef = echelonPlan?.definitive.id === fac.id

        if (!isEchelonDef) {
          const routeOffset = facOffsets.get(fac.id) ?? 0
          // Ground route polyline
          const route = groundRoutes[fac.id]
          if (route && route.polyline.length > 1) {
            const latlngs = route.polyline.map(([lon, lat]) => [lat, lon] as [number, number])
            addRoute(latlngs, {
              color: effectiveColor,
              weight: route.estimated ? 1.5 : 2.5,
              dashArray: route.estimated ? '6 4' : undefined,
              opacity: 0.8,
              offset: routeOffset,
            }, `Ground: ${formatTransit(route.durationS)}${route.estimated ? ' (est.)' : ''}`)
            bounds.push(...latlngs)
          } else if (!fac.hasHelipad || !state.rotaryWingAvailable) {
            addRoute(
              [[targetLL.lat, targetLL.lon], [fac.lat, fac.lon]],
              { color: effectiveColor, weight: 1.5, dashArray: '4 8', opacity: 0.45, offset: routeOffset },
              'Ground route (est.)',
            )
          }

          if (state.rotaryWingAvailable && fac.hasHelipad) {
            addRoute(
              [[targetLL.lat, targetLL.lon], [fac.lat, fac.lon]],
              { color: effectiveColor, weight: 2.5, dashArray: '3 5', opacity: 0.6, offset: routeOffset },
              'Helo route (direct)',
            )
          }
        }
      }

      // ── Echelon Leg-2 route (stabilize → definitive) ─────────────────────────
      // Drawn on top of the standard facility routes so the two-leg flow is clear.
      if (echelonPlan) {
        const [leg1, leg2] = echelonPlan.legs
        const stab = echelonPlan.stabilizeAt
        const def  = echelonPlan.definitive

        // Leg-2 colour: amber for civilian handoff (training), teal for operational
        const leg2Color = echelonPlan.environment === 'training' ? '#ff9800' : '#26c6da'

        // Ground route for Leg-2 if available
        const leg2Key   = `leg2:${stab.id}->${def.id}`
        const leg2Route = groundRoutes[leg2Key]
        const leg2NoteSuffix = leg2.notes?.length ? ` (${leg2.notes.join('; ')})` : ''
        // Build a combined transit label showing all available air times
        // so fixed-wing and rotary times appear on the single Leg-2 line.
        const heloTimeStr = leg2.transit.heloDurationS != null ? formatTransit(leg2.transit.heloDurationS) : null
        const fwTimeStr   = leg2.transit.fixedWingDurationS != null ? formatTransit(leg2.transit.fixedWingDurationS) : null
        const airTimeParts: string[] = []
        if (heloTimeStr) airTimeParts.push(`Helo: ${heloTimeStr}`)
        if (fwTimeStr)   airTimeParts.push(`C-130: ${fwTimeStr}`)
        const airTimeLabel = airTimeParts.length > 0 ? airTimeParts.join(' / ') : formatTransit(leg2.transit.effectiveDurationS)

        if (leg2.mode === 'rotary') {
          // Flying route: geodesic regardless of whether a ground route was also fetched.
          // Ground time is shown in the tooltip as supplementary info when available.
          const groundDurS = leg2.transit.groundDurationS ?? leg2Route?.durationS
          const groundSuffix = groundDurS ? ` / Ground: ${formatTransit(groundDurS)}` : ''
          addRoute(
            [[stab.lat, stab.lon], [def.lat, def.lon]],
            { color: leg2Color, weight: 2.5, dashArray: '4 6', opacity: 0.8 },
            `${leg2.assetLabel} — ${airTimeLabel} (direct)${groundSuffix}${leg2NoteSuffix}`,
          )
        } else if (leg2.mode === 'fixed-wing') {
          // Long-haul fixed-wing (C-130): geodesic line, airfield note in tooltip
          addRoute(
            [[stab.lat, stab.lon], [def.lat, def.lon]],
            { color: '#ba68c8', weight: 2, dashArray: '6 5', opacity: 0.75 },
            `${leg2.assetLabel} — ${airTimeLabel} (airfield TBD)${leg2NoteSuffix}`,
          )
        } else {
          // Ground mode (civilian EMS in training, or no helipads in operational).
          // Beyond the threshold, driving this distance is impractical — draw a
          // geodesic regardless. Under the threshold, use the ORS road polyline.
          const leg2DistM = inverse({ lat: stab.lat, lon: stab.lon }, { lat: def.lat, lon: def.lon }).distM
          if (leg2DistM > LEG2_DROP_GROUND_DIST_M) {
            // Long haul: straight-line geodesic with ground time label when available
            const groundDurS = leg2.transit.groundDurationS ?? leg2Route?.durationS
            const timeLabel = groundDurS
              ? formatTransit(groundDurS)
              : formatTransit(leg2.transit.effectiveDurationS)
            addRoute(
              [[stab.lat, stab.lon], [def.lat, def.lon]],
              { color: leg2Color, weight: 1.5, dashArray: '4 8', opacity: 0.55 },
              `${leg2.assetLabel} — ${timeLabel}${leg2NoteSuffix}`,
            )
          } else if (leg2Route && leg2Route.polyline.length > 1) {
            // Near ground transfer: draw the ORS road polyline (solid)
            const latlngs = leg2Route.polyline.map(([lon, lat]) => [lat, lon] as [number, number])
            const groundStr = formatTransit(leg2.transit.groundDurationS ?? leg2Route.durationS)
            const groundLabel = heloTimeStr ? `Ground: ${groundStr} / ${airTimeLabel}` : `Ground: ${groundStr}`
            addRoute(latlngs, {
              color: leg2Color, weight: 2.5, opacity: 0.85,
            }, `${leg2.assetLabel} — ${groundLabel}${leg2NoteSuffix}`)
          } else {
            // No ORS route: geodesic fallback
            addRoute(
              [[stab.lat, stab.lon], [def.lat, def.lon]],
              { color: leg2Color, weight: 1.5, dashArray: '4 8', opacity: 0.55 },
              `${leg2.assetLabel} — ${formatTransit(leg2.transit.effectiveDurationS)}${leg2NoteSuffix}`,
            )
          }
        }

        // Leg-1 label on the midpoint of the stabilize-facility route
        const leg1Route = groundRoutes[stab.id]
        if (leg1Route && leg1Route.polyline.length > 1) {
          const mid = leg1Route.polyline[Math.floor(leg1Route.polyline.length / 2)]
          if (mid) {
            const midIcon = (L as any).divIcon({
              className: '',
              html: `<div style="
                background:#4caf5088;border:1px solid #4caf50;border-radius:2px;
                padding:1px 4px;font-family:monospace;font-size:9px;font-weight:700;
                color:#a5d6a7;white-space:nowrap;
              ">Leg1: ${leg1.assetLabel}</div>`,
              iconSize: null as any, iconAnchor: [0, 0],
            })
            track((L as any).marker([mid[1], mid[0]], { icon: midIcon, interactive: false })).addTo(map)
          }
        }

        // Ensure echelon facilities are added to bounds
        bounds.push([stab.lat, stab.lon])
        bounds.push([def.lat, def.lon])
      }

      // Fit bounds (no animation so pixel coords are settled before label placement).
      // Route polylines are included in every branch so that detour roads that go
      // beyond the facility endpoint don't fall outside the viewport.
      const routeLatLngs = (key: string): [number, number][] =>
        (groundRoutes[key]?.polyline ?? []).map(([lon, lat]) => [lat, lon] as [number, number])

      let zoomBounds: [number, number][]
      if (overrideZoom === 'echelon' && echelonPlan) {
        const leg2Key = `leg2:${echelonPlan.stabilizeAt.id}->${echelonPlan.definitive.id}`
        zoomBounds = [
          [targetLL.lat, targetLL.lon],
          [echelonPlan.definitive.lat, echelonPlan.definitive.lon],
          ...routeLatLngs(echelonPlan.stabilizeAt.id),
          ...routeLatLngs(leg2Key),
        ]
      } else if (facilityPace && facilityPace.entries.length > 0) {
        // Default and explicit 'pace' override: fit to PACE facilities only
        zoomBounds = [
          [targetLL.lat, targetLL.lon],
          ...facilityPace.entries.flatMap(e => [
            [e.facility.lat, e.facility.lon] as [number, number],
            ...routeLatLngs(e.facility.id),
          ]),
        ]
      } else {
        zoomBounds = bounds
      }
      const padAmt = overrideZoom === 'echelon' ? 0.15 : 0.1
      if (zoomBounds.length > 1) {
        map.fitBounds((L as any).latLngBounds(zoomBounds).pad(padAmt), { animate: false })
      } else if (hasTarget) {
        map.setView([state.targetLat, state.targetLon], 9)
      }

      // Phase 2: collision-avoided label markers.
      // Leaflet screen position: element_TL = containerPoint − iconAnchor
      // So to place a label TL at solved position pl: iconAnchor = containerPoint − pl
      if (labelQueue.length > 0) {
        const sz = map.getSize()

        const placementItems = labelQueue.map(({ fac, labelW, labelH, isPace }) => {
          const pt = map.latLngToContainerPoint([fac.lat, fac.lon])
          return {
            anchor:   { x: pt.x as number, y: pt.y as number },
            box:      { w: labelW, h: labelH },
            variant:  'icon' as const,
            priority: isPace ? 1 : 0,
          }
        })

        const dotObstacles = labelQueue.map(({ fac }) => {
          const pt = map.latLngToContainerPoint([fac.lat, fac.lon])
          return { x: pt.x as number, y: pt.y as number, r: 8 }
        })

        const placements = placeLabels(placementItems, dotObstacles, { w: sz.x, h: sz.y })

        for (let i = 0; i < labelQueue.length; i++) {
          const { fac, isPace, color, textColor, labelText } = labelQueue[i]
          const isChamberLabel = fac.id === chamberPrimaryId
          const pt = map.latLngToContainerPoint([fac.lat, fac.lon])
          const pl = placements[i]

          const anchorX = Math.round((pt.x as number) - pl.x)
          const anchorY = Math.round((pt.y as number) - pl.y)

          // Chamber primary: green inner badge + solid cyan outer ring (outline: 2px #00bcd4).
          // The outline property gives a real outer border without expanding the layout box.
          const labelIcon = (L as any).divIcon({
            className: '',
            html: `<div style="
              display:inline-block;
              background:${color}${isPace ? '66' : '22'};
              border:${isPace ? '2.5px' : '1.5px'} solid ${color};
              border-radius:3px;padding:1px 4px;
              font-family:monospace;font-size:${isPace ? 11 : 9}px;font-weight:700;
              color:${textColor};white-space:nowrap;opacity:1;
              ${isChamberLabel ? 'outline:2px solid #00bcd4;outline-offset:1px;' : ''}
              ${fac.isCustom && !isChamberLabel ? 'box-shadow:0 0 4px ' + color + ';' : ''}
            ">${labelText}</div>`,
            iconSize:   null as any,
            iconAnchor: [anchorX, anchorY],
          })

          track((L as any).marker([fac.lat, fac.lon], { icon: labelIcon, interactive: false }))
            .addTo(map)
        }
      }
    }

    void drawAsync()
  }, [
    mapReady,
    state.targetLat, state.targetLon, state.showIsochrone, state.rotaryWingAvailable,
    facilities, facilityPace, chamberPace, groundRoutes, isochrone60, echelonPlan,
    showAllFacilities, overrideZoom,
    clearLayers, hasTarget, track,
  ])

  const paceCount = facilityPace?.entries.length ?? 0

  return (
    <div className="map-outer">
      <div className="map-toolbar">
        <button
          className={`btn btn-sm${pickingTarget ? ' btn-active' : ''}`}
          onClick={() => setPickingTarget(v => !v)}
          title="Click a point on the map to set a new target area and load facilities"
          style={{ flexShrink: 0 }}
        >
          {pickingTarget ? 'CLICK MAP…' : 'SET NEW TGT'}
        </button>
        <span className="dim mono" style={{ fontSize: 11, flex: 1 }}>
          {pickingTarget
            ? 'Click the map to set a new target area'
            : hasTarget
              ? `TGT: ${latLonToMgrs(state.targetLat, state.targetLon)} — ${showAllFacilities ? facilities.length : paceCount} shown (${paceCount} in PACE)`
              : 'Enter target coordinates or click SET NEW TGT'}
        </span>
        {hasTarget && paceCount > 0 && (
          <button
            className={`btn btn-sm${overrideZoom === 'pace' ? ' btn-active' : ''}`}
            onClick={() => setOverrideZoom(v => v === 'pace' ? null : 'pace')}
            title="Zoom to fit target and PACE facilities"
            style={{ flexShrink: 0 }}
          >
            FIT PACE
          </button>
        )}
        {hasTarget && echelonPlan && (
          <button
            className={`btn btn-sm${overrideZoom === 'echelon' ? ' btn-active' : ''}`}
            onClick={() => setOverrideZoom(v => v === 'echelon' ? null : 'echelon')}
            title="Zoom to fit target and Level I definitive care; compact PACE labels"
            style={{ flexShrink: 0 }}
          >
            TGT+LVL I
          </button>
        )}
        {hasTarget && facilities.length > 0 && (
          <button
            className={`btn btn-sm${showAllFacilities ? ' btn-active' : ''}`}
            onClick={() => setShowAllFacilities(v => !v)}
            title="Toggle between PACE-plan-only view and all discovered facilities"
            style={{ flexShrink: 0 }}
          >
            {showAllFacilities ? 'ALL FACILITIES' : 'PACE ONLY'}
          </button>
        )}
      </div>
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {!mapReady && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'monospace', fontSize: 13, color: '#6a9a6a', letterSpacing: 1,
          }}>
            Loading imagery…
          </div>
        )}
        <div className="map-container" ref={containerRef} style={{ flex: 1 }} />
      </div>
    </div>
  )
}
