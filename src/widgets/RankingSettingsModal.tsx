/**
 * RankingSettingsModal — lets the medic fine-tune the facility ranking and
 * PACE doctrine parameters (see med/rankingParams.ts), with a Reset to
 * Defaults button. Edits are staged in a local draft and only committed via
 * onApply (Apply button) — closing or cancelling discards unsaved changes.
 */

import { useState } from 'react'
import type { CareTier } from '../med/careLevel'
import type { RankingParams, CapWeights } from '../med/rankingParams'
import { DEFAULT_RANKING_PARAMS, normalizeRankingParams } from '../med/rankingParams'
import { MedModal } from './MedModal'

interface Props {
  params: RankingParams
  onApply: (params: RankingParams) => void
  onClose: () => void
}

const MIN_PA_LEVEL_OPTIONS: { value: CareTier; label: string }[] = [
  { value: 4, label: 'Level I only' },
  { value: 3, label: 'Level II or better' },
  { value: 2, label: 'Level III or better (default)' },
  { value: 1, label: 'Level IV or better' },
]

function GroupHeader({ children }: { children: string }) {
  return (
    <div style={{
      fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 11, letterSpacing: 1,
      color: 'var(--accent2)', marginTop: 16, marginBottom: 8,
      paddingBottom: 4, borderBottom: '1px solid var(--border)',
    }}>
      {children}
    </div>
  )
}

interface NumFieldProps {
  label: string
  value: number
  defaultValue: number
  step?: number
  min?: number
  max?: number
  onChange: (v: number) => void
}

