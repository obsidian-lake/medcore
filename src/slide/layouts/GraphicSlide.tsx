/**
 * GraphicSlide — content-left / graphic-right split layout.
 *
 * The right pane exposes a `data-*` placeholder div that jmPackage (or any
 * html2canvas wrapper) replaces with a pre-composited imagery canvas before
 * capture — same pattern as `[data-med-map]` in MedSlide.
 *
 * Wrap in a `[data-slide]` outer div for html2canvas capture.
 */

import type { ReactNode } from 'react'
import type { BrandConfig } from '../brand'
import { SLIDE_W, SLIDE_H, SLIDE_THEMES } from '../theme'
import { SlideChrome } from '../SlideChrome'

interface Props {
  brand:           BrandConfig
  title:           string
  dzName?:         string
  date?:           string
  footerRight?:    string
  /** Content for the left panel (bulleted text, tables, etc.). */
  leftContent?:    ReactNode
  /** Width of the left panel in px. Defaults to 380. */
  leftWidth?:      number
  /**
   * The value of the custom `data-*` attribute placed on the imagery placeholder div.
   * E.g. passing `'mission-map'` emits `data-mission-map` on the div.
   */
  graphicDataAttr: string
}

export function GraphicSlide({
  brand, title, dzName, date, footerRight,
  leftContent, leftWidth = 380, graphicDataAttr,
}: Props) {
  const theme = SLIDE_THEMES[brand.themeId]

  // Build `{ ['data-mission-map']: true }` from the user-provided attr name.
  const placeholderAttr = { [`data-${graphicDataAttr}`]: true }

  return (
    <div data-slide style={{ width: SLIDE_W, height: SLIDE_H, overflow: 'hidden', background: theme.bg, boxSizing: 'border-box' as const }}>
      <SlideChrome brand={brand} title={title} dzName={dzName} date={date} footerRight={footerRight}>
        <div style={{ display: 'flex', height: '100%', gap: 16 }}>

          {/* Left pane */}
          {leftContent && (
            <div style={{ width: leftWidth, flexShrink: 0, overflow: 'hidden', fontFamily: theme.mono, fontSize: 13, color: theme.accent2, lineHeight: 1.6 }}>
              {leftContent}
            </div>
          )}

          {/* Right pane: imagery placeholder — replaced by pre-composited canvas at export */}
          <div
            {...placeholderAttr}
            style={{
              flex:             1,
              background:       '#1a1a1a',
              borderRadius:     6,
              overflow:         'hidden',
              display:          'flex',
              alignItems:       'center',
              justifyContent:   'center',
            }}
          >
            <span style={{ fontSize: 11, color: theme.dim, letterSpacing: 1 }}>
              IMAGERY
            </span>
          </div>

        </div>
      </SlideChrome>
    </div>
  )
}
