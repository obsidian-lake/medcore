import type { SlideTheme } from './theme'
import { HEADER_H_THIN, HEADER_H_THICK, SLIDE_PAD_V } from './theme'

const LOGO_H_THIN  = 28   // px — logo height inside thin header
const LOGO_H_THICK = 44   // px — logo height inside thick header

const SLOT_W = 200    // px — fixed width of left/right slots (prevents title crushing)

interface Props {
  theme:      SlideTheme
  title:      string
  /** Shown in right slot when no right logo is present; moves to subtitle when right logo is set. */
  dzName?:    string
  /** Left slot label shown when no left logo is present. */
  leftLabel?: string
  logoLeft?:  string   // base64 data URL
  logoRight?: string   // base64 data URL
}

export function SlideHeader({
  theme,
  title,
  dzName,
  leftLabel = 'MFF JM PLANNER',
  logoLeft,
  logoRight,
}: Props) {
  const isThin  = theme.headerStyle === 'thin'
  const headerH = isThin ? HEADER_H_THIN : HEADER_H_THICK
  const logoH   = isThin ? LOGO_H_THIN : LOGO_H_THICK

  // When a right logo occupies the right slot, dzName becomes a subtitle below the title.
  const dzInSubtitle = !!(logoRight && dzName)
  const dzInRightSlot = !logoRight && !!dzName

  return (
    <div style={{
      height:          headerH,
      flexShrink:      0,
      background:      theme.headerBg,
      borderBottom:    isThin ? `1px solid ${theme.headerBorder}` : 'none',
      display:         'flex',
      alignItems:      'center',
      padding:         `0 ${SLIDE_PAD_V}px`,
      gap:             12,
      boxSizing:       'border-box' as const,
    }}>

      {/* ── Left slot ─────────────────────────────── */}
      <div style={{ width: SLOT_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        {logoLeft ? (
          <img
            src={logoLeft}
            alt=""
            style={{ height: logoH, width: 'auto', maxWidth: SLOT_W, objectFit: 'contain', flexShrink: 0 }}
          />
        ) : (
          <span style={{
            fontSize:      isThin ? 11 : 12,
            color:         theme.headerLabel,
            letterSpacing: 1.5,
            textTransform: 'uppercase' as const,
            fontFamily:    theme.mono,
          }}>
            {leftLabel}
          </span>
        )}
      </div>

      {/* ── Center: title (+ optional dzName subtitle) ── */}
      <div style={{ flex: 1, textAlign: 'center', lineHeight: 1.1 }}>
        <div style={{
          fontSize:      isThin ? 13 : 18,
          color:         theme.headerText,
          fontWeight:    700,
          letterSpacing: isThin ? 2 : 3,
          textTransform: 'uppercase' as const,
          fontFamily:    theme.mono,
        }}>
          {title}
        </div>
        {dzInSubtitle && (
          <div style={{
            fontSize:      isThin ? 10 : 12,
            color:         theme.headerLabel,
            letterSpacing: 1.5,
            textTransform: 'uppercase' as const,
            fontFamily:    theme.mono,
            marginTop:     2,
          }}>
            {dzName}
          </div>
        )}
      </div>

      {/* ── Right slot ────────────────────────────────── */}
      <div style={{ width: SLOT_W, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
        {logoRight ? (
          <img
            src={logoRight}
            alt=""
            style={{ height: logoH, width: 'auto', maxWidth: SLOT_W, objectFit: 'contain', flexShrink: 0 }}
          />
        ) : dzInRightSlot ? (
          <span style={{
            fontSize:      isThin ? 11 : 12,
            color:         theme.headerLabel,
            letterSpacing: 1.5,
            textTransform: 'uppercase' as const,
            fontFamily:    theme.mono,
            textAlign:     'right' as const,
          }}>
            {dzName}
          </span>
        ) : null}
      </div>

    </div>
  )
}
