/**
 * MedPacePreview — Facility PACE, Echelons of Care, Chamber PACE (dive mode),
 * and Treatment PACE, extracted from medplanner/app/src/ui/PaceScreen.tsx.
 * Fully controlled: every PACE plan and its overrides are read off `state`
 * (MedWorkspaceState) and patched via `onPatch` — the only prop NOT already
 * part of that slice is `rankedFacilities` (medplanner's own App.tsx computes
 * it as a `useMemo` over `rankFacilities(...)`, never persisted).
 */

import { useState } from 'react'
import type { FacilityScore } from '../med/rank'
import { formatTransit, transitColorClass } from '../med/rank'
import type { PaceLetter } from '../med/pace'
import { careLevelRoman } from '../med/careLevel'
import { formatTricareLanguageNote } from '../med/tricareLanguage'
import { directionsUrl } from '../util/mapsLink'
import type { MedWorkspaceState, MedWorkspacePatch } from '../med/workspaceState'

function paceColor(letter: PaceLetter): string {
  switch (letter) {
    case 'P': return 'var(--pace-p)'
    case 'A': return 'var(--pace-a)'
    case 'C': return 'var(--pace-c)'
    case 'E': return 'var(--pace-e)'
  }
}

/** Moves the item at `fromIdx` to `toIdx`, shifting the rest. */
function reorder<T>(arr: T[], fromIdx: number, toIdx: number): T[] {
  const copy = [...arr]
  const [moved] = copy.splice(fromIdx, 1)
  copy.splice(toIdx, 0, moved)
  return copy
}

interface Props {
  state: MedWorkspaceState
  onPatch: MedWorkspacePatch
  rankedFacilities: FacilityScore[]
}

