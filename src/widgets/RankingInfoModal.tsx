/**
 * RankingInfoModal — explains how facilities are ranked and how that
 * ranking becomes the PACE plan, in plain language.
 *
 * Deliberately never says "tier" — medics read two incompatible numbering
 * schemes in the wild: civilian trauma center LEVELS count down to the best
 * (Level I = highest capability), while military ROLES OF CARE count up
 * (Role 1 = point-of-injury, lowest capability; Role 4 = definitive care).
 * This app always uses trauma center Levels internally, but the two are
 * easy to conflate, so this modal calls it out explicitly instead of
 * assuming the reader already knows which scale is in play.
 *
 * All numbers shown are read from the live `params` prop (the ranking
 * settings currently in effect), so this never drifts out of sync with
 * what the Ranking Settings modal has configured.
 */

import type { ReactNode } from 'react'
import type { CareTier } from '../med/careLevel'
import type { RankingParams } from '../med/rankingParams'
import { MedModal } from './MedModal'

interface Props {
  params: RankingParams
  onClose: () => void
}

const LEVEL_INFO: { tier: CareTier; label: string; short: string; note: string }[] = [
  { tier: 4, label: 'Level I Trauma Center',   short: 'Highest capability',   note: '24/7 trauma surgery and neurosurgery' },
  { tier: 3, label: 'Level II Trauma Center',  short: 'High capability',      note: '24/7 trauma surgery' },
  { tier: 2, label: 'Level III Trauma Center', short: 'Moderate capability',  note: 'staffed 24/7 emergency department with trauma coverage' },
  { tier: 1, label: 'Level IV Trauma Center',  short: 'Basic stabilization',  note: 'staffed 24/7 emergency department, no formal trauma surgery' },
  { tier: 0, label: 'Non-Trauma Center',       short: 'Not PACE-eligible',    note: 'no staffed 24/7 emergency department — never used in the PACE plan, regardless of distance' },
]

function levelInfo(tier: CareTier) {
  return LEVEL_INFO.find(l => l.tier === tier)!
}

/** Mirrors rank.ts's transitScorePenalty — reproduced here only to render
 *  the worked example below with live numbers; not used for actual ranking. */
function illustrativePenalty(durationMin: number, p: RankingParams): number {
  const goldenHourS = p.goldenHourMin * 60
  const durationS = durationMin * 60
  if (durationS <= goldenHourS) return -(durationS / goldenHourS) * p.inWindowPenaltyMax
  const overageMin = (durationS - goldenHourS) / 60
  return -p.inWindowPenaltyMax - overageMin * p.lateMinutePenalty
}

function fmt(n: number): string {
  return Math.round(n * 10) / 10 === Math.round(n) ? String(Math.round(n)) : n.toFixed(1)
}

function H(props: { children: ReactNode }) {
  return (
    <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, color: 'var(--accent)', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 }}>
      {props.children}
    </div>
  )
}

