/**
 * Greedy point-feature label-placement solver.
 *
 * Works in whatever 2-D pixel space the caller provides (scaled or unscaled —
 * the algorithm is scale-agnostic). Items are processed in descending priority
 * so higher-priority labels claim the best positions first.
 *
 * For each item the solver generates a set of candidate box positions (8
 * compass directions × 2 rings for 'icon' labels; a handful of centred /
 * above / below positions for 'label' labels), scores each candidate by the
 * area of overlap it has with already-placed boxes and obstacles, and commits
 * the lowest-cost candidate.  Earlier candidates carry a small base-cost
 * advantage so unobstructed labels keep their default appearance.
 *
 * Caller is responsible for:
 *  - Measuring box dimensions (ctx.measureText + padding) before calling.
 *  - Building the Obstacle list from dot centres, arrow tips, wind-V tips, etc.
 *  - Passing ldx/ldy in the SAME pixel units as PlacementItem.anchor.
 */

export interface PlacementItem {
  /** Coordinate of the dot / feature anchor (container px). */
  anchor: { x: number; y: number }
  /** Pre-measured box size including padding (container px). */
  box: { w: number; h: number }
  /** 'icon' = leader-line box (DIP/OP/…). 'label' = no-leader safety label. */
  variant: 'icon' | 'label'
  /**
   * Higher priority items are placed first and claim the best positions.
   * Defaults: 'icon' → 1, 'label' → 0.
   */
  priority?: number
}

export interface Obstacle {
  /** Centre of the obstacle in container px. */
  x: number
  y: number
  /** Half-side of the square obstacle footprint in container px. */
  r: number
}

export interface Placement {
  /** Box top-left in the same pixel space as PlacementItem.anchor. */
  x: number
  y: number
  /** 'icon' only: the point on the box edge where the leader line terminates. */
  leaderTo?: { x: number; y: number }
}

// ── Internal ──────────────────────────────────────────────────────────────────

interface Rect { x: number; y: number; w: number; h: number }
interface Candidate { rect: Rect; leaderTo?: { x: number; y: number } }

function overlapArea(a: Rect, b: Rect): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return ox * oy
}

function outOfBoundsArea(r: Rect, bw: number, bh: number): number {
  const lx = Math.max(0, -r.x)
  const rx = Math.max(0, r.x + r.w - bw)
  const ty = Math.max(0, -r.y)
  const by = Math.max(0, r.y + r.h - bh)
  // Over-counting corners is fine — just a penalty.
  return (lx + rx) * r.h + (ty + by) * r.w
}

/**
 * 8-compass × 2-ring candidates for 'icon' labels.
 *
 * ldx/ldy: the x and y offset (in the caller's pixel units) for the near ring
 * — i.e. the current LABEL_LEADER values (scaled if in compositor space).
 *
 * The NE (up-right) direction with the near ring is candidate 0 — the current
 * default — so isolated labels are unaffected by the solver.
 */
function iconCandidates(
  anchor: { x: number; y: number },
  box: { w: number; h: number },
  ldx: number,
  ldy: number,
): Candidate[] {
  const { w, h } = box
  const ax = anchor.x, ay = anchor.y
  const FAR = 1.7   // second-ring multiplier

  // [boxLeft, boxTop, leaderToX, leaderToY] — near ring
  const dirs: [number, number, number, number][] = [
    // 0  NE (default): box bottom-left is at (ax+ldx, ay-ldy)
    [ax + ldx,       ay - ldy - h,    ax + ldx,       ay - ldy      ],
    // 1  N: box bottom-centre at (ax, ay-ldy)
    [ax - w / 2,     ay - ldy - h,    ax,             ay - ldy      ],
    // 2  NW: box bottom-right at (ax-ldx, ay-ldy)
    [ax - ldx - w,   ay - ldy - h,    ax - ldx,       ay - ldy      ],
    // 3  E: box left-mid at (ax+ldx, ay)
    [ax + ldx,       ay - h / 2,      ax + ldx,       ay            ],
    // 4  W: box right-mid at (ax-ldx, ay)
    [ax - ldx - w,   ay - h / 2,      ax - ldx,       ay            ],
    // 5  SE: box top-left at (ax+ldx, ay+ldy)
    [ax + ldx,       ay + ldy,        ax + ldx,       ay + ldy      ],
    // 6  S: box top-centre at (ax, ay+ldy)
    [ax - w / 2,     ay + ldy,        ax,             ay + ldy      ],
    // 7  SW: box top-right at (ax-ldx, ay+ldy)
    [ax - ldx - w,   ay + ldy,        ax - ldx,       ay + ldy      ],
  ]

  const result: Candidate[] = []
  for (const [bx, by, lx, ly] of dirs) {
    result.push({ rect: { x: bx, y: by, w, h }, leaderTo: { x: lx, y: ly } })
  }
  // Far ring
  for (const [bx, by, lx, ly] of dirs) {
    const dxE = bx - ax, dyE = by - ay
    const lxE = lx - ax, lyE = ly - ay
    result.push({
      rect:     { x: ax + dxE * FAR, y: ay + dyE * FAR, w, h },
      leaderTo: { x: ax + lxE * FAR, y: ay + lyE * FAR },
    })
  }
  return result
}

