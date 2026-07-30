import type { CSSProperties } from 'react'
import { CLASS_BAR_H } from './theme'

interface Props {
  color:   string
  label:   string
  edge:    'top' | 'bottom'
  /** The slide background colour — painted into the corner triangle to create the bevel illusion. */
  bgColor: string
}

// ── Geometry ──────────────────────────────────────────────────────────────────
const H = CLASS_BAR_H           // bar height  (22 px)
const B = Math.round(H * 1.3)  // bevel inset (29 px, matches PPTX ~1.28× ratio)

// ── Corner mask ───────────────────────────────────────────────────────────────
// Zero-size absolute div whose CSS borders paint a bgColor triangle over the
// inner corner of each piece, making it look like a trapezoid.
// No clip-path, no SVG — both fail in html2canvas.
//
// The piece must be position:relative so html2canvas resolves this div's
// containing block to the piece, not a higher ancestor.
//
//  side  edge   masked corner  placement        border-A (bgColor)   border-B (transparent)
//  left  top    bottom-right   top:0   right:0  borderBottom: H px   borderLeft:  B px
//  left  bottom top-right      bottom:0 right:0 borderTop:    H px   borderLeft:  B px
//  right top    bottom-left    top:0   left:0   borderBottom: H px   borderRight: B px
//  right bottom top-left       bottom:0 left:0  borderTop:    H px   borderRight: B px
//
// html2canvas at EXPORT_SCALE 3 leaves the exact-fit corner pixel uncovered when
// the triangle's right-angle vertex lands precisely on the piece corner.  Scaling
// both border widths by OVERSHOOT pushes the right-angle vertex outside the piece
// so the corner is guaranteed to be painted.  Because both borders scale by the
// same factor the hypotenuse slope (the visible bevel) is unchanged.  The overflow
// lands on the slide body / footer area — already bgColor — so it's invisible.
const OVERSHOOT = 1.25

function cornerMask(side: 'left' | 'right', edge: 'top' | 'bottom', bg: string): CSSProperties {
  const solid = `${Math.round(H * OVERSHOOT)}px solid ${bg}`
  const clear = `${Math.round(B * OVERSHOOT)}px solid transparent`
  const base: CSSProperties = { position: 'absolute', width: 0, height: 0 }

  if (side === 'left'  && edge === 'top')    return { ...base, top: 0,    right: 0, borderBottom: solid, borderLeft:  clear }
  if (side === 'left'  && edge === 'bottom') return { ...base, bottom: 0, right: 0, borderTop:    solid, borderLeft:  clear }
  if (side === 'right' && edge === 'top')    return { ...base, top: 0,    left:  0, borderBottom: solid, borderRight: clear }
  /* right + bottom */                        return { ...base, bottom: 0, left:  0, borderTop:    solid, borderRight: clear }
}

export function ClassificationBar({ color, label, edge, bgColor }: Props) {
  // Pieces use position:relative (not absolute) so that the absolutely-positioned
  // corner mask children resolve their containing block to the piece itself.
  // html2canvas can misplace corner masks when nested inside position:absolute parents.
  // The bar uses display:flex to lay out left piece → gap → right piece.
  const pieceStyle = (side: 'left' | 'right'): CSSProperties => ({
    width:           '32%',
    height:          H,
    flexShrink:      0,
    position:        'relative',
    backgroundColor: color,
    // Outer edge darker for depth; inner edge fades to transparent so the
    // corner-mask bevel blends without a bright-edge artifact.
    backgroundImage: side === 'left'
      ? 'linear-gradient(to right, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0) 100%)'
      : 'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.38) 100%)',
  })

  return (
    <div style={{
      position:   'relative',
      width:      '100%',
      height:     H,
      flexShrink: 0,
      boxSizing:  'border-box' as const,
      display:    'flex',
      alignItems: 'stretch',
    }}>
      {/* Left piece */}
      <div style={pieceStyle('left')}>
        <div style={cornerMask('left', edge, bgColor)} />
      </div>

      {/* Centre gap — no background, slide bg shows through */}
      <div style={{ flex: 1 }} />

      {/* Right piece */}
      <div style={pieceStyle('right')}>
        <div style={cornerMask('right', edge, bgColor)} />
      </div>

      {/* Label centred over the transparent centre gap */}
      <div style={{
        position:       'absolute',
        inset:          0,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        fontFamily:     "'Courier New', Consolas, monospace",
        fontSize:       10,
        fontWeight:     700,
        letterSpacing:  2.5,
        textTransform:  'uppercase' as const,
        color:          color,
        textShadow:     '0 1px 2px rgba(0,0,0,0.85)',
        pointerEvents:  'none',
        userSelect:     'none' as const,
      }}>
        {label}
      </div>
    </div>
  )
}
