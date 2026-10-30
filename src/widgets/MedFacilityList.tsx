/**
 * MedFacilityList — the fetched + custom facility list, extracted from
 * medplanner/app/src/ui/FacilitiesScreen.tsx. Fully controlled: reads
 * `state` (MedWorkspaceState), writes via `onPatch`. `rankedFacilities` is
 * the one prop that is NOT part of that slice (medplanner's own App.tsx
 * computes it as a `useMemo` over `rankFacilities(...)`, never persisted).
 *
 * Drag-reorder is hand-rolled native HTML5 drag-and-drop (no library) —
 * `buildNewOrder` reorders only within whichever sub-list (hospital vs.
 * chamber in dive mode) the drag happened in, re-interleaving the moved id
 * back into the full `facilityRankOrder` so items outside that sub-list
 * keep their relative positions.
 */

import { useState } from 'react'
import type { FacilityRecord, FacilityOverride } from '../med/facilities/merge'
import type { CustomFacility } from '../types/customFacility'
import type { CareTier, CapabilityFlag } from '../med/careLevel'
import { ALL_CAPABILITY_FLAGS, isNonTraumaCenter } from '../med/careLevel'
import type { FacilityScore } from '../med/rank'
import { formatTransit, tierDisplayLabel, transitColorClass } from '../med/rank'
import type { FacilityPace } from '../med/pace'
import { latLonToMgrs } from '../calc/geo'
import { directionsUrl } from '../util/mapsLink'
import type { MedWorkspaceState, MedWorkspacePatch } from '../med/workspaceState'

interface Props {
  state: MedWorkspaceState
  onPatch: MedWorkspacePatch
  rankedFacilities: FacilityScore[]
  onRefresh: () => void
  loading: boolean
}

const TIER_OPTIONS: { value: CareTier; label: string }[] = [
  { value: 4, label: 'Level I — Definitive (Major Trauma Centre)' },
  { value: 3, label: 'Level II — Major (Trauma Unit+)' },
  { value: 2, label: 'Level III — Intermediate (Trauma Unit / A&E)' },
  { value: 1, label: 'Level IV — Basic (Local ED / no trauma surgery)' },
  { value: 0, label: 'NTC — Non-Trauma Center (no 24/7 ED, not PACE-eligible)' },
]

function emptyCustom(): Omit<CustomFacility, 'id'> {
  return {
    name: '', lat: 0, lon: 0, phone: '', address: '',
    beds: 0, hasHelipad: false, tier: 4, capabilities: [], notes: '',
  }
}

function emptyOverride(fac: FacilityRecord): FacilityOverride {
  return {
    name: fac.name,
    phone: fac.phone,
    address: fac.address,
    beds: fac.beds,
    hasHelipad: fac.hasHelipad,
    tier: fac.tier,
    capabilities: [...fac.capabilities],
    notes: fac.notes ?? '',
    excludeFromPace: fac.excludeFromPace ?? false,
  }
}

function paceLetterForFacilityId(id: string, pace: FacilityPace | null | undefined): string {
  if (!pace) return ''
  for (const e of pace.entries) {
    if (e.facility.id === id) return e.letter
  }
  return ''
}

function paceColor(letter: string): string {
  switch (letter) {
    case 'P': return 'var(--pace-p)'
    case 'A': return 'var(--pace-a)'
    case 'C': return 'var(--pace-c)'
    case 'E': return 'var(--pace-e)'
    default:   return 'var(--text)'
  }
}