function P(props: { children: ReactNode }) {
  return <p style={{ margin: '0 0 10px 0', fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>{props.children}</p>
}

export function RankingInfoModal({ params, onClose }: Props) {
  const minLevel = levelInfo(params.minPrimaryAlternateLevel)

  // Worked example scaled to the current golden-hour setting, so it always
  // reads sensibly however the medic has it tuned.
  const tClose = params.goldenHourMin / 2
  const tFar = params.goldenHourMin + 10
  const scoreClose = 2 * params.levelWeight + illustrativePenalty(tClose, params) + params.goldenHourBonus
  const scoreFar = 2 * params.levelWeight + illustrativePenalty(tFar, params)
  const scoreGap = scoreClose - scoreFar

  return (
    <MedModal title="HOW RANKING & PACE WORK" onClose={onClose} maxWidth={620}>
      <H>Reading capability levels</H>
      <P>
        Facilities are described here by <strong>trauma center Level</strong>, not a bare number. A quick
        warning, because the opposite numbering scheme shows up constantly in military medical doctrine:
        civilian trauma center <strong>Levels</strong> count DOWN to the best (Level I is the highest
        capability). Military <strong>Roles of care</strong> count UP (Role 1 is the point-of-injury/aid
        station — the lowest capability — and Role 4 is definitive care). This app always uses trauma
        center Levels. Don't mix the two scales.
      </P>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4, marginBottom: 10 }}>
        {LEVEL_INFO.map(l => (
          <div key={l.tier} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 10, fontSize: 11, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent2)', fontWeight: 700 }}>{l.label}</span>
            <span style={{ color: 'var(--text-dim)' }}>{l.short} — {l.note}</span>
          </div>
        ))}
      </div>
      <P>
        UK Major Trauma Centres and OSM-tagged hospitals without a formal designation are mapped onto this
        same five-step scale by the facility ranking logic, so every facility — US, UK, or elsewhere — can
        be compared on one consistent ladder.
      </P>

      <H>How each facility is scored</H>
      <P>
        Every facility gets one composite score. Higher wins. With today's settings:
      </P>
      <ul style={{ margin: '0 0 10px 0', paddingLeft: 18, fontSize: 12, color: 'var(--text)', lineHeight: 1.7 }}>
        <li>Each capability Level is worth <strong>{fmt(params.levelWeight)} points</strong> — this dominates the score by design, so a higher-Level facility almost always outranks a lower one.</li>
        <li>Transit time is a <strong>soft weight, never a hard cutoff</strong> — a facility is never excluded just for being far away.</li>
        <li>Arriving within the golden hour (<strong>{fmt(params.goldenHourMin)} min</strong>) adds a <strong>+{fmt(params.goldenHourBonus)}-point bonus</strong>.</li>
        <li>Transit inside that window costs up to <strong>{fmt(params.inWindowPenaltyMax)} points</strong> (scaling smoothly with time); every minute beyond it costs an additional <strong>{fmt(params.lateMinutePenalty)} points</strong>.</li>
        <li>Each documented capability (neurosurgery, burns, vascular, cardiothoracic, surgical) adds <strong>{fmt(params.capabilityPoints)} points</strong>, multiplied by that capability's weight (neuro ×{fmt(params.capWeights.neuro)}, burns ×{fmt(params.capWeights.burns)}, vascular ×{fmt(params.capWeights.vascular)}, cardiothoracic ×{fmt(params.capWeights.cardiothoracic)}, surgical ×{fmt(params.capWeights.surgical)}).</li>
        <li>Transit uses whichever is faster — ground or helicopter — and helicopter only counts when rotary-wing support is turned on and the facility has a helipad.</li>
      </ul>
      <P>
        <strong>Worked example:</strong> two Level III Trauma Centers — one {fmt(tClose)} min away (well
        inside the golden hour), one {fmt(tFar)} min away (10 min past it). The closer one scores about{' '}
        <strong>{fmt(scoreGap)} points higher</strong>, purely from the golden-hour bonus and the late-arrival
        penalty — same capability Level, same everything else.
      </P>

      <H>How the PACE plan is built from the ranking</H>
      <ul style={{ margin: '0 0 10px 0', paddingLeft: 18, fontSize: 12, color: 'var(--text)', lineHeight: 1.7 }}>
        <li>A Level I Trauma Center reachable within the golden hour is <strong>always Primary</strong> — this doesn't follow the raw score.</li>
        <li>Primary and Alternate require at least <strong>{minLevel.label}</strong> ({minLevel.short}); if nothing qualifies, the plan falls back to the best available facility and flags it with a warning.</li>
        <li>Contingency and Emergency fill from whatever's left, best first.</li>
        <li>Always excluded from this plan: pediatric-only facilities, Non-Trauma Centers (no 24/7 ED), and Level I centers beyond the golden hour — those last ones go to the Echelons of Care plan below instead.</li>
        <li>A medic's manual override on any slot always wins, regardless of eligibility.</li>
      </ul>

      <H>Stabilize-then-transfer / Echelons of Care</H>
      <P>
        When the nearest Level I is beyond the golden hour AND a lower-Level facility is at least{' '}
        <strong>{fmt(params.stabilizeTransferRatio)}×</strong> closer, the plan recommends stabilizing at the
        closer facility first, then transferring to the Level I for definitive care — rendered as a two-leg
        Echelons of Care plan (POI → stabilize → definitive) rather than a single destination.
      </P>

      <H>Dive mode: Chamber PACE</H>
      <P>
        In dive mode, the Chamber PACE plan fills Primary through Emergency purely in rank order among
        facilities that carry the hyperbaric/recompression capability — no Level floor, no golden-hour
        exclusion. Chambers often score lower than large hospitals, so those filters are skipped to keep
        every in-range chamber available.
      </P>

      <H>What doesn't affect ranking</H>
      <P>
        TRICARE network status and interpreter/language notes are shown for reference only — they never
        change a facility's score or its PACE slot.
      </P>
    </MedModal>
  )
}
