/**
 * TwoColSlide — two-column slide (Primary / Alternate pattern from OPORD template).
 * Wrap in a `[data-slide]` outer div for html2canvas capture.
 */

import type { ReactNode } from 'react'
import type { BrandConfig } from '../brand'
import { SLIDE_W, SLIDE_H, SLIDE_THEMES } from '../theme'
import { SlideChrome } from '../SlideChrome'

interface Props {
  brand:         BrandConfig
  title:         string
  dzName?:       string
  date?:         string
  footerRight?:  string
  leftTitle?:    string
  rightTitle?:   string
  leftContent:   ReactNode
  rightContent:  ReactNode
}

export function TwoColSlide({
  brand, title, dzName, date, footerRight,
  leftTitle, rightTitle, leftContent, rightContent,
}: Props) {
  const theme = SLIDE_THEMES[brand.themeId]

  const colHeader = (label: string) => (
    <div style={{
      fontSize:      10,
      fontWeight:    700,
      color:         theme.accent,
      letterSpacing: 2,
      textTransform: 'uppercase' as const,
      fontFamily:    theme.mono,
      marginBottom:  8,
      paddingBottom: 6,
      borderBottom:  `1px solid ${theme.border}`,
    }}>
      {label}
    </div>
  )

  return (
    <div data-slide style={{ width: SLIDE_W, height: SLIDE_H, overflow: 'hidden', background: theme.bg, boxSizing: 'border-box' as const }}>
      <SlideChrome brand={brand} title={title} dzName={dzName} date={date} footerRight={footerRight}>
        <div style={{ display: 'flex', height: '100%', gap: 16 }}>

          {/* Left column */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {leftTitle && colHeader(leftTitle)}
            <div style={{ flex: 1, overflow: 'hidden', fontFamily: theme.mono, fontSize: 13, color: theme.accent2, lineHeight: 1.6 }}>
              {leftContent}
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, flexShrink: 0, background: theme.border }} />

          {/* Right column */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {rightTitle && colHeader(rightTitle)}
            <div style={{ flex: 1, overflow: 'hidden', fontFamily: theme.mono, fontSize: 13, color: theme.accent2, lineHeight: 1.6 }}>
              {rightContent}
            </div>
          </div>

        </div>
      </SlideChrome>
    </div>
  )
}
