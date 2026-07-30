/**
 * SlideChrome — the full-bleed 1280×720 frame for every slide in the suite.
 *
 * Layout (top → bottom):
 *   ClassificationBar (top)
 *   SlideHeader  (theme-driven: thin/thick)
 *   content region  (fills remaining height; clips overflow for fixed slides)
 *   footer bar
 *   ClassificationBar (bottom)
 *
 * Used inside a `[data-slide]` outer div that sets the exact 1280×720 bounding box.
 * SlideChrome fills 100% of that box via width:100% / height:100%.
 */

import type { ReactNode } from 'react'
import type { BrandConfig } from './brand'
import { SLIDE_THEMES, FOOTER_H, SLIDE_PAD_H, SLIDE_PAD_V } from './theme'
import { ClassificationBar } from './ClassificationBar'
import { SlideHeader } from './SlideHeader'

interface Props {
  brand:        BrandConfig
  title:        string
  dzName?:      string
  date?:        string
  footerRight?: string
  leftLabel?:   string
  /** When true: content grows to fit its children (variable-height timeline slides). */
  variableHeight?: boolean
  children:     ReactNode
}

export function SlideChrome({
  brand,
  title,
  dzName,
  date,
  footerRight = 'TEAM BRIEF',
  leftLabel,
  variableHeight = false,
  children,
}: Props) {
  const theme = SLIDE_THEMES[brand.themeId]

  return (
    <div style={{
      width:         '100%',
      height:        variableHeight ? 'auto' : '100%',
      background:    theme.bg,
      display:       'flex',
      flexDirection: 'column',
      fontFamily:    theme.mono,
      boxSizing:     'border-box' as const,
    }}>

      <ClassificationBar color={brand.classification.color} label={brand.classification.label} edge="top" bgColor={theme.bg} />

      <SlideHeader
        theme={theme}
        title={title}
        dzName={dzName}
        leftLabel={leftLabel}
        logoLeft={brand.logoLeft}
        logoRight={brand.logoRight}
      />

      {/* Content */}
      <div style={{
        padding:   `${SLIDE_PAD_H}px ${SLIDE_PAD_V}px`,
        flex:      variableHeight ? '1 0 auto' : 1,
        minHeight: variableHeight ? undefined : 0,
        overflow:  variableHeight ? 'visible' : 'hidden',
      }}>
        {children}
      </div>

      {/* Footer */}
      <div style={{
        height:          FOOTER_H,
        flexShrink:      0,
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'space-between',
        padding:         `0 ${SLIDE_PAD_V}px`,
        borderTop:       `1px solid ${theme.border}`,
        boxSizing:       'border-box' as const,
      }}>
        <span style={{ fontSize: 10, color: theme.dim, letterSpacing: 1, fontFamily: theme.mono }}>
          {date ?? ''}
        </span>
        <span style={{ fontSize: 10, color: theme.dim, letterSpacing: 1.5, fontFamily: theme.mono }}>
          {footerRight}
        </span>
      </div>

      <ClassificationBar color={brand.classification.color} label={brand.classification.label} edge="bottom" bgColor={theme.bg} />

    </div>
  )
}