/**
 * Candidates for 'label' (safety-circle) labels — no leader line.
 * The first candidate is the current default: box TL directly at anchor.
 */
function labelCandidates(
  anchor: { x: number; y: number },
  box: { w: number; h: number },
): Candidate[] {
  const { w, h } = box
  const ax = anchor.x, ay = anchor.y
  return [
    { rect: { x: ax,             y: ay,         w, h } },  // 0 default (TL at anchor)
    { rect: { x: ax - w / 2,     y: ay - h,     w, h } },  // 1 centred above
    { rect: { x: ax,             y: ay - h,     w, h } },  // 2 above, left-flush
    { rect: { x: ax - w / 2,     y: ay,         w, h } },  // 3 centred, below anchor
    { rect: { x: ax - w,         y: ay,         w, h } },  // 4 left of anchor
    { rect: { x: ax - w / 2,     y: ay - h / 2, w, h } },  // 5 centred on anchor
  ]
}

// Cost weights.
const OVERLAP_WEIGHT  = 100   // per px² of box–box overlap
const OBSTACLE_WEIGHT = 80    // per px² of box–obstacle overlap
const OOBOUNDS_WEIGHT = 200   // per px² outside canvas bounds
const BASE_STEP       = 0.1   // tiny preference for lower candidate index

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Place all items, returning one Placement per item (same order as input).
 *
 * @param items     Labels to place.
 * @param obstacles Fixed obstacles (dots, arrow tips, wind-V) in caller px.
 * @param bounds    Canvas / container dimensions for edge-avoidance penalty.
 * @param ldx       Leader x-offset for 'icon' near-ring (same units as anchors).
 * @param ldy       Leader y-offset for 'icon' near-ring (same units as anchors).
 */
export function placeLabels(
  items: PlacementItem[],
  obstacles: Obstacle[],
  bounds: { w: number; h: number },
  ldx = 14,
  ldy = 14,
): Placement[] {
  // Stable sort descending by priority so we process higher-priority items first.
  const order = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const pa = a.item.priority ?? (a.item.variant === 'icon' ? 1 : 0)
      const pb = b.item.priority ?? (b.item.variant === 'icon' ? 1 : 0)
      return pb !== pa ? pb - pa : a.i - b.i   // stable by original index
    })

  const obstacleRects: Rect[] = obstacles.map(o => ({
    x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2,
  }))
  const placedRects: Rect[] = []
  const result: Placement[] = new Array(items.length)

  for (const { item, i } of order) {
    const candidates: Candidate[] = item.variant === 'icon'
      ? iconCandidates(item.anchor, item.box, ldx, ldy)
      : labelCandidates(item.anchor, item.box)

    let bestCost = Infinity
    let best: Placement = { x: candidates[0].rect.x, y: candidates[0].rect.y, leaderTo: candidates[0].leaderTo }

    for (let ci = 0; ci < candidates.length; ci++) {
      const { rect, leaderTo } = candidates[ci]
      let cost = ci * BASE_STEP

      for (const pr of placedRects)    cost += OVERLAP_WEIGHT  * overlapArea(rect, pr)
      for (const or of obstacleRects)  cost += OBSTACLE_WEIGHT * overlapArea(rect, or)
      cost += OOBOUNDS_WEIGHT * outOfBoundsArea(rect, bounds.w, bounds.h)

      if (cost < bestCost) {
        bestCost = cost
        best = { x: rect.x, y: rect.y, leaderTo }
      }
    }

    placedRects.push({ x: best.x, y: best.y, w: item.box.w, h: item.box.h })
    result[i] = best
  }

  return result
}
