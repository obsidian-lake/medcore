/**
 * BulletSlide — single-column bulleted content slide.
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
  /** Optional section label above the bullet list. */
  section?:      string
  bullets:       string[]
  /** When provided, renders below the bullets. */
  extra?:        ReactNode
}

export function BulletSlide({ brand, title, dzName, date, footerRight, section, bullets, extra }: Props) {
  const theme = SLIDE_THEMES[brand.themeId]

  return (
    <div data-slide style={{ width: SLIDE_W, height: SLIDE_H, overflow: 'hidden', background: theme.bg, boxSizing: 'border-box' as const }}>
      <SlideChrome brand={brand} title={title} dzName={dzName} date={date} footerRight={footerRight}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {section && (
            <div style={{
              fontSize:      10,
              color:         theme.label,
              letterSpacing: 2,
              textTransform: 'uppercase' as const,
              marginBottom:  10,
              paddingBottom: 6,
              borderBottom:  `1px solid ${theme.border}`,
              fontFamily:    theme.mono,
            }}>
              {section}
            </div>
          )}

          <ul style={{
            flex:          1,
            margin:        0,
            paddingLeft:   24,
            listStyleType: 'disc',
            overflow:      'hidden',
          }}>
            {bullets.map((b, i) => (
              <li key={i} style={{
                fontSize:    14,
                color:       theme.accent2,
                fontFamily:  theme.mono,
                lineHeight:  1.65,
                marginBottom: 4,
              }}>
                {b}
              </li>
            ))}
          </ul>

          {extra && (
            <div style={{ flexShrink: 0, marginTop: 10 }}>
              {extra}
            </div>
          )}
        </div>
      </SlideChrome>
    </div>
  )
}