function NumField({ label, value, defaultValue, step = 1, min, max, onChange }: NumFieldProps) {
  return (
    <div className="field">
      <label>{label} <span style={{ color: 'var(--text-dim)', textTransform: 'none' }}>(default: {defaultValue})</span></label>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

export function RankingSettingsModal({ params, onApply, onClose }: Props) {
  const [draft, setDraft] = useState<RankingParams>(params)

  // Deliberately NOT normalized/clamped here — clamping on every keystroke would
  // force-correct a value like "1" to the minimum before the user can finish
  // typing "100". Raw (possibly out-of-range or transiently NaN while a field is
  // mid-edit) values are held as-is; normalizeRankingParams() runs once, on Apply.
  const patch = (p: Partial<RankingParams>) => setDraft(d => ({ ...d, ...p }))
  const patchCapWeights = (p: Partial<CapWeights>) =>
    setDraft(d => ({ ...d, capWeights: { ...d.capWeights, ...p } }))

  return (
    <MedModal
      title="RANKING SETTINGS"
      onClose={onClose}
      maxWidth={560}
      footer={
        <>
          <button className="btn btn-sm" onClick={() => setDraft(DEFAULT_RANKING_PARAMS)}>Reset to Defaults</button>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={() => onApply(normalizeRankingParams(draft))}>Apply</button>
        </>
      }
    >
      <p style={{ margin: '0 0 8px 0', fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        These settings apply to every plan in this browser. They are not saved with or shared alongside
        an individual plan. Transit penalties are soft weights — nothing here ever excludes a facility
        for being far away.
      </p>

      <GroupHeader>TRANSIT</GroupHeader>
      <div className="field-row">
        <NumField
          label="Golden hour (min)" value={draft.goldenHourMin} defaultValue={DEFAULT_RANKING_PARAMS.goldenHourMin}
          min={15} max={180} onChange={v => patch({ goldenHourMin: v })}
        />
        <NumField
          label="Golden-hour bonus" value={draft.goldenHourBonus} defaultValue={DEFAULT_RANKING_PARAMS.goldenHourBonus}
          min={0} onChange={v => patch({ goldenHourBonus: v })}
        />
      </div>
      <div className="field-row">
        <NumField
          label="In-window penalty (max)" value={draft.inWindowPenaltyMax} defaultValue={DEFAULT_RANKING_PARAMS.inWindowPenaltyMax}
          min={0} onChange={v => patch({ inWindowPenaltyMax: v })}
        />
        <NumField
          label="Late penalty (per min)" value={draft.lateMinutePenalty} defaultValue={DEFAULT_RANKING_PARAMS.lateMinutePenalty}
          min={0} step={0.1} onChange={v => patch({ lateMinutePenalty: v })}
        />
      </div>

      <GroupHeader>CAPABILITY LEVEL</GroupHeader>
      <div className="field-row">
        <NumField
          label="Points per Level" value={draft.levelWeight} defaultValue={DEFAULT_RANKING_PARAMS.levelWeight}
          min={0} onChange={v => patch({ levelWeight: v })}
        />
        <NumField
          label="Points per capability" value={draft.capabilityPoints} defaultValue={DEFAULT_RANKING_PARAMS.capabilityPoints}
          min={0} onChange={v => patch({ capabilityPoints: v })}
        />
      </div>

      <GroupHeader>CAPABILITY WEIGHTS</GroupHeader>
      <div className="field-row-3">
        <NumField
          label="Neuro ×" value={draft.capWeights.neuro} defaultValue={DEFAULT_RANKING_PARAMS.capWeights.neuro}
          min={0} max={5} step={0.1} onChange={v => patchCapWeights({ neuro: v })}
        />
        <NumField
          label="Burns ×" value={draft.capWeights.burns} defaultValue={DEFAULT_RANKING_PARAMS.capWeights.burns}
          min={0} max={5} step={0.1} onChange={v => patchCapWeights({ burns: v })}
        />
        <NumField
          label="Vascular ×" value={draft.capWeights.vascular} defaultValue={DEFAULT_RANKING_PARAMS.capWeights.vascular}
          min={0} max={5} step={0.1} onChange={v => patchCapWeights({ vascular: v })}
        />
      </div>
      <div className="field-row-3">
        <NumField
          label="Cardiothoracic ×" value={draft.capWeights.cardiothoracic} defaultValue={DEFAULT_RANKING_PARAMS.capWeights.cardiothoracic}
          min={0} max={5} step={0.1} onChange={v => patchCapWeights({ cardiothoracic: v })}
        />
        <NumField
          label="Surgical ×" value={draft.capWeights.surgical} defaultValue={DEFAULT_RANKING_PARAMS.capWeights.surgical}
          min={0} max={5} step={0.1} onChange={v => patchCapWeights({ surgical: v })}
        />
        <NumField
          label="Other ×" value={draft.capWeights.other} defaultValue={DEFAULT_RANKING_PARAMS.capWeights.other}
          min={0} max={5} step={0.1} onChange={v => patchCapWeights({ other: v })}
        />
      </div>

      <GroupHeader>STABILIZE-THEN-TRANSFER</GroupHeader>
      <div className="field-row">
        <NumField
          label="Transfer distance ratio" value={draft.stabilizeTransferRatio} defaultValue={DEFAULT_RANKING_PARAMS.stabilizeTransferRatio}
          min={1.1} max={5} step={0.1} onChange={v => patch({ stabilizeTransferRatio: v })}
        />
        <div className="field">
          <label>&nbsp;</label>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            How much closer a lower-Level facility must be than the nearest definitive-care option to
            recommend stabilizing there first.
          </span>
        </div>
      </div>

      <GroupHeader>PACE DOCTRINE</GroupHeader>
      <div className="field-row">
        <div className="field">
          <label>Minimum Level for Primary/Alternate</label>
          <select
            value={draft.minPrimaryAlternateLevel}
            onChange={e => patch({ minPrimaryAlternateLevel: +e.target.value as CareTier })}
          >
            {MIN_PA_LEVEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Falls back to the best available facility with a warning when nothing meets this floor. A
            golden-hour Level I is always Primary regardless of this setting.
          </span>
        </div>
      </div>
    </MedModal>
  )
}