export function MedFacilityList({ state, onPatch, rankedFacilities, onRefresh, loading }: Props) {
  const [showAddCustom, setShowAddCustom] = useState(false)
  const [editCustomId, setEditCustomId] = useState<string | null>(null)
  const [customForm, setCustomForm] = useState<Omit<CustomFacility, 'id'>>(emptyCustom())

  // Inline-edit state for a fetched facility
  const [editFacId, setEditFacId] = useState<string | null>(null)
  const [overrideForm, setOverrideForm] = useState<FacilityOverride>({})

  // Drag-and-drop reorder state
  const [dragSrcId, setDragSrcId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const openAdd = () => { setCustomForm(emptyCustom()); setEditCustomId(null); setShowAddCustom(true) }
  const openEdit = (fac: CustomFacility) => { setCustomForm({ ...fac }); setEditCustomId(fac.id); setShowAddCustom(true) }

  const saveCustom = () => {
    if (!customForm.name.trim()) return
    if (editCustomId) {
      onPatch({ customFacilities: state.customFacilities.map(f => f.id === editCustomId ? { ...customForm, id: editCustomId } : f) })
    } else {
      const newFac: CustomFacility = { ...customForm, id: `custom-${Date.now()}` }
      onPatch({ customFacilities: [...state.customFacilities, newFac] })
    }
    setShowAddCustom(false)
  }

  const deleteCustom = (id: string) => {
    onPatch({ customFacilities: state.customFacilities.filter(f => f.id !== id) })
  }

  const toggleCap = (cap: CapabilityFlag) => {
    setCustomForm(f => ({
      ...f,
      capabilities: f.capabilities.includes(cap)
        ? f.capabilities.filter(c => c !== cap)
        : [...f.capabilities, cap],
    }))
  }

  const openFacEdit = (fac: FacilityRecord) => {
    setEditFacId(fac.id)
    // Pre-populate from existing override (if any) or from the current record
    const existing = state.facilityOverrides[fac.id]
    setOverrideForm(existing ?? emptyOverride(fac))
  }

  const saveFacOverride = (facId: string) => {
    onPatch({ facilityOverrides: { ...state.facilityOverrides, [facId]: { ...overrideForm } } })
    setEditFacId(null)
  }

  const clearFacOverride = (facId: string) => {
    const overrides = { ...state.facilityOverrides }
    delete overrides[facId]
    onPatch({ facilityOverrides: overrides })
    setEditFacId(null)
  }

  const toggleOverrideCap = (cap: CapabilityFlag) => {
    setOverrideForm(f => ({
      ...f,
      capabilities: (f.capabilities ?? []).includes(cap)
        ? (f.capabilities ?? []).filter(c => c !== cap)
        : [...(f.capabilities ?? []), cap],
    }))
  }

  const toggleExcludeFromPace = (fac: FacilityRecord) => {
    const current = state.facilityOverrides[fac.id]?.excludeFromPace ?? fac.excludeFromPace ?? false
    onPatch({
      facilityOverrides: {
        ...state.facilityOverrides,
        [fac.id]: { ...(state.facilityOverrides[fac.id] ?? {}), excludeFromPace: !current },
      },
    })
  }

  // Builds a new facilityRankOrder after a drag-drop within a sub-list (or the full list).
  // Items not in `group` stay in their current relative positions.
  function buildNewOrder(fromId: string, toId: string, group: FacilityScore[]): string[] {
    const baseOrder: string[] = state.facilityRankOrder ?? rankedFacilities.map(fs => fs.facility.id)
    const subIds = new Set(group.map(fs => fs.facility.id))
    const currentSubOrder = baseOrder.filter(id => subIds.has(id))
    const fromIdx = currentSubOrder.indexOf(fromId)
    const toIdx = currentSubOrder.indexOf(toId)
    if (fromIdx === -1 || toIdx === -1) return baseOrder
    const newSubOrder = [...currentSubOrder]
    const [moved] = newSubOrder.splice(fromIdx, 1)
    newSubOrder.splice(toIdx, 0, moved)
    let si = 0
    return baseOrder.map(id => subIds.has(id) ? newSubOrder[si++] : id)
  }

  function handleDrop(toId: string, group: FacilityScore[]) {
    if (!dragSrcId || dragSrcId === toId) { setDragSrcId(null); setDragOverId(null); return }
    const newOrder = buildNewOrder(dragSrcId, toId, group)
    onPatch({ facilityRankOrder: newOrder })
    setDragSrcId(null)
    setDragOverId(null)
  }

  const hospitalFacilities = rankedFacilities.filter(fs => !fs.facility.isChamber)
  const chamberFacilities = rankedFacilities.filter(fs => fs.facility.capabilities.includes('hyperbaric'))

  function renderFacilityItem(fs: FacilityScore, i: number, paceLetter: string, group: FacilityScore[]) {
    const fac = fs.facility
    const ov = state.facilityOverrides[fac.id]
    const isExcluded = ov?.excludeFromPace ?? fac.excludeFromPace ?? false
    const isNtc = isNonTraumaCenter(fac.tier) && !fac.isChamber
    const isMuted = isExcluded || isNtc
    const isEditingThis = editFacId === fac.id
    const isDragging = dragSrcId === fac.id
    const isDragOver = dragOverId === fac.id && dragSrcId !== fac.id
    return (
      <li
        key={fac.id}
        draggable
        onDragStart={() => setDragSrcId(fac.id)}
        onDragOver={e => { e.preventDefault(); setDragOverId(fac.id) }}
        onDrop={e => { e.preventDefault(); handleDrop(fac.id, group) }}
        onDragEnd={() => { setDragSrcId(null); setDragOverId(null) }}
        className={`facility-item${fac.isCustom ? ' custom' : ''}${isMuted ? ' excluded-from-pace' : ''}${isDragging ? ' dragging' : ''}${isDragOver ? ' drag-over' : ''}`}
      >
        <div className="row">
          <span className="drag-handle" title="Drag to reorder">⠿</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-dim)', minWidth: 24 }}>#{i+1}</span>
          <span className="facility-name" style={{ opacity: isMuted ? 0.5 : 1 }}>{fac.name}</span>
          {fac.isChamber && (
            <span style={{ marginLeft: 4, fontSize: 10, fontFamily: 'var(--mono)', color: '#26c6da', border: '1px solid #26c6da', padding: '1px 5px', borderRadius: 2 }}>
              CHAMBER
            </span>
          )}
          {paceLetter && !isExcluded && (
            <span style={{ marginLeft: 4, fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, color: paceColor(paceLetter) }}>
              [{paceLetter}]
            </span>
          )}
          {isExcluded && (
            <span style={{ marginLeft: 4, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--danger)' }}>
              [EXCL]
            </span>
          )}
          {!isExcluded && isNtc && (
            <span style={{ marginLeft: 4, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-dim)' }} title="No 24/7 ED — not PACE-eligible">
              [NTC]
            </span>
          )}
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => isEditingThis ? setEditFacId(null) : openFacEdit(fac)}>
            {isEditingThis ? 'Cancel' : 'Edit'}
          </button>
          <button
            className={`btn btn-sm${isExcluded ? ' btn-danger' : ''}`}
            onClick={() => toggleExcludeFromPace(fac)}
            title={isExcluded ? 'Re-include in PACE plan' : 'Exclude from PACE plan'}
          >
            {isExcluded ? 'Re-include' : 'Excl. PACE'}
          </button>
        </div>

        {isEditingThis && (
          <div style={{ margin: '8px 0', padding: '10px', background: 'var(--bg2)', borderRadius: 4, border: '1px solid var(--border)' }}>
            <div className="field-row">
              <div className="field">
                <label>Name</label>
                <input value={overrideForm.name ?? fac.name} onChange={e => setOverrideForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="field">
                <label>Care Level</label>
                <select
                  value={overrideForm.tier ?? fac.tier}
                  onChange={e => setOverrideForm(f => ({ ...f, tier: +e.target.value as CareTier }))}
                >
                  {TIER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Phone</label>
                <input value={overrideForm.phone ?? fac.phone} onChange={e => setOverrideForm(f => ({ ...f, phone: e.target.value }))} placeholder="+44 20 7188 7188" />
              </div>
              <div className="field">
                <label>Beds</label>
                <input type="number" min="0" value={overrideForm.beds ?? fac.beds} onChange={e => setOverrideForm(f => ({ ...f, beds: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="field">
              <label>Address</label>
              <input value={overrideForm.address ?? fac.address} onChange={e => setOverrideForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="field">
              <label>Notes</label>
              <input value={overrideForm.notes ?? ''} onChange={e => setOverrideForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Regional neurosurgery referral centre" />
            </div>
            <div className="field">
              <label>
                <input type="checkbox" checked={overrideForm.hasHelipad ?? fac.hasHelipad} onChange={e => setOverrideForm(f => ({ ...f, hasHelipad: e.target.checked }))} />{' '}
                Has helipad / suitable LZ
              </label>
            </div>
            <div className="field">
              <label>Capabilities</label>
              <div className="facility-caps">
                {ALL_CAPABILITY_FLAGS.map(cap => (
                  <button
                    key={cap}
                    className={`cap-badge${(overrideForm.capabilities ?? fac.capabilities).includes(cap) ? ' present' : ''}`}
                    onClick={() => toggleOverrideCap(cap)}
                    type="button"
                  >
                    {cap}
                  </button>
                ))}
              </div>
            </div>
            <div className="row mt8">
              <button className="btn" onClick={() => saveFacOverride(fac.id)}>Save Override</button>
              {state.facilityOverrides[fac.id] && (
                <button className="btn btn-sm" onClick={() => clearFacOverride(fac.id)}>Clear Override</button>
              )}
            </div>
          </div>
        )}

        <div className="facility-tier" style={{ opacity: isMuted ? 0.5 : 1 }}>{tierDisplayLabel(fac.tier)}</div>
        <div className="facility-detail dim" style={{ fontSize: 10 }}>
          {latLonToMgrs(fac.lat, fac.lon)}
        </div>
        <div className="transit-chips">
          {fs.transit.groundDurationS !== null && (
            <span className={`transit-chip ${transitColorClass(fs.transit.groundDurationS)}`}>
              Ground: {formatTransit(fs.transit.groundDurationS)}
            </span>
          )}
          {fac.hasHelipad && fs.transit.heloDurationS !== null && (
            <span className="transit-chip helo">
              Helo: {formatTransit(fs.transit.heloDurationS)}
            </span>
          )}
          {!fac.hasHelipad && <span className="transit-chip">No helipad</span>}
          {fac.beds > 0 && <span className="transit-chip">{fac.beds} beds</span>}
        </div>
        {(fac.capabilities.length > 0 || fac.pediatricOnly) && (
          <div className="facility-caps mt8" style={{ marginTop: 4 }}>
            {fac.capabilities.map(c => {
              const inf = (fac.inferredCapabilities ?? []).includes(c)
              return <span key={c} className={`cap-badge ${inf ? 'inferred' : 'present'}`}>{inf ? '~' : ''}{c}</span>
            })}
            {fac.pediatricOnly && (
              <span className="cap-badge" style={{ color: '#ff9800', borderColor: '#ff9800' }}>
                Pediatric only — excl. from PACE
              </span>
            )}
          </div>
        )}
        {fac.phone && <div className="facility-detail mt8">Ph: {fac.phone}</div>}
        {fac.address && (
          <a className="facility-detail" href={directionsUrl(fac.lat, fac.lon)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent2)', textDecoration: 'none', display: 'block' }}>
            {fac.address} ↗
          </a>
        )}
        {fac.notes && <div className="facility-detail dim">{fac.notes}</div>}
        {ov && <div className="facility-detail" style={{ color: 'var(--accent2)', fontSize: 10 }}>✎ Medic overrides applied</div>}
        <div className="facility-detail dim" style={{ fontSize: 9 }}>Source: {
          fac.source === 'registry' ? 'ACS Verified Registry'
          : fac.source === 'hifld'  ? 'HIFLD / US Gov'
          : fac.source === 'osm'    ? 'OpenStreetMap'
          : fac.source === 'chamber' ? 'Curated Chamber Registry'
          : fac.source === 'custom'  ? 'Custom / SOST'
          : fac.source
        }</div>
      </li>
    )
  }

  return (
    <div>
      {/* Target info + refresh */}
      <div className="section">
        <div className="section-header">FACILITY SEARCH</div>
        <div className="section-body">
          <div className="field-row-3">
            <div className="field">
              <label>Target</label>
              <span className="mono accent" style={{ fontSize: 12 }}>
                {state.targetLat !== 0 ? latLonToMgrs(state.targetLat, state.targetLon) : '—'}
              </span>
            </div>
            <div className="field">
              <label>Search Radius</label>
              <select value={state.searchRadiusM} onChange={e => onPatch({ searchRadiusM: +e.target.value })}>
                <option value={30000}>30 km</option>
                <option value={50000}>50 km</option>
                <option value={80000}>80 km</option>
                <option value={120000}>120 km</option>
                <option value={200000}>200 km</option>
              </select>
            </div>
          </div>
          <div className="row mt8">
            <button className="btn" onClick={() => onRefresh()} disabled={loading || !state.targetLat}>
              {loading ? 'Loading…' : 'Refresh Facilities'}
            </button>
            <button className="btn btn-sm" onClick={openAdd}>+ Custom Facility</button>
            <span className="dim mono" style={{ fontSize: 11 }}>
              {rankedFacilities.length} facilities ranked
            </span>
          </div>
        </div>
      </div>

      {/* Custom facility form */}
      {showAddCustom && (
        <div className="section">
          <div className="section-header">{editCustomId ? 'EDIT CUSTOM FACILITY' : 'ADD CUSTOM FACILITY'}</div>
          <div className="section-body">
            <div className="field-row">
              <div className="field">
                <label>Name *</label>
                <input value={customForm.name} onChange={e => setCustomForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. SOST Alpha" />
              </div>
              <div className="field">
                <label>Care Level</label>
                <select value={customForm.tier} onChange={e => setCustomForm(f => ({ ...f, tier: +e.target.value as CareTier }))}>
                  {TIER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="field-row-3">
              <div className="field">
                <label>Latitude</label>
                <input type="number" step="0.00001" value={customForm.lat || ''} onChange={e => setCustomForm(f => ({ ...f, lat: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="field">
                <label>Longitude</label>
                <input type="number" step="0.00001" value={customForm.lon || ''} onChange={e => setCustomForm(f => ({ ...f, lon: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="field">
                <label>Beds</label>
                <input type="number" min="0" value={customForm.beds || ''} onChange={e => setCustomForm(f => ({ ...f, beds: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Phone</label>
                <input value={customForm.phone} onChange={e => setCustomForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1-555-0100" />
              </div>
              <div className="field">
                <label>Address</label>
                <input value={customForm.address} onChange={e => setCustomForm(f => ({ ...f, address: e.target.value }))} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Helipad</label>
                <label style={{ flexDirection: 'row', gap: 8, textTransform: 'none', fontSize: 13 }}>
                  <input type="checkbox" checked={customForm.hasHelipad} onChange={e => setCustomForm(f => ({ ...f, hasHelipad: e.target.checked }))} />
                  Facility has a helipad / suitable LZ
                </label>
              </div>
              <div className="field">
                <label>Notes</label>
                <input value={customForm.notes} onChange={e => setCustomForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Forward surgical, 12-person team" />
              </div>
            </div>
            <div className="field">
              <label>Capabilities</label>
              <div className="facility-caps">
                {ALL_CAPABILITY_FLAGS.map(cap => (
                  <button
                    key={cap}
                    className={`cap-badge${customForm.capabilities.includes(cap) ? ' present' : ''}`}
                    onClick={() => toggleCap(cap)}
                    type="button"
                  >
                    {cap}
                  </button>
                ))}
              </div>
            </div>
            <div className="row mt8">
              <button className="btn" onClick={saveCustom}>Save</button>
              <button className="btn btn-sm" onClick={() => setShowAddCustom(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Custom facilities */}
      {state.customFacilities.length > 0 && (
        <div className="section">
          <div className="section-header">CUSTOM FACILITIES</div>
          <div className="section-body">
            <ul className="facility-list">
              {state.customFacilities.map(fac => (
                <li key={fac.id} className="facility-item custom">
                  <div className="row">
                    <span className="facility-name">{fac.name}</span>
                    <span className="spacer" />
                    <button className="btn btn-sm" onClick={() => openEdit(fac)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteCustom(fac.id)}>✕</button>
                  </div>
                  <div className="facility-tier">{tierDisplayLabel(fac.tier)} | Beds: {fac.beds || '?'} | Helipad: {fac.hasHelipad ? 'Yes' : 'No'}</div>
                  <div className="facility-detail dim">
                    {latLonToMgrs(fac.lat, fac.lon)}
                  </div>
                  {fac.phone && <div className="facility-detail">Ph: {fac.phone}</div>}
                  {fac.address && (
                    <a className="facility-detail" href={directionsUrl(fac.lat, fac.lon)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent2)', textDecoration: 'none', display: 'block' }}>
                      {fac.address} ↗
                    </a>
                  )}
                  {fac.notes && <div className="facility-detail dim">{fac.notes}</div>}
                  {fac.capabilities.length > 0 && (
                    <div className="facility-caps">
                      {fac.capabilities.map(c => (
                        <span key={c} className="cap-badge present">{c}</span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Ranked facility lists — split in dive mode */}
      {state.diveMode ? (
        <>
          <div className="section">
            <div className="section-header" style={{ color: 'var(--accent2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>HOSPITAL FACILITIES — TRAUMA / MECHANICAL ({hospitalFacilities.length})</span>
              {state.facilityRankOrder && (
                <button className="btn btn-sm" style={{ fontSize: 10 }} onClick={() => onPatch({ facilityRankOrder: null })}>Reset Order</button>
              )}
            </div>
            <div className="section-body">
              {hospitalFacilities.length === 0 ? (
                <p className="no-results">No hospital facilities loaded. Set target coordinates and click Refresh.</p>
              ) : (
                <ul className="facility-list">
                  {hospitalFacilities.map((fs, i) => renderFacilityItem(fs, i, paceLetterForFacilityId(fs.facility.id, state.facilityPace), hospitalFacilities))}
                </ul>
              )}
            </div>
          </div>

          <div className="section">
            <div className="section-header" style={{ color: '#26c6da' }}>
              HYPERBARIC CHAMBERS — RECOMPRESSION / DCS ({chamberFacilities.length})
            </div>
            <div className="section-body">
              {chamberFacilities.length === 0 ? (
                <p className="no-results">No hyperbaric chambers in search radius. Expand the search radius or add a custom facility with the &quot;hyperbaric&quot; capability.</p>
              ) : (
                <ul className="facility-list">
                  {chamberFacilities.map((fs, i) => renderFacilityItem(fs, i, paceLetterForFacilityId(fs.facility.id, state.chamberPace), chamberFacilities))}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="section">
          <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>RANKED FACILITIES ({rankedFacilities.length})</span>
            {state.facilityRankOrder && (
              <button className="btn btn-sm" style={{ fontSize: 10 }} onClick={() => onPatch({ facilityRankOrder: null })}>Reset Order</button>
            )}
          </div>
          <div className="section-body">
            {rankedFacilities.length === 0 ? (
              <p className="no-results">No facilities loaded. Set target coordinates and click Refresh.</p>
            ) : (
              <ul className="facility-list">
                {rankedFacilities.map((fs, i) => renderFacilityItem(fs, i, paceLetterForFacilityId(fs.facility.id, state.facilityPace), rankedFacilities))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
