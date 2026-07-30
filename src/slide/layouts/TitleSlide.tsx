/**
 * TitleSlide — generic 1280×720 opening slide with classification bars.
 *
 * Centred layout: optional central logo → large title → optional subtitle → meta row.
 * Wrap in a `[data-slide]` outer div for html2canvas capture.
 */

import type { BrandConfig } from '../brand'
import { SLIDE_THEMES, SLIDE_W, SLIDE_H, CLASS_BAR_H, SLIDE_PAD_H, SLIDE_PAD_V } from '../theme'
import { ClassificationBar } from '../ClassificationBar'

interface MetaItem {
  label: string
  value: string
}

interface Props {
  brand:       BrandConfig
  title:       string
  subtitle?:   string
  date?:       string
  /** URL or base64 data URL for a central logo on the title slide. */
  logoUrl?:    string
  meta?:       MetaItem[]
}

export function TitleSlide({ brand, title, subtitle, date, logoUrl, meta }: Props) {
  const theme = SLIDE_THEMES[brand.themeId]

  // The inner body sits between the two classification bars.
  const bodyH = SLIDE_H - CLASS_BAR_H * 2

  return (
    <div style={{
      width:         SLIDE_W,
      height:        SLIDE_H,
      overflow:      'hidden',
      background:    theme.bg,
      display:       'flex',
      flexDirection: 'column',
      boxSizing:     'border-box' as const,
      fontFamily:    theme.mono,
    }}>
      <ClassificationBar color={brand.classification.color} label={brand.classification.label} edge="top" bgColor={theme.bg} />

      {/* Centred content body */}
      <div style={{
        height:          bodyH,
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        padding:         `${SLIDE_PAD_H}px ${SLIDE_PAD_V}px`,
        boxSizing:       'border-box' as const,
      }}>
        {logoUrl && (
          <img
            src={logoUrl}
            alt=""
            style={{ height: 120, width: 'auto', objectFit: 'contain', marginBottom: 24, opacity: 0.9 }}
          />
        )}

        <div style={{
          fontSize:      52,
          fontWeight:    700,
          color:         theme.accent,
          letterSpacing: 3,
          textTransform: 'uppercase' as const,
          textAlign:     'center',
          lineHeight:    1.1,
          marginBottom:  16,
        }}>
          {title}
        </div>

        {subtitle && (
          <div style={{
            fontSize:      22,
            color:         theme.accent2,
            letterSpacing: 3,
            textAlign:     'center',
            marginBottom:  date ? 8 : 32,
          }}>
            {subtitle}
          </div>
        )}

        {date && (
          <div style={{
            fontSize:      18,
            color:         theme.label,
            letterSpacing: 3,
            marginBottom:  32,
          }}>
            {date}
          </div>
        )}

        {meta && meta.length > 0 && (
          <div style={{ display: 'flex', gap: 48 }}>
            {meta.map((m, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: theme.label, letterSpacing: 1.5, textTransform: 'uppercase' as const, marginBottom: 4 }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 16, color: theme.accent, fontWeight: 700, letterSpacing: 1 }}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ClassificationBar color={brand.classification.color} label={brand.classification.label} edge="bottom" bgColor={theme.bg} />
    </div>
  )
}