export function MedPacePreview({ state, onPatch, rankedFacilities }: Props) {
  const { facilityPace, chamberPace, treatmentPace, echelonPlan, facilities: allFacilities } = state
  const [editTreatSlot, setEditTreatSlot] = useState<PaceLetter | null>(null)
  const [treatForm, setTreatForm] = useState<{ label: string; detail: string }>({ label: '', detail: '' })

  // Drag-to-reorder state — one source/over pair per PACE table, so dragging
  // in one table never interferes with the others.
  const [facDragLetter, setFacDragLetter] = useState<PaceLetter | null>(null)
  const [facDragOverLetter, setFacDragOverLetter] = useState<PaceLetter | null>(null)
  const [chamberDragLetter, setChamberDragLetter] = useState<PaceLetter | null>(null)
  const [chamberDragOverLetter, setChamberDragOverLetter] = useState<PaceLetter | null>(null)
  const [treatDragLetter, setTreatDragLetter] = useState<PaceLetter | null>(null)
  const [treatDragOverLetter, setTreatDragOverLetter] = useState<PaceLetter | null>(null)

  // Reordering a PACE table pins every slot to an explicit facility id (or
  // treatment content) for the letters involved — the letters themselves
  // (P/A/C/E) never move, only what fills them, same as a single-slot override.
  const handleFacilityPaceDrop = (toLetter: PaceLetter) => {
    const fromLetter = facDragLetter
    setFacDragLetter(null)
    setFacDragOverLetter(null)
    if (!fromLetter || fromLetter === toLetter || !facilityPace) return
    const letterSeq = facilityPace.entries.map(e => e.letter)
    const idSeq = facilityPace.entries.map(e => e.facility.id)
    const fromIdx = letterSeq.indexOf(fromLetter)
    const toIdx = letterSeq.indexOf(toLetter)
    if (fromIdx === -1 || toIdx === -1) return
    const newIds = reorder(idSeq, fromIdx, toIdx)
    const overrides = { ...state.facilityPaceOverrides }
    letterSeq.forEach((letter, i) => { overrides[letter] = newIds[i] })
    onPatch({ facilityPaceOverrides: overrides })
  }

  const handleChamberPaceDrop = (toLetter: PaceLetter) => {
    const fromLetter = chamberDragLetter
    setChamberDragLetter(null)
    setChamberDragOverLetter(null)
    if (!fromLetter || fromLetter === toLetter || !chamberPace) return
    const letterSeq = chamberPace.entries.map(e => e.letter)
    const idSeq = chamberPace.entries.map(e => e.facility.id)
    const fromIdx = letterSeq.indexOf(fromLetter)
    const toIdx = letterSeq.indexOf(toLetter)
    if (fromIdx === -1 || toIdx === -1) return
    const newIds = reorder(idSeq, fromIdx, toIdx)
    const overrides = { ...state.chamberPaceOverrides }
    letterSeq.forEach((letter, i) => { overrides[letter] = newIds[i] })
    onPatch({ chamberPaceOverrides: overrides })
  }

  const handleTreatmentPaceDrop = (toLetter: PaceLetter) => {
    const fromLetter = treatDragLetter
    setTreatDragLetter(null)
    setTreatDragOverLetter(null)
    if (!fromLetter || fromLetter === toLetter || !treatmentPace) return
    const letterSeq = treatmentPace.entries.map(e => e.letter)
    const contentSeq = treatmentPace.entries.map(e => ({ label: e.label, detail: e.detail }))
    const fromIdx = letterSeq.indexOf(fromLetter)
    const toIdx = letterSeq.indexOf(toLetter)
    if (fromIdx === -1 || toIdx === -1) return
    const newContent = reorder(contentSeq, fromIdx, toIdx)
    const overrides = { ...state.treatmentPaceOverrides }
    letterSeq.forEach((letter, i) => { overrides[letter] = newContent[i] })
    onPatch({ treatmentPaceOverrides: overrides })
  }

  const setFacilityPaceOverride = (letter: PaceLetter, facilityId: string | '') => {
    onPatch({
      facilityPaceOverrides: facilityId
        ? { ...state.facilityPaceOverrides, [letter]: facilityId }
        : Object.fromEntries(Object.entries(state.facilityPaceOverrides).filter(([k]) => k !== letter)),
    })
  }

  const setChamberPaceOverride = (letter: PaceLetter, facilityId: string | '') => {
    onPatch({
      chamberPaceOverrides: facilityId
        ? { ...state.chamberPaceOverrides, [letter]: facilityId }
        : Object.fromEntries(Object.entries(state.chamberPaceOverrides).filter(([k]) => k !== letter)),
    })
  }

  const openTreatEdit = (letter: PaceLetter) => {
    const entry = treatmentPace?.entries.find(e => e.letter === letter)
    setTreatForm({ label: entry?.label ?? '', detail: entry?.detail ?? '' })
    setEditTreatSlot(letter)
  }

  const saveTreatEdit = () => {
    if (!editTreatSlot) return
    onPatch({ treatmentPaceOverrides: { ...state.treatmentPaceOverrides, [editTreatSlot]: treatForm } })
    setEditTreatSlot(null)
  }

  const clearTreatOverride = (letter: PaceLetter) => {
    onPatch({
      treatmentPaceOverrides: Object.fromEntries(Object.entries(state.treatmentPaceOverrides).filter(([k]) => k !== letter)),
    })
  }

  return (
    <div>
      {/* ── Facility PACE (hospital / trauma) ────────────────────────────────── */}
      <div className="section">
        <div className="section-header">
          {state.diveMode ? 'HOSPITAL PACE — TRAUMA / MECHANICAL' : 'FACILITY PACE PLAN'}
        </div>
        <div className="section-body">
          {facilityPace?.warnings && facilityPace.warnings.length > 0 && (
            <div className="phased-banner" style={{ borderColor: 'var(--warn)', marginBottom: 10 }}>
              <strong>⚠ Eligibility Warning:</strong>
              {facilityPace.warnings.map((w, i) => (
                <div key={i} style={{ marginTop: 2, fontSize: 11 }}>{w}</div>
              ))}
            </div>
          )}

          {facilityPace && (['P', 'A', 'C', 'E'] as PaceLetter[]).map(letter => {
            const entry = facilityPace.entries.find(e => e.letter === letter)
            const facilityOptions = (
              <>
                {rankedFacilities.map(fs => (
                  <option key={fs.facility.id} value={fs.facility.id}>
                    {fs.facility.name} (Lvl {careLevelRoman(fs.facility.tier)}, {formatTransit(fs.transit.effectiveDurationS)})
                  </option>
                ))}
                {allFacilities.filter(f => !rankedFacilities.find(r => r.facility.id === f.id)).map(f => (
                  <option key={f.id} value={f.id}>{f.name} (unranked)</option>
                ))}
              </>
            )

            // Slot has nothing auto-assigned (e.g. no trauma-capable facility left
            // for this letter) and no override set yet — still render the row so
            // the medic can manually add one (including an NTC facility).
            if (!entry) {
              return (
                <div key={letter} className="pace-entry pace-entry-empty" style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: paceColor(letter), minWidth: 20 }}>
                      {letter}
                    </span>
                    <span className="mono" style={{ color: 'var(--text-dim)', fontSize: 13, fontStyle: 'italic' }}>
                      No facility assigned
                    </span>
                  </div>
                  <div style={{ marginLeft: 28 }}>
                    <select
                      value=""
                      onChange={e => { if (e.target.value) setFacilityPaceOverride(letter, e.target.value) }}
                      style={{ fontSize: 11, padding: '3px 6px', width: 'auto', maxWidth: 340 }}
                    >
                      <option value="">— Add a facility —</option>
                      {facilityOptions}
                    </select>
                  </div>
                </div>
              )
            }

            const fac = entry.facility
            const isDragging = facDragLetter === letter
            const isDragOver = facDragOverLetter === letter && facDragLetter !== letter
            return (
              <div
                key={letter}
                draggable
                onDragStart={() => setFacDragLetter(letter)}
                onDragOver={e => { e.preventDefault(); setFacDragOverLetter(letter) }}
                onDrop={e => { e.preventDefault(); handleFacilityPaceDrop(letter) }}
                onDragEnd={() => { setFacDragLetter(null); setFacDragOverLetter(null) }}
                className={`pace-entry${isDragging ? ' dragging' : ''}${isDragOver ? ' drag-over' : ''}`}
                style={{ marginBottom: 14 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className="drag-handle" title="Drag to reorder">⠿</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: paceColor(letter), minWidth: 20 }}>
                    {letter}
                  </span>
                  <span className="mono" style={{ fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>
                    {fac.name}
                  </span>
                  {entry.overridden && (
                    <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--warn)', border: '1px solid var(--warn)', padding: '1px 5px', borderRadius: 2 }}>
                      OVERRIDE
                    </span>
                  )}
                  {fac.isCustom && (
                    <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent2)', border: '1px solid var(--accent2)', padding: '1px 5px', borderRadius: 2 }}>
                      CUSTOM
                    </span>
                  )}
                </div>

                {entry.phasedNote && (
                  <div style={{ fontSize: 11, color: 'var(--warn)', fontFamily: 'var(--mono)', marginBottom: 4, marginLeft: 28 }}>
                    ⚠ {entry.phasedNote}
                  </div>
                )}

                <div style={{ marginLeft: 28 }}>
                  <div className="transit-chips">
                    {entry.transit.groundDurationS !== null && (
                      <span className={`transit-chip ${transitColorClass(entry.transit.groundDurationS, state.rankingParams.goldenHourMin * 60)}`}>
                        Ground: {formatTransit(entry.transit.groundDurationS)}
                      </span>
                    )}
                    {fac.hasHelipad && entry.transit.heloDurationS !== null && (
                      <span className="transit-chip helo">
                        Helo: {formatTransit(entry.transit.heloDurationS)}
                      </span>
                    )}
                    <span className="transit-chip">Helipad: {fac.hasHelipad ? 'Yes' : 'No'}</span>
                    {fac.beds > 0 && <span className="transit-chip">{fac.beds} beds</span>}
                  </div>
                  {fac.capabilities.length > 0 && (
                    <div className="facility-caps" style={{ marginTop: 4 }}>
                      {fac.capabilities.map(c => {
                        const inf = (fac.inferredCapabilities ?? []).includes(c)
                        return <span key={c} className={`cap-badge ${inf ? 'inferred' : 'present'}`}>{inf ? '~' : ''}{c}</span>
                      })}
                    </div>
                  )}
                  {fac.phone && <div className="facility-detail" style={{ marginTop: 4 }}>Ph: {fac.phone}</div>}
                  {fac.address && (
                    <a className="facility-detail" href={directionsUrl(fac.lat, fac.lon)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent2)', textDecoration: 'none', display: 'block' }}>
                      {fac.address} ↗
                    </a>
                  )}
                </div>

                {/* Slot override selector */}
                <div style={{ marginLeft: 28, marginTop: 6 }}>
                  <select
                    value={state.facilityPaceOverrides[letter] ?? fac.id}
                    onChange={e => setFacilityPaceOverride(letter, e.target.value)}
                    style={{ fontSize: 11, padding: '3px 6px', width: 'auto', maxWidth: 340 }}
                  >
                    {facilityOptions}
                  </select>
                  {state.facilityPaceOverrides[letter] && (
                    <button className="btn btn-sm btn-warn" style={{ marginLeft: 6 }} onClick={() => setFacilityPaceOverride(letter, '')}>
                      Clear override
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {/* TRICARE Overseas language-assistance note — non-English countries only */}
          {facilityPace && (() => {
            const langNote = formatTricareLanguageNote(state.countryCode)
            return langNote ? (
              <div style={{
                marginTop: 10,
                padding: '5px 8px',
                border: '1px solid var(--border)',
                borderRadius: 3,
                fontSize: 11,
                fontFamily: 'var(--mono)',
                color: 'var(--text-dim)',
                lineHeight: 1.5,
              }}>
                <span style={{ fontWeight: 700 }}>Interpreter (TRICARE Overseas):</span>{' '}
                {langNote}
              </div>
            ) : null
          })()}

          {!facilityPace && (
            <p className="no-results">No PACE plan generated yet. Load facilities and refresh.</p>
          )}
        </div>
      </div>

      {/* ── Echelons of Care (macro layer — separate card) ───────────────────── */}
      {echelonPlan && (
        <div className="section">
          <div className="section-header" style={{ color: '#26c6da', borderColor: '#26c6da' }}>
            ECHELONS OF CARE
          </div>
          <div className="section-body">
            <p className="dim mono" style={{ fontSize: 11, marginBottom: 10, lineHeight: 1.6 }}>
              Onward route to Level I definitive care — the macro layer above the Facility PACE plan.
              Used when PACE facilities are unable to handle the injuries.
            </p>

            <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              {echelonPlan.stabilizeAt.isCustom && (
                <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent2)', border: '1px solid var(--accent2)', padding: '1px 5px', borderRadius: 2 }}>
                  SOST
                </span>
              )}
              <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
                {echelonPlan.environment === 'training' ? 'TRAINING — civilian handoff at stabilize node' : 'OPERATIONAL'}
              </span>
            </div>

            {/* Leg 1: POI → stabilize */}
            <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 4, borderLeft: '3px solid #4caf50' }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: '#4caf50', fontWeight: 700, marginBottom: 4, letterSpacing: 1 }}>
                LEG 1 — EVACUATION TO STABILIZE
              </div>
              <div style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                POI →[{echelonPlan.legs[0].assetLabel}]→ {echelonPlan.stabilizeAt.name}
              </div>
              <div className="transit-chips" style={{ marginTop: 4 }}>
                <span className={`transit-chip ${echelonPlan.legs[0].transit.effectiveDurationS <= 3600 ? 'fast' : 'slow'}`}>
                  {formatTransit(echelonPlan.legs[0].transit.effectiveDurationS)}
                </span>
                {echelonPlan.legs[0].transit.groundDurationS !== null && (
                  <span className="transit-chip">Ground: {formatTransit(echelonPlan.legs[0].transit.groundDurationS)}</span>
                )}
                {echelonPlan.legs[0].transit.heloDurationS !== null && (
                  <span className="transit-chip helo">Helo: {formatTransit(echelonPlan.legs[0].transit.heloDurationS)}</span>
                )}
              </div>
              {echelonPlan.legs[0].notes?.map((n, i) => (
                <div key={i} style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)', marginTop: 4 }}>
                  ↳ {n}
                </div>
              ))}
              {echelonPlan.stabilizeAt.phone && (
                <div className="facility-detail" style={{ marginTop: 4 }}>Ph: {echelonPlan.stabilizeAt.phone}</div>
              )}
              {echelonPlan.stabilizeAt.address && (
                <a className="facility-detail" href={directionsUrl(echelonPlan.stabilizeAt.lat, echelonPlan.stabilizeAt.lon)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent2)', textDecoration: 'none', display: 'block' }}>
                  {echelonPlan.stabilizeAt.address} ↗
                </a>
              )}
            </div>

            {/* Leg 2: stabilize → definitive */}
            <div style={{ padding: '8px 12px', background: 'var(--bg2)', borderRadius: 4, borderLeft: `3px solid ${echelonPlan.environment === 'training' ? '#ff9800' : '#26c6da'}` }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: echelonPlan.environment === 'training' ? '#ff9800' : '#26c6da', fontWeight: 700, marginBottom: 4, letterSpacing: 1 }}>
                LEG 2 — TRANSFER TO DEFINITIVE CARE
              </div>
              <div style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                {echelonPlan.stabilizeAt.name} →[{echelonPlan.legs[1].assetLabel}]→ {echelonPlan.definitive.name}
              </div>
              <div className="transit-chips" style={{ marginTop: 4 }}>
                <span className={`transit-chip ${echelonPlan.legs[1].transit.effectiveDurationS <= 3600 ? 'fast' : 'slow'}`}>
                  {formatTransit(echelonPlan.legs[1].transit.effectiveDurationS)}
                </span>
                {echelonPlan.legs[1].transit.groundDurationS !== null && (
                  <span className="transit-chip">Ground: {formatTransit(echelonPlan.legs[1].transit.groundDurationS)}</span>
                )}
                {echelonPlan.legs[1].transit.heloDurationS !== null && (
                  <span className="transit-chip helo">Helo: {formatTransit(echelonPlan.legs[1].transit.heloDurationS)}</span>
                )}
                {echelonPlan.legs[1].transit.fixedWingDurationS != null && (
                  <span className="transit-chip fixedwing">C-130: {formatTransit(echelonPlan.legs[1].transit.fixedWingDurationS)}</span>
                )}
              </div>
              {echelonPlan.legs[1].notes?.map((n, i) => (
                <div key={i} style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)', marginTop: 4 }}>
                  ↳ {n}
                </div>
              ))}
              {echelonPlan.definitive.phone && (
                <div className="facility-detail" style={{ marginTop: 4 }}>Ph: {echelonPlan.definitive.phone}</div>
              )}
              {echelonPlan.definitive.address && (
                <a className="facility-detail" href={directionsUrl(echelonPlan.definitive.lat, echelonPlan.definitive.lon)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent2)', textDecoration: 'none', display: 'block' }}>
                  {echelonPlan.definitive.address} ↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Chamber PACE (dive mode only) ────────────────────────────────────── */}
      {state.diveMode && (
        <div className="section">
          <div className="section-header" style={{ color: '#26c6da', borderColor: '#26c6da' }}>
            CHAMBER PACE — RECOMPRESSION / HYPERBARIC
          </div>
          <div className="section-body">
            <p className="dim mono" style={{ fontSize: 11, marginBottom: 10 }}>
              For decompression illness, arterial gas embolism, and other hyperbaric-specific
              injuries. Recompression is time-critical — use ground transport (no altitude gain).
            </p>

            {chamberPace?.warnings && chamberPace.warnings.length > 0 && (
              <div className="phased-banner" style={{ borderColor: 'var(--warn)', marginBottom: 10 }}>
                <strong>⚠ Chamber Warning:</strong>
                {chamberPace.warnings.map((w, i) => (
                  <div key={i} style={{ marginTop: 2, fontSize: 11 }}>{w}</div>
                ))}
              </div>
            )}

            {chamberPace?.entries.map(entry => {
              const fac = entry.facility
              const letter = entry.letter
              const isDragging = chamberDragLetter === letter
              const isDragOver = chamberDragOverLetter === letter && chamberDragLetter !== letter
              return (
                <div
                  key={letter}
                  draggable
                  onDragStart={() => setChamberDragLetter(letter)}
                  onDragOver={e => { e.preventDefault(); setChamberDragOverLetter(letter) }}
                  onDrop={e => { e.preventDefault(); handleChamberPaceDrop(letter) }}
                  onDragEnd={() => { setChamberDragLetter(null); setChamberDragOverLetter(null) }}
                  className={`pace-entry${isDragging ? ' dragging' : ''}${isDragOver ? ' drag-over' : ''}`}
                  style={{ marginBottom: 14 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span className="drag-handle" title="Drag to reorder">⠿</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: paceColor(letter), minWidth: 20 }}>
                      {letter}
                    </span>
                    <span className="mono" style={{ fontWeight: 700, color: '#26c6da', fontSize: 13 }}>
                      {fac.name}
                    </span>
                    {entry.overridden && (
                      <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--warn)', border: '1px solid var(--warn)', padding: '1px 5px', borderRadius: 2 }}>
                        OVERRIDE
                      </span>
                    )}
                    {fac.isChamber && (
                      <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: '#26c6da', border: '1px solid #26c6da', padding: '1px 5px', borderRadius: 2 }}>
                        CHAMBER
                      </span>
                    )}
                  </div>

                  <div style={{ marginLeft: 28 }}>
                    <div className="transit-chips">
                      {entry.transit.groundDurationS !== null && (
                        <span className={`transit-chip ${transitColorClass(entry.transit.groundDurationS, state.rankingParams.goldenHourMin * 60)}`}>
                          Ground: {formatTransit(entry.transit.groundDurationS)}
                        </span>
                      )}
                      <span className="transit-chip" style={{ color: '#ffcc02' }}>⚠ No altitude (DCS risk)</span>
                      {fac.beds > 0 && <span className="transit-chip">{fac.beds} beds</span>}
                    </div>
                    {fac.phone && <div className="facility-detail" style={{ marginTop: 4 }}>Ph: {fac.phone}</div>}
                    {fac.address && (
                      <a className="facility-detail" href={directionsUrl(fac.lat, fac.lon)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent2)', textDecoration: 'none', display: 'block' }}>
                        {fac.address} ↗
                      </a>
                    )}
                    {fac.notes && <div className="facility-detail dim">{fac.notes}</div>}
                  </div>

                  {/* Slot override selector — scoped to chamberPaceOverrides */}
                  <div style={{ marginLeft: 28, marginTop: 6 }}>
                    <select
                      value={state.chamberPaceOverrides[letter] ?? fac.id}
                      onChange={e => setChamberPaceOverride(letter, e.target.value)}
                      style={{ fontSize: 11, padding: '3px 6px', width: 'auto', maxWidth: 340 }}
                    >
                      {rankedFacilities
                        .filter(fs => fs.facility.capabilities.includes('hyperbaric'))
                        .map(fs => (
                          <option key={fs.facility.id} value={fs.facility.id}>
                            {fs.facility.name} ({formatTransit(fs.transit.effectiveDurationS)})
                          </option>
                        ))}
                      {allFacilities
                        .filter(f =>
                          f.capabilities.includes('hyperbaric') &&
                          !rankedFacilities.find(r => r.facility.id === f.id),
                        )
                        .map(f => (
                          <option key={f.id} value={f.id}>{f.name} (unranked)</option>
                        ))}
                    </select>
                    {state.chamberPaceOverrides[letter] && (
                      <button className="btn btn-sm btn-warn" style={{ marginLeft: 6 }} onClick={() => setChamberPaceOverride(letter, '')}>
                        Clear override
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {!chamberPace && (
              <p className="no-results">No chamber PACE generated. Load facilities and refresh.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Treatment PACE ───────────────────────────────────────────────────── */}
      <div className="section">
        <div className="section-header">TREATMENT PACE PLAN</div>
        <div className="section-body">
          <div className="row" style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, flexShrink: 0 }}>Environment:</label>
            <select
              value={state.environment}
              onChange={e => onPatch({ environment: e.target.value as 'training' | 'operational' })}
              style={{ fontSize: 12, width: 'auto' }}
            >
              <option value="training">Training</option>
              <option value="operational">Operational</option>
            </select>
            {state.environment === 'operational' && (
              <span style={{ fontSize: 11, color: 'var(--warn)', fontFamily: 'var(--mono)', marginLeft: 8 }}>
                ⚠ Operational — Theater CASEVAC/MEDEVAC plan active
              </span>
            )}
          </div>

          {treatmentPace?.entries.map(entry => {
            const letter = entry.letter as PaceLetter
            const isDragging = treatDragLetter === letter
            const isDragOver = treatDragOverLetter === letter && treatDragLetter !== letter
            return (
            <div
              key={letter}
              draggable
              onDragStart={() => setTreatDragLetter(letter)}
              onDragOver={e => { e.preventDefault(); setTreatDragOverLetter(letter) }}
              onDrop={e => { e.preventDefault(); handleTreatmentPaceDrop(letter) }}
              onDragEnd={() => { setTreatDragLetter(null); setTreatDragOverLetter(null) }}
              className={`pace-entry${isDragging ? ' dragging' : ''}${isDragOver ? ' drag-over' : ''}`}
              style={{ marginBottom: 14 }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="drag-handle" title="Drag to reorder">⠿</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: paceColor(letter), minWidth: 20 }}>
                  {entry.letter}
                </span>
                <span className="mono" style={{ fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>
                  {entry.label}
                </span>
                {entry.overridden && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--warn)', border: '1px solid var(--warn)', padding: '1px 5px', borderRadius: 2 }}>
                    OVERRIDE
                  </span>
                )}
                <span className="spacer" />
                <button className="btn btn-sm" onClick={() => openTreatEdit(entry.letter as PaceLetter)}>Edit</button>
                {entry.overridden && (
                  <button className="btn btn-sm btn-warn" onClick={() => clearTreatOverride(entry.letter as PaceLetter)}>Reset</button>
                )}
              </div>
              <div style={{ marginLeft: 28, marginTop: 3, fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--mono)', lineHeight: 1.5 }}>
                {entry.detail}
              </div>
            </div>
            )
          })}

          {!treatmentPace && (
            <p className="no-results">Set target coordinates to generate treatment PACE.</p>
          )}
        </div>
      </div>

      {/* Treatment edit modal */}
      {editTreatSlot && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: 20, maxWidth: 480, width: '100%' }}>
            <div className="section-header" style={{ marginBottom: 12 }}>EDIT TREATMENT PACE — {editTreatSlot}</div>
            <div className="field" style={{ marginBottom: 8 }}>
              <label>Label</label>
              <input value={treatForm.label} onChange={e => setTreatForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Detail / Instructions</label>
              <textarea value={treatForm.detail} onChange={e => setTreatForm(f => ({ ...f, detail: e.target.value }))} rows={4} />
            </div>
            <div className="row">
              <button className="btn" onClick={saveTreatEdit}>Save</button>
              <button className="btn btn-sm" onClick={() => setEditTreatSlot(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
