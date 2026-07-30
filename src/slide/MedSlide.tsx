/**
 * MedSlide — the 16:9 med-plan slide authored as DOM for PDF/PPTX export.
 *
 * Layout (1280×720 CSS px at 1×, exported at EXPORT_SCALE 3×):
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │ HEADER: Op Name | Unit | "MED PLAN" | date | env  │
 *   ├─────────────────────────┬──────────────────────────┤
 *   │  FACILITY PACE (table)  │  MACRO IMAGERY           │
 *   │  P / A / C / E         │  [data-med-map]           │
 *   ├─────────────────────────┤  (satellite tile w/       │
 *   │  TREATMENT PACE (table) │   routes, labels,         │
 *   │  P / A / C / E         │   north arrow)            │
 *   ├─────────────────────────┴──────────────────────────┤
 *   │ FOOTER: notes | target MGRS | helo speed           │
 *   └────────────────────────────────────────────────────┘
 *
 * Mounted off-screen (left:-9999px) in App.tsx so it is always available for
 * html2canvas rasterization. The [data-med-map] placeholder is replaced by
 * the pre-composited imagery canvas during export (never html2canvas the map).
 *
 * Ref: MFFJM BriefSlides.tsx pattern.
 */

import { forwardRef } from 'react'
import type { FacilityPace, FacilityPaceEntry, TreatmentPace } from '../med/pace'
import { formatTransit } from '../med/rank'
import type { EchelonPlan } from '../med/echelon'
import { latLonToMgrs } from '../calc/geo'
import { formatTricareLanguageNote } from '../med/tricareLanguage'
import type { BrandConfig } from './brand'
import { SlideChrome } from './SlideChrome'

/**
 * Slim input type for the MedSlide component.
 * Consumers extract these fields from their own app state and pass them in —
 * no dependency on medplanner's full AppState.
 */
export interface MedSlideInput {
  opName: string
  unitName: string
  environment: 'training' | 'operational'
  targetLat: number
  targetLon: number
  rotaryWingAvailable: boolean
  heloSpeedKt: number
  notes: string
  /** ISO 3166-1 alpha-2 country code (drives TRICARE language note). */
  countryCode: string
  diveMode: boolean
}

interface Props {
  /** Slim display-context for the slide header / footer. */
  state: MedSlideInput
  facilityPace: FacilityPace | null
  /** Dive mode only: recompression chamber PACE (null/undefined when not in dive mode). */
  chamberPace?: FacilityPace | null
  treatmentPace: TreatmentPace | null
  /** When present, rendered as a separate Echelons of Care block below the PACE tables. */
  echelonPlan?: EchelonPlan | null
  /** PNG data URL for a QR code that shares / downloads this plan. */
  qrDataUrl?: string
  /** When provided, renders with shared SlideChrome (class bars, theme, logos). */
  brand?: BrandConfig
}

const SLIDE_W = 1280
const SLIDE_H = 720

function paceLetterColor(letter: string): string {
  switch (letter) {
    case 'P': return '#4caf50'
    case 'A': return '#2196f3'
    case 'C': return '#ff9800'
    case 'E': return '#e53935'
    default:   return '#c8e6c9'
  }
}

