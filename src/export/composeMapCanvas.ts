/**
 * Canvas compositor for Leaflet maps — replaces html2canvas for map content.
 *
 * Verbatim transplant from MFFJM app/src/export/composeMapCanvas.ts.
 * Part of @pipehitter/medcore — shared med planning library.
 *
 * See MFFJM original for full algorithm documentation.
 * NOTE: Couples to Leaflet 1.9.x private APIs. Check Leaflet changelog before
 * upgrading past 1.9.x — composeMapCanvas.test.ts will fail loudly.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { MapLabel } from '../types/mapLabel'
import { drawNorthArrowCanvas } from '../render/northArrow'
import { placeLabels, type PlacementItem, type Obstacle } from '../render/labelPlacement'

export interface Arrow {
  lat: number
  lon: number
  angleDeg: number
  color: string
}

export interface ComposeOptions {
  width: number
  height: number
  scale?: number
  labels: MapLabel[]
  arrows?: Arrow[]
  backgroundColor?: string
  /** Set false to suppress the north-arrow overlay (e.g. for inset tiles). Default true. */
  northArrow?: boolean
}

export const LABEL_BOX = {
  padH: 5,
  padV: 2,
  radius: 3,
  capRatio: 0.72,
}

export const LABEL_LEADER = { dx: 14, dy: 14 }

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

