/**
 * Leaflet polyline pixel-offset support.
 *
 * When several routes leave the same point and share a road for part of their
 * length (e.g. two facilities served by the same highway), drawing them with
 * plain polylines stacks them exactly on top of each other and only the
 * topmost color is visible. This patches L.Polyline to support an
 * `{ offset: N }` option — N pixels perpendicular to each segment — so
 * coincident routes render side by side instead.
 *
 * Ported from medplanner's interactive MapScreen so the exported map imagery
 * (which is the canonical PACE-plan deliverable) matches what operators see
 * on the live map.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Default pixel gap between adjacent offset routes. */
export const DEFAULT_OFFSET_GAP_PX = 4

/**
 * Patch L.Polyline to support an `{ offset: N }` option — N pixels
 * perpendicular to each segment. Miter join with bevel fallback for sharp
 * angles; no circular arcs that squiggle at low zoom. Idempotent — safe to
 * call multiple times against the same Leaflet module.
 */
export function applyPolylineOffsetPatch(L: any): void {
  ;(L as any).Polyline.include({
    _projectLatlngs(latlngs: any[], result: any[], projectedBounds: any) {
      const isFlat = latlngs.length > 0 && latlngs[0] instanceof (L as any).LatLng
      if (!isFlat) {
        latlngs.forEach((ll: any) => this._projectLatlngs(ll, result, projectedBounds))
        return
      }

      // Project all waypoints, extending bounds as we go.
      const rawPts: { x: number; y: number }[] = latlngs.map((ll: any) => {
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
      const out: { x: number; y: number }[] = []

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]

        if (i === 0) {
          const dx = pts[1].x - p.x, dy = pts[1].y - p.y
          const len = Math.hypot(dx, dy)
          out.push(len ? { x: p.x - dy / len * offset, y: p.y + dx / len * offset } : p)
        } else if (i === pts.length - 1) {
          const prev = pts[i - 1]
          const dx = p.x - prev.x, dy = p.y - prev.y
          const len = Math.hypot(dx, dy)
          out.push(len ? { x: p.x - dy / len * offset, y: p.y + dx / len * offset } : p)
        } else {
          const prev = pts[i - 1], next = pts[i + 1]
          const dx1 = p.x - prev.x, dy1 = p.y - prev.y
          const dx2 = next.x - p.x, dy2 = next.y - p.y
          const len1 = Math.hypot(dx1, dy1), len2 = Math.hypot(dx2, dy2)
          if (!len1 || !len2) { out.push(p); continue }

          // Unit normals (right-hand side of travel direction)
          const n1x = -dy1 / len1, n1y = dx1 / len1
          const n2x = -dy2 / len2, n2y = dx2 / len2
          const mx = n1x + n2x, my = n1y + n2y
          const mLen = Math.hypot(mx, my)

          if (mLen < 2 / MITER_LIMIT) {
            // Near-reversal: flat bevel — two points instead of a spike
            out.push({ x: p.x + n1x * offset, y: p.y + n1y * offset })
            out.push({ x: p.x + n2x * offset, y: p.y + n2y * offset })
          } else {
            // Miter: M = p + (2·offset / |m|²) · m
            const s = 2 * offset / (mLen * mLen)
            out.push({ x: p.x + mx * s, y: p.y + my * s })
          }
        }
      }

      result.push(out.map((pt) => (L as any).point(pt.x, pt.y)))
    },
  })
}

/**
 * Assign symmetric pixel offsets to a list of route IDs so routes sharing the
 * same road render side by side instead of stacked on top of each other.
 * IDs are centered around zero in list order (e.g. 3 IDs at gapPx=4 → -4, 0, 4).
 */
export function assignRouteOffsets(ids: string[], gapPx: number = DEFAULT_OFFSET_GAP_PX): Map<string, number> {
  const n = ids.length
  return new Map(ids.map((id, i) => [id, n <= 1 ? 0 : (i - (n - 1) / 2) * gapPx]))
}
