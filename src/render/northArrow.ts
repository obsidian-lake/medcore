/**
 * North-seeking arrow overlay for Leaflet maps.
 *
 * Since all map views are north-up (no rotation), the arrow is static.
 * Placed in the bottom-right corner via a custom Leaflet control.
 *
 * Design: single north-pointing arrowhead, "N" label at the TOP (north end).
 * No south tail — avoids confusion with a bidirectional pointer.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const ARROW_HTML = `
<div style="
  width:36px; height:44px;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  background:rgba(13,26,13,0.65); border:1px solid rgba(255,255,255,0.25);
  border-radius:5px; padding:2px 0 3px;
  pointer-events:none; user-select:none;
">
  <span style="color:#ffffff;font-size:9px;font-family:monospace;font-weight:700;line-height:1;margin-bottom:2px;">N</span>
  <svg width="20" height="28" viewBox="0 0 20 28" xmlns="http://www.w3.org/2000/svg">
    <!-- North half: solid white, pointing up -->
    <polygon points="10,1 5,15 10,12" fill="#ffffff"/>
    <!-- South half: hollow / dim, pointing up on the right side -->
    <polygon points="10,1 15,15 10,12" fill="rgba(255,255,255,0.25)"/>
    <!-- Centre pin -->
    <circle cx="10" cy="13" r="2" fill="#ffffff"/>
    <!-- Tail: single downward stem (not an arrowhead — just a stem) -->
    <line x1="10" y1="15" x2="10" y2="27" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>
  </svg>
</div>
`

/**
 * Add a static north arrow control to the given Leaflet map.
 * Returns the control so the caller can remove it if needed.
 *
 * @param L   — Leaflet module (dynamic import)
 * @param map — Leaflet map instance
 */
export function addNorthArrow(L: any, map: any): any {
  const NorthArrowControl = L.Control.extend({
    onAdd(): HTMLElement {
      const container = L.DomUtil.create('div')
      container.innerHTML = ARROW_HTML.trim()
      L.DomEvent.disableClickPropagation(container)
      return container
    },
  })
  const ctrl = new NorthArrowControl({ position: 'bottomright' })
  ctrl.addTo(map)
  return ctrl
}

/** Draw a north arrow onto a Canvas 2D context (for PDF export via composeMapCanvas). */
export function drawNorthArrowCanvas(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  scale: number,
): void {
  // Dimensions (unscaled CSS px)
  const SIZE   = 36   // circle diameter
  const MARGIN = 10   // inset from corner
  const cx = canvasW * scale - (SIZE / 2 + MARGIN) * scale
  const cy = canvasH * scale - (SIZE / 2 + MARGIN + 6) * scale  // shift up for "N" label

  const r  = (SIZE / 2) * scale
  const hw = 5 * scale    // half-width of arrow wedge
  const ah = 12 * scale   // arrow half-height (tip to waist)
  const pr = 2 * scale    // pivot radius

  ctx.save()

  // Background circle
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, 2 * Math.PI)
  ctx.fillStyle = 'rgba(13,26,13,0.65)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = scale
  ctx.stroke()

  // North wedge left half (solid white, pointing up)
  ctx.beginPath()
  ctx.moveTo(cx, cy - ah)       // tip
  ctx.lineTo(cx - hw, cy + 2)   // bottom-left
  ctx.lineTo(cx, cy - pr)       // waist
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  // North wedge right half (slightly dim)
  ctx.beginPath()
  ctx.moveTo(cx, cy - ah)
  ctx.lineTo(cx + hw, cy + 2)
  ctx.lineTo(cx, cy - pr)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  ctx.fill()

  // Centre pivot
  ctx.beginPath()
  ctx.arc(cx, cy - pr, pr, 0, 2 * Math.PI)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  // Tail stem (not an arrowhead — just a line downward)
  ctx.beginPath()
  ctx.moveTo(cx, cy + 2)
  ctx.lineTo(cx, cy + ah)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1.5 * scale
  ctx.stroke()

  // "N" label ABOVE the arrow (north end)
  const fontSize = 9 * scale
  ctx.font        = `700 ${fontSize}px monospace`
  ctx.fillStyle   = '#ffffff'
  ctx.textAlign   = 'center'
  ctx.textBaseline = 'bottom'
  ctx.shadowColor  = 'rgba(0,0,0,0.7)'
  ctx.shadowBlur   = 3 * scale
  ctx.fillText('N', cx, cy - ah - 2 * scale)

  ctx.restore()
}
