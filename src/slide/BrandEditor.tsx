/**
 * BrandEditor — reusable brand-customisation panel for suite export slides.
 *
 * A controlled, presentational component that renders:
 *   • Theme selector (one button per SlideThemeId)
 *   • Classification label: preset swatches + custom colour picker + text input
 *   • Two squadron logo upload slots (left / right) with preview + remove
 *
 * Styling relies on the shared design tokens present in every suite app —
 * no new CSS is required:
 *   CSS vars:  --mono, --accent, --label, --border, --danger
 *   Classes:   .btn  .btn-sm
 * Input elements are styled by each app's element-selector rule (input, select).
 */

import type { CSSProperties } from 'react'
import type { BrandConfig } from './brand'
import { CLASS_PRESET_COLORS } from './brand'
import { SLIDE_THEMES } from './theme'
import type { SlideThemeId } from './theme'

// Human-readable display labels for each theme id.
const THEME_LABELS: Record<SlideThemeId, string> = {
  'field-green':      'FIELD GREEN',
  'mission-planning': 'STANDARD DARK',
}

const sectionLabel: CSSProperties = {
  fontSize:      10,
  letterSpacing: 1.5,
  color:         'var(--label)',
  fontFamily:    'var(--mono)',
  marginBottom:  8,
  textTransform: 'uppercase',
}

export function BrandEditor({ brand, onChange }: {
  brand:    BrandConfig
  onChange: (patch: Partial<BrandConfig>) => void
}) {
  return (
    <div>

      {/* ── THEME ─────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div style={sectionLabel}>THEME</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(Object.keys(SLIDE_THEMES) as SlideThemeId[]).map(id => {
            const selected = brand.themeId === id
            return (
              <button
                key={id}
                className="btn btn-sm"
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize:   11,
                  background: selected ? 'var(--accent)' : undefined,
                  color:      selected ? '#000' : undefined,
                  fontWeight: selected ? 700 : undefined,
                }}
                onClick={() => onChange({ themeId: id })}
              >
                {THEME_LABELS[id]}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── LABELS ────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div style={sectionLabel}>LABELS</div>

        {/* Preset swatches + custom colour */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          {CLASS_PRESET_COLORS.map(p => {
            const selected = brand.classification.color === p.color
            return (
              <button
                key={p.name}
                className="btn btn-sm"
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize:   11,
                  background: selected ? p.color : undefined,
                  color:      selected ? '#000' : p.color,
                  border:     `1px solid ${p.color}`,
                  fontWeight: selected ? 700 : undefined,
                }}
                onClick={() => onChange({
                  classification: { ...brand.classification, color: p.color, label: '' },
                })}
              >
                {p.name}
              </button>
            )
          })}
          <input
            type="color"
            value={brand.classification.color}
            title="Custom colour"
            onChange={e => onChange({
              classification: { ...brand.classification, color: e.target.value },
            })}
            style={{
              width:        32,
              height:       28,
              cursor:       'pointer',
              border:       '1px solid var(--border)',
              borderRadius: 3,
              padding:      2,
              background:   'transparent',
            }}
          />
        </div>

        {/* Classification label text */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--label)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
            LABEL
          </span>
          <input
            style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 12 }}
            value={brand.classification.label}
            onChange={e => onChange({
              classification: { ...brand.classification, label: e.target.value },
            })}
            placeholder="e.g. UNCLASSIFIED"
          />
        </div>
      </div>

      {/* ── SQUADRON LOGOS ────────────────────────────────────────────────── */}
      <div>
        <div style={sectionLabel}>SQUADRON LOGOS</div>
        <div style={{ display: 'flex', gap: 20 }}>
          {(['logoLeft', 'logoRight'] as const).map(slot => {
            const label = slot === 'logoLeft' ? 'LEFT' : 'RIGHT'
            const url   = brand[slot]
            return (
              <div key={slot} style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--label)', fontFamily: 'var(--mono)', marginBottom: 6 }}>
                  {label}
                </div>
                {url ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <img
                      src={url}
                      alt={label}
                      style={{
                        height:      48,
                        maxWidth:    120,
                        objectFit:   'contain',
                        border:      '1px solid var(--border)',
                        borderRadius: 3,
                      }}
                    />
                    <button
                      className="btn btn-sm"
                      style={{ color: 'var(--danger)', fontSize: 14 }}
                      onClick={() => onChange(slot === 'logoLeft' ? { logoLeft: undefined } : { logoRight: undefined })}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <label style={{ cursor: 'pointer', display: 'inline-block' }}>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        const reader = new FileReader()
                        reader.onload = ev => {
                          const dataUrl = ev.target?.result as string
                          onChange(slot === 'logoLeft' ? { logoLeft: dataUrl } : { logoRight: dataUrl })
                        }
                        reader.readAsDataURL(file)
                      }}
                    />
                    <span className="btn btn-sm" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                      UPLOAD
                    </span>
                  </label>
                )}
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}