export function composeMapCanvas(
  L: any,
  map: any,
  opts: ComposeOptions,
): HTMLCanvasElement {
  const { width: W, height: H, scale = 2, labels, arrows = [], backgroundColor = '#1a1a1a' } = opts

  const canvas = document.createElement('canvas')
  canvas.width  = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, W * scale, H * scale)

  // Layer 1: Tiles
  map.eachLayer((layer: any) => {
    if (typeof layer._tiles === 'undefined') return

    const tileSize = layer.getTileSize?.() ?? L.point(256, 256)
    const tsX = tileSize.x as number
    const tsY = tileSize.y as number

    for (const key of Object.keys(layer._tiles)) {
      const tile = layer._tiles[key]
      const img: HTMLImageElement = tile?.el

      if (!img || !img.complete || img.naturalWidth === 0) continue

      const coords   = layer._keyToTileCoords(key)
      const projPt   = (coords as any).scaleBy(tileSize)
      const pxOrigin = map.getPixelOrigin()
      const layerPt  = { x: projPt.x - pxOrigin.x, y: projPt.y - pxOrigin.y }
      const tl: { x: number; y: number } = map.layerPointToContainerPoint(layerPt)

      const dx = Math.round(tl.x * scale)
      const dy = Math.round(tl.y * scale)
      const dw = tsX * scale
      const dh = tsY * scale

      if (dx + dw < 0 || dy + dh < 0 || dx > W * scale || dy > H * scale) continue

      try {
        ctx.drawImage(img, dx, dy, dw, dh)
      } catch {
        console.warn('[composeMapCanvas] Tile drawImage failed — check crossOrigin on tile layer')
      }
    }
  })

  // Layer 2: Vector renderer
  const seenRenderers = new Set<HTMLCanvasElement>()
  const blitRenderer = (renderer: any) => {
    const rCanvas: HTMLCanvasElement | undefined = renderer?._container
    const bounds = renderer?._bounds
    if (!rCanvas || !bounds || seenRenderers.has(rCanvas)) return
    seenRenderers.add(rCanvas)
    const min  = bounds.min
    const size = bounds.getSize()
    const ctl  = map.layerPointToContainerPoint(min)
    try {
      ctx.drawImage(rCanvas, ctl.x * scale, ctl.y * scale, size.x * scale, size.y * scale)
    } catch {
      console.warn('[composeMapCanvas] Vector renderer blit failed')
    }
  }
  map.eachLayer((layer: any) => {
    if (typeof layer._tiles !== 'undefined') return
    if (layer._renderer) { blitRenderer(layer._renderer); return }
    if (typeof layer.getLatLng === 'function' && !(layer.options?.icon)) {
      try { blitRenderer(map.getRenderer(layer)) } catch { /* no renderer */ }
    }
  })

  // Layer 3: Labels
  const PAD_H  = LABEL_BOX.padH  * scale
  const PAD_V  = LABEL_BOX.padV  * scale
  const RADIUS = LABEL_BOX.radius * scale
  const LDX    = LABEL_LEADER.dx  * scale
  const LDY    = LABEL_LEADER.dy  * scale

  if (labels.length > 0) {
    interface LblMeta {
      px: number; py: number
      isIcon: boolean; fontSize: number; fontWeight: string
      capH: number; boxW: number; boxH: number
    }
    const meta: LblMeta[] = labels.map(lbl => {
      const p: { x: number; y: number } = map.latLngToContainerPoint(L.latLng(lbl.lat, lbl.lon))
      const isIcon     = lbl.variant === 'icon'
      const fontSize   = (isIcon ? 13 : 12) * scale
      const fontWeight = isIcon ? '700' : '600'
      const capH       = fontSize * LABEL_BOX.capRatio
      ctx.font = `${fontWeight} ${fontSize}px monospace`
      const textW = ctx.measureText(lbl.text).width
      return {
        px: p.x * scale, py: p.y * scale,
        isIcon, fontSize, fontWeight, capH,
        boxW: textW + PAD_H * 2,
        boxH: capH  + PAD_V * 2,
      }
    })

    const items: PlacementItem[] = labels.map((lbl, i) => ({
      anchor:   { x: meta[i].px, y: meta[i].py },
      box:      { w: meta[i].boxW, h: meta[i].boxH },
      variant:  lbl.variant,
      priority: lbl.variant === 'icon' ? 1 : 0,
    }))

    const DOT_R   = 8
    const obstacles: Obstacle[] = [
      ...labels
        .filter(lbl => lbl.variant === 'icon')
        .map(lbl => {
          const p: { x: number; y: number } = map.latLngToContainerPoint(L.latLng(lbl.lat, lbl.lon))
          return { x: p.x * scale, y: p.y * scale, r: DOT_R }
        }),
      ...arrows.map(a => {
        const p: { x: number; y: number } = map.latLngToContainerPoint(L.latLng(a.lat, a.lon))
        return { x: p.x * scale, y: p.y * scale, r: DOT_R }
      }),
    ]

    const placements = placeLabels(items, obstacles, { w: W * scale, h: H * scale }, LDX, LDY)

    for (let idx = 0; idx < labels.length; idx++) {
      const lbl = labels[idx]
      const { px, py, isIcon, fontSize, fontWeight, capH, boxW, boxH } = meta[idx]
      const placement = placements[idx]
      const bx = Math.round(placement.x)
      const by = Math.round(placement.y)

      if (isIcon && placement.leaderTo) {
        const ltx = Math.round(placement.leaderTo.x)
        const lty = Math.round(placement.leaderTo.y)
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(ltx, lty)
        ctx.strokeStyle = lbl.color
        ctx.globalAlpha = 0.75
        ctx.lineWidth = 1 * scale
        ctx.stroke()
        ctx.restore()
      }

      ctx.save()
      roundedRect(ctx, bx, by, boxW, boxH, RADIUS)
      ctx.fillStyle = isIcon ? 'rgba(13,26,13,0.35)' : 'rgba(13,26,13,0.4)'
      ctx.fill()
      ctx.strokeStyle = lbl.color
      ctx.lineWidth = 1 * scale
      ctx.stroke()
      ctx.restore()

      // Optional outer ring for two-color labels (e.g. dive-cyan ring on chamber primary).
      // Stroke a slightly expanded rounded rect so the ring sits just outside the main border.
      if (lbl.ringColor) {
        const expand = 2 * scale
        ctx.save()
        roundedRect(ctx, bx - expand, by - expand, boxW + expand * 2, boxH + expand * 2, RADIUS + expand)
        ctx.strokeStyle = lbl.ringColor
        ctx.lineWidth = 1.5 * scale
        ctx.stroke()
        ctx.restore()
      }

      ctx.save()
      ctx.font = `${fontWeight} ${fontSize}px monospace`
      ctx.fillStyle = lbl.color
      ctx.shadowColor = 'rgba(0,0,0,0.9)'
      ctx.shadowBlur  = isIcon ? 4 * scale : 3 * scale
      ctx.fillText(lbl.text, bx + PAD_H, by + PAD_V + capH)
      ctx.restore()
    }
  }

  // Layer 3b: Arrows
  for (const arrow of arrows) {
    const p: { x: number; y: number } = map.latLngToContainerPoint(L.latLng(arrow.lat, arrow.lon))
    const px = p.x * scale
    const py = p.y * scale
    const hw = 6 * scale
    const h  = 14 * scale
    const angleRad = (arrow.angleDeg * Math.PI) / 180
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(angleRad)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(-hw, h)
    ctx.lineTo(hw, h)
    ctx.closePath()
    ctx.fillStyle = arrow.color
    ctx.fill()
    ctx.restore()
  }

  // Layer 4: North arrow
  if (opts.northArrow !== false) drawNorthArrowCanvas(ctx, W, H, scale)

  return canvas
}
