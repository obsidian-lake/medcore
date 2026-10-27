/**
 * MedMissionParamsCard — the "MISSION PARAMETERS" card, extracted from
 * medplanner/app/src/ui/TargetScreen.tsx (environment/dive-mode/rotary-wing/
 * transfer-asset/op-name/unit fields). Fully controlled: reads `state`
 * (MedWorkspaceState), writes via `onPatch`. `hideOpName`/`hideUnit` let a
 * host that already has its own op-name/unit source (e.g. Mission
 * Planner's own Mission Data tab) suppress those two fields rather than
 * showing a second, disconnected pair.
 *
 * Markup reuses the suite-wide `.section`/`.field-row`/`.field` class
 * vocabulary (defined in each consumer app's own CSS, same as every other
 * shared widget here — see slide/BrandEditor.tsx) rather than inline
 * styles, so it renders identically wherever that vocabulary already exists.
 */

import { AIRFRAMES } from '../med/routing/ors'
import type { MedWorkspaceState, MedWorkspacePatch } from '../med/workspaceState'

interface Props {
  state: MedWorkspaceState
  onPatch: MedWorkspacePatch
  /** Suppress the Op Name field — the host has its own source for it. */
  hideOpName?: boolean
  /** Suppress the Unit / Callsign field — the host has its own source for it. */
  hideUnit?: boolean
}

export function MedMissionParamsCard({ state, onPatch, hideOpName, hideUnit }: Props) {
  return (
    <div className="section">
      <div className="section-header">MISSION PARAMETERS</div>
      <div className="section-body">
        <div className="field-row-3">
          <div className="field">
            <label>Environment</label>
            <select
              value={state.environment}
              onChange={e => onPatch({ environment: e.target.value as 'training' | 'operational' })}
            >
              <option value="training">Training</option>
              <option value="operational">Operational</option>
            </select>
          </div>
          <div className="field">
            <label>Rotary Wing Available?</label>
            <select
              value={state.rotaryWingAvailable ? 'yes' : 'no'}
              onChange={e => onPatch({ rotaryWingAvailable: e.target.value === 'yes' })}
            >
              <option value="yes">Yes — air transit enabled</option>
              <option value="no">No — ground only</option>
            </select>
          </div>
          <div className="field">
            <label>Search Radius</label>
            <select
              value={state.searchRadiusM}
              onChange={e => onPatch({ searchRadiusM: +e.target.value })}
            >
              <option value={30000}>30 km</option>
              <option value={50000}>50 km</option>
              <option value={80000}>80 km</option>
              <option value={120000}>120 km</option>
              <option value={200000}>200 km</option>
            </select>
          </div>
        </div>
        <div className="field-row" style={{ marginTop: 8 }}>
          <div className="field">
            <label>Dive Operation?</label>
            <select
              value={state.diveMode ? 'yes' : 'no'}
              onChange={e => onPatch({ diveMode: e.target.value === 'yes' })}
            >
              <option value="no">No — standard PACE</option>
              <option value="yes">Yes — recompression chamber required</option>
            </select>
          </div>
        </div>
        {state.diveMode && (
          <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>
            PACE limited to facilities with a recompression/hyperbaric chamber.
            If a known chamber isn't tagged in source data, add the "hyperbaric" capability
            to that facility on the Facilities tab.
          </div>
        )}
        {state.rotaryWingAvailable && (
          <>
            <div className="field-row">
              <div className="field">
                <label>Organic Airframe</label>
                <select
                  value={state.rotaryWingType}
                  onChange={e => {
                    const af = AIRFRAMES.find(a => a.id === e.target.value)
                    if (!af) return
                    const update: Partial<MedWorkspaceState> = { rotaryWingType: af.id }
                    if (af.speedKt > 0) update.heloSpeedKt = af.speedKt
                    onPatch(update)
                  }}
                >
                  <option value="">— Select airframe —</option>
                  {AIRFRAMES.map(af => (
                    <option key={af.id} value={af.id}>{af.label}{af.speedKt > 0 ? ` (~${af.speedKt} kt)` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Cruise Speed (kts)</label>
                <input
                  type="number" min="60" max="300"
                  value={state.heloSpeedKt}
                  onChange={e => onPatch({ heloSpeedKt: parseInt(e.target.value) || 130, rotaryWingType: 'custom' })}
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Transfer Asset{state.environment === 'training' ? ' (Leg 2 — civilian handoff in training)' : ' (Leg 2 — stabilize → definitive)'}</label>
                <select
                  value={state.transferAssetType}
                  onChange={e => {
                    const af = AIRFRAMES.find(a => a.id === e.target.value)
                    const update: Partial<MedWorkspaceState> = { transferAssetType: e.target.value }
                    if (af && af.speedKt > 0) update.transferAssetSpeedKt = af.speedKt
                    onPatch(update)
                  }}
                  disabled={state.environment === 'training'}
                >
                  <option value="">— Same as organic —</option>
                  {AIRFRAMES.filter(af => af.id !== 'custom').map(af => (
                    <option key={af.id} value={af.id}>{af.label}{af.speedKt > 0 ? ` (~${af.speedKt} kt)` : ''}</option>
                  ))}
                </select>
              </div>
              {state.environment === 'operational' && (
                <div className="field">
                  <label>Transfer Speed (kts)</label>
                  <input
                    type="number" min="60" max="300"
                    value={state.transferAssetSpeedKt}
                    onChange={e => onPatch({ transferAssetSpeedKt: parseInt(e.target.value) || 130, transferAssetType: 'custom' })}
                  />
                </div>
              )}
            </div>
          </>
        )}
        {(!hideOpName || !hideUnit) && (
          <div className="field-row">
            {!hideOpName && (
              <div className="field">
                <label>Op Name</label>
                <input
                  value={state.opName}
                  onChange={e => onPatch({ opName: e.target.value })}
                  placeholder="OP BLACKTHORN"
                />
              </div>
            )}
            {!hideUnit && (
              <div className="field">
                <label>Unit / Callsign</label>
                <input
                  value={state.unitName}
                  onChange={e => onPatch({ unitName: e.target.value })}
                  placeholder="ODA 1234"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