/** Shared facility PACE table rows (reused for both hospital and chamber tables in dive mode). */
function FacilityPaceRows({ entries, state }: { entries: FacilityPaceEntry[]; state: Pick<MedSlideInput, 'rotaryWingAvailable'> }) {
  return (
    <tbody>
      {entries.map(entry => {
        const fac = entry.facility
        const color = paceLetterColor(entry.letter)
        return (
          <tr key={entry.letter} style={{ borderBottom: '1px solid #1a2a1a' }}>
            <td style={{ padding: '4px 4px', fontWeight: 700, fontSize: 13, color }}>{entry.letter}</td>
            <td style={{ padding: '4px 4px' }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#c8e6c9' }}>{fac.name}</div>
              {entry.phasedNote && <div style={{ fontSize: 9, color: '#ffcc02', marginTop: 1 }}>⚠ {entry.phasedNote}</div>}
              {fac.capabilities.length > 0 && (
                <div style={{ fontSize: 9, color: '#6a9a6a', marginTop: 1 }}>
                  {fac.capabilities.slice(0, 4).map(c =>
                    (fac.inferredCapabilities ?? []).includes(c) ? `~${c}` : c
                  ).join(' · ')}
                </div>
              )}
              {fac.phone && <div style={{ fontSize: 9, color: '#81c784' }}>Ph: {fac.phone}</div>}
              {fac.address && (
                <div
                  data-maps-url={`https://www.google.com/maps/dir/?api=1&destination=${fac.lat},${fac.lon}`}
                  style={{ fontSize: 9, color: '#6a9a6a' }}
                >
                  {fac.address.slice(0, 50)}
                </div>
              )}
            </td>
            <td style={{ padding: '4px 4px', fontSize: 11, color: entry.transit.groundDurationS && entry.transit.groundDurationS <= 3600 ? '#4caf50' : '#ffcc02' }}>
              {formatTransit(entry.transit.groundDurationS)}
            </td>
            <td style={{ padding: '4px 4px', fontSize: 11, color: '#81c784' }}>
              {state.rotaryWingAvailable && fac.hasHelipad ? formatTransit(entry.transit.heloDurationS) : '—'}
            </td>
            <td style={{ padding: '4px 4px', fontSize: 11, color: state.rotaryWingAvailable && fac.hasHelipad ? '#4caf50' : '#6a9a6a' }}>
              {state.rotaryWingAvailable && fac.hasHelipad ? '✓' : '—'}
            </td>
          </tr>
        )
      })}
    </tbody>
  )
}

/** Column header row shared by both hospital and chamber facility tables. */
function FacilityPaceHeader() {
  return (
    <thead>
      <tr style={{ borderBottom: '1px solid #2a4a2a' }}>
        {['', 'FACILITY', 'GROUND', 'HELO', 'PAD'].map(h => (
          <th key={h} style={{ textAlign: 'left', padding: '2px 4px', fontSize: 9, letterSpacing: 1, color: '#6a9a6a', fontWeight: 600 }}>{h}</th>
        ))}
      </tr>
    </thead>
  )
}

export const MedSlide = forwardRef<HTMLDivElement, Props>(function MedSlide({ state, facilityPace, chamberPace, treatmentPace, echelonPlan, qrDataUrl, brand }, ref) {
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
  // Display target in MGRS (internal lat/lon stored as numbers; convert for display)
  const targetStr = state.targetLat !== 0
    ? latLonToMgrs(state.targetLat, state.targetLon)
    : '—'

  const paceBody = (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: PACE tables */}
        <div style={{ width: 640, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #2a4a2a' }}>

          {state.diveMode && chamberPace ? (
            // ── Dive mode: top half split into Hospital + Chamber tables ──────
            <div style={{ flex: 1, borderBottom: '1px solid #2a4a2a', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

              {/* Hospital PACE (top quarter) */}
              <div style={{ flex: 1, borderBottom: '1px solid #2a4a2a', padding: '6px 12px', overflow: 'hidden' }}>
                <div style={{ fontSize: 9, letterSpacing: 2, color: '#81c784', marginBottom: 4, fontWeight: 700 }}>
                  PACE — HOSPITALS (TRAUMA / MECHANICAL)
                </div>
                {facilityPace ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                    <colgroup>
                      <col style={{ width: 18 }} /><col /><col style={{ width: 80 }} /><col style={{ width: 60 }} /><col style={{ width: 40 }} />
                    </colgroup>
                    <FacilityPaceHeader />
                    <FacilityPaceRows entries={facilityPace.entries} state={state} />
                  </table>
                ) : (
                  <div style={{ fontSize: 10, color: '#6a9a6a' }}>No hospital PACE generated.</div>
                )}
                {facilityPace && (() => {
                  const langNote = formatTricareLanguageNote(state.countryCode)
                  return langNote ? (
                    <div style={{ marginTop: 4, fontSize: 8, color: '#6a9a6a', fontFamily: 'monospace', lineHeight: 1.4, overflowWrap: 'break-word' }}>
                      📞 {langNote}
                    </div>
                  ) : null
                })()}
              </div>

              {/* Chamber PACE (bottom quarter of top half) */}
              <div style={{ flex: 1, padding: '6px 12px', overflow: 'hidden' }}>
                <div style={{ fontSize: 9, letterSpacing: 2, color: '#26c6da', marginBottom: 4, fontWeight: 700 }}>
                  PACE — CHAMBERS (RECOMPRESSION / DCS)
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                  <colgroup>
                    <col style={{ width: 18 }} /><col /><col style={{ width: 80 }} /><col style={{ width: 60 }} /><col style={{ width: 40 }} />
                  </colgroup>
                  <FacilityPaceHeader />
                  <FacilityPaceRows entries={chamberPace.entries} state={state} />
                </table>
              </div>
            </div>
          ) : (
            // ── Normal mode: single facility PACE table ────────────────────────
            <div style={{ flex: 1, borderBottom: '1px solid #2a4a2a', padding: '8px 12px', overflow: 'hidden' }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: '#81c784', marginBottom: 6, fontWeight: 700 }}>
                PACE — MEDICAL FACILITIES
              </div>
              {facilityPace ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <colgroup>
                    <col style={{ width: 18 }} />
                    <col />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 70 }} />
                    <col style={{ width: 50 }} />
                  </colgroup>
                  <FacilityPaceHeader />
                  <FacilityPaceRows entries={facilityPace.entries} state={state} />
                </table>
              ) : (
                <div style={{ fontSize: 11, color: '#6a9a6a' }}>No facility PACE generated.</div>
              )}
              {facilityPace && (() => {
                const langNote = formatTricareLanguageNote(state.countryCode)
                return langNote ? (
                  <div style={{ marginTop: 5, fontSize: 9, color: '#6a9a6a', fontFamily: 'monospace', lineHeight: 1.4, overflowWrap: 'break-word' }}>
                    📞 {langNote}
                  </div>
                ) : null
              })()}
            </div>
          )}

          {/* Treatment PACE */}
          <div style={{ flex: 1, padding: '8px 12px', overflow: 'hidden', borderBottom: echelonPlan ? '1px solid #2a4a2a' : undefined }}>
            <div style={{ fontSize: 10, letterSpacing: 2, color: '#81c784', marginBottom: 6, fontWeight: 700 }}>
              PACE — TREATMENT
            </div>
            {treatmentPace ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <tbody>
                  {treatmentPace.entries.map(entry => {
                    const color = paceLetterColor(entry.letter)
                    return (
                      <tr key={entry.letter} style={{ borderBottom: '1px solid #1a2a1a', verticalAlign: 'top' }}>
                        <td style={{ padding: '3px 4px', fontWeight: 700, fontSize: 13, color, width: 18 }}>{entry.letter}</td>
                        <td style={{ padding: '3px 4px', width: 140 }}>
                          <div style={{ fontWeight: 700, fontSize: 11, color: '#c8e6c9' }}>{entry.label}</div>
                        </td>
                        <td style={{ padding: '3px 4px', fontSize: 10, color: '#6a9a6a', lineHeight: 1.4 }}>
                          {entry.detail}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ fontSize: 11, color: '#6a9a6a' }}>No treatment PACE generated.</div>
            )}
          </div>

          {/* Echelons of Care (macro layer — only when a Level I is beyond golden hour) */}
          {echelonPlan && (
            <div style={{ flexShrink: 0, padding: '6px 12px', overflow: 'hidden' }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: '#26c6da', marginBottom: 4, fontWeight: 700 }}>
                ECHELONS OF CARE — DEFINITIVE CARE PATHWAY
              </div>
              <div style={{ fontSize: 9, fontFamily: "'Courier New', Courier, monospace", lineHeight: 1.5 }}>
                {/* Leg 1 */}
                <div style={{ marginBottom: 2 }}>
                  <span style={{ color: '#4caf50', fontWeight: 700 }}>L1</span>
                  {' '}POI →[{echelonPlan.legs[0].assetLabel}]→{' '}
                  <span style={{ color: '#c8e6c9', fontWeight: 700 }}>{echelonPlan.stabilizeAt.name}</span>
                  {' '}
                  <span style={{ color: echelonPlan.legs[0].transit.effectiveDurationS <= 3600 ? '#4caf50' : '#ffcc02' }}>
                    ({formatTransit(echelonPlan.legs[0].transit.effectiveDurationS)})
                  </span>
                </div>
                {echelonPlan.legs[0].notes?.map((n, i) => (
                  <div key={i} style={{ color: '#6a9a6a', fontSize: 8, marginBottom: 1 }}>↳ {n}</div>
                ))}
                {/* Leg 2 */}
                <div style={{ marginTop: echelonPlan.legs[0].notes?.length ? 2 : 0 }}>
                  <span style={{ color: echelonPlan.environment === 'training' ? '#ff9800' : '#26c6da', fontWeight: 700 }}>L2</span>
                  {' '}{echelonPlan.stabilizeAt.name} →[{echelonPlan.legs[1].assetLabel}]→{' '}
                  <span style={{ color: '#c8e6c9', fontWeight: 700 }}>{echelonPlan.definitive.name}</span>
                  {' '}
                  <span style={{ color: '#6a9a6a' }}>
                    ({formatTransit(echelonPlan.legs[1].transit.effectiveDurationS)}
                    {echelonPlan.legs[1].transit.fixedWingDurationS != null && (
                      <> / C-130: {formatTransit(echelonPlan.legs[1].transit.fixedWingDurationS)}</>
                    )})
                  </span>
                </div>
                {echelonPlan.legs[1].notes?.map((n, i) => (
                  <div key={i} style={{ color: '#6a9a6a', fontSize: 8, marginTop: 2 }}>↳ {n}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Satellite imagery placeholder */}
        <div
          data-med-map
          style={{
            flex: 1,
            background: '#1a1a1a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: 12, color: '#6a9a6a', letterSpacing: 1 }}>
            SATELLITE IMAGERY
          </span>
        </div>
      </div>
  )  // end paceBody

  // ── Render: shared chrome path (brand provided) ────────────────────────────
  if (brand) {
    const opLabel = [state.opName, state.unitName].filter(Boolean).join(' · ') || undefined
    return (
      <div
        ref={ref}
        data-slide
        style={{ width: SLIDE_W, height: SLIDE_H, overflow: 'hidden', boxSizing: 'border-box' as const }}
      >
        <SlideChrome brand={brand} title="MED PLAN" dzName={opLabel} date={today} footerRight="MED PLAN">
          {paceBody}
        </SlideChrome>
      </div>
    )
  }

  // ── Render: legacy standalone layout (no brand — backward compat) ──────────
  return (
    <div
      ref={ref}
      data-slide
      style={{
        width: SLIDE_W, height: SLIDE_H,
        background: '#0d1a0d', color: '#c8e6c9',
        fontFamily: "'Courier New', Courier, monospace",
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', flexShrink: 0, position: 'relative',
      }}
    >
      {/* ── LEGACY HEADER ─────────────────────────────────────────────────── */}
      <div style={{
        height: 44, background: '#1a2a1a', borderBottom: '1px solid #2a4a2a',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16, flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 3, color: '#4caf50' }}>MED PLAN</span>
        <span style={{ color: '#2a4a2a' }}>│</span>
        {state.opName && <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: 2, color: '#c8e6c9' }}>{state.opName}</span>}
        {state.unitName && <span style={{ fontSize: 12, color: '#81c784' }}>{state.unitName}</span>}
        <span style={{ flex: 1 }} />
        <span style={{
          fontSize: 10, letterSpacing: 1, padding: '2px 8px', borderRadius: 3,
          border: `1px solid ${state.environment === 'operational' ? '#ffcc02' : '#4caf50'}`,
          color: state.environment === 'operational' ? '#ffcc02' : '#4caf50',
        }}>
          {state.environment.toUpperCase()}
        </span>
        <span style={{ fontSize: 11, color: '#6a9a6a' }}>{today}</span>
      </div>

      {paceBody}

      {/* ── LEGACY FOOTER ─────────────────────────────────────────────────── */}
      <div style={{
        height: 40,
        background: '#1a2a1a',
        borderTop: '1px solid #2a4a2a',
        display: 'flex',
        alignItems: 'center',
        padding: '0 14px',
        gap: 16,
        flexShrink: 0,
        fontSize: 9,
        color: '#6a9a6a',
      }}>
        <span>TGT: {targetStr}</span>
        <span style={{ color: '#2a4a2a' }}>│</span>
        {state.rotaryWingAvailable
          ? <span>HELO: {state.heloSpeedKt} kt</span>
          : <span>GROUND ONLY</span>
        }
        <span style={{ color: '#2a4a2a' }}>│</span>
        {state.notes && <span>{state.notes}</span>}
        <span style={{ flex: 1 }} />
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt=""
            style={{ width: 32, height: 32, imageRendering: 'pixelated', flexShrink: 0 }}
          />
        )}
      </div>
    </div>
  )
})
