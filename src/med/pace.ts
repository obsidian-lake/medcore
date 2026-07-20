/**
 * PACE plan builders.
 *
 * Produces two independent PACE plans:
 *
 * 1. Facility PACE — P/A/C/E from the ranked facility list, using doctrine-ordered
 *    selection:
 *      - Primary = closest Level I if reachable within the golden hour; otherwise
 *        the closest highest-capability facility, prioritising surgical capability.
 *      - Level I facilities beyond the golden hour are EXCLUDED from the Facility PACE
 *        plan entirely — they appear only in the separate Echelons of Care plan.
 *    Medic overrides win regardless of eligibility.
 *
 * 2. Treatment PACE — templated per doctrine (TCCC intent):
 *
 *    Training (organic air available):
 *    P = TCCC / Self-Aid / Team Medic (with life/limb/eyesight coordination note)
 *    A = Organic air platform IAW facility PACE plan; team medic continuous care en-route
 *    C = Coordinate local EMS (auto-detected number from country code)
 *    E = Team organic vehicle — ground transport to nearest facility
 *
 *    Training (no organic air — items promoted):
 *    P = TCCC / Self-Aid / Team Medic
 *    A = Coordinate local EMS (promoted from C)
 *    C = Team organic vehicle — ground transport to nearest facility (promoted from E)
 *    E = Team organic vehicle — ground transport + coordinate EMS handoff en-route
 *
 *    Operational (organic air available):
 *    P = TCCC / Self-Aid / Team Medic
 *    A = Organic air platform IAW facility PACE plan
 *    C = Theater RQS / PJs
 *    E = Theater CASEVAC/MEDEVAC via 9-line
 *
 *    Operational (no organic air — items promoted):
 *    P = TCCC / Self-Aid / Team Medic
 *    A = Theater RQS / PJs (promoted from C)
 *    C = Theater CASEVAC/MEDEVAC via 9-line (promoted from E)
 *    E = Coordinate with higher command
 */

import type { FacilityScore, TransitInfo } from './rank'
import type { FacilityRecord } from './facilities/merge'
import type { CapabilityFlag } from './careLevel'
import { formatTransit } from './rank'

// ── Types ──────────────────────────────────────────────────────────────────────

export type PaceLetter = 'P' | 'A' | 'C' | 'E'

export interface FacilityPaceEntry {
  letter: PaceLetter
  facility: FacilityRecord
  transit: TransitInfo
  /**
   * General annotation note for this entry — used for Level IV fallback warnings
   * (e.g. "⚠ Level IV basic care only — verify suitability for adult trauma").
   */
  phasedNote?: string
  /** True if this slot was manually overridden by the medic. */
  overridden: boolean
}

export interface TreatmentPaceEntry {
  letter: PaceLetter
  label: string    // e.g. "TCCC / Self-Aid"
  detail: string   // free-text description / instructions
  overridden: boolean
}

export interface FacilityPace {
  entries: FacilityPaceEntry[]
  /**
   * Non-empty when PACE slots had to fall back below the Level III+ eligibility
   * floor (e.g. no capable adult trauma center within range). Displayed as
   * warnings to the medic in the UI and on the slide.
   */
  warnings: string[]
}

export interface TreatmentPace {
  entries: TreatmentPaceEntry[]
  /** Emergency number used in C (training). */
  emergencyNumber: string
  /** Country name used in C. */
  emergencyCountry: string
}

// ── Facility PACE builder ──────────────────────────────────────────────────────

/** Golden-hour boundary (60 min in seconds). */
const GOLDEN_HOUR_S = 3600

/**
 * Trauma-relevance weight for a capability flag.
 * Mirrors the weights in rank.ts — surgical-capable facilities sort above
 * same-tier facilities without specialised trauma capability.
 */
const CAP_TRAUMA_WEIGHT: Partial<Record<CapabilityFlag, number>> = {
  neuro:          1.5,
  burns:          1.4,
  vascular:       1.3,
  cardiothoracic: 1.2,
  surgical:       1.1,
}

function traumaCapScore(caps: CapabilityFlag[]): number {
  return caps.reduce((acc, c) => acc + (CAP_TRAUMA_WEIGHT[c] ?? 1.0), 0)
}

/**
 * Doctrine sort comparator for the trauma pool.
 *
 * Priority order:
 *  1. Golden-hour Level I (tier 4, transit ≤ 60 min) — always Primary (P slot).
 *  2. Remaining: tier descending (highest trauma level first).
 *  3. Tie-break: trauma capability score descending (surgical, neuro, etc.).
 *  4. Tie-break: effective transit ascending (closest first).
 */
function doctrineCompare(a: FacilityScore, b: FacilityScore): number {
  const aGLI = (a.facility.tier as number) === 4 && a.transit.effectiveDurationS <= GOLDEN_HOUR_S
  const bGLI = (b.facility.tier as number) === 4 && b.transit.effectiveDurationS <= GOLDEN_HOUR_S
  if (aGLI !== bGLI) return aGLI ? -1 : 1
  const tierDiff = (b.facility.tier as number) - (a.facility.tier as number)
  if (tierDiff !== 0) return tierDiff
  const capDiff = traumaCapScore(b.facility.capabilities) - traumaCapScore(a.facility.capabilities)
  if (capDiff !== 0) return capDiff
  return a.transit.effectiveDurationS - b.transit.effectiveDurationS
}

export interface BuildFacilityPaceOpts {
  ranked: FacilityScore[]
  /** Manual slot overrides: keyed by PaceLetter → FacilityRecord id. */
  overrides?: Partial<Record<PaceLetter, string>>
  /** Full list of facilities (to look up override targets by id). */
  allFacilities: FacilityRecord[]
  /**
   * When set (e.g. 'hyperbaric' in dive mode), only facilities carrying this
   * capability are auto-assigned to any PACE slot. Medic overrides bypass this
   * constraint — "overrides always win" is an intentional escape hatch for when
   * source data doesn't yet reflect a facility's actual capabilities.
   */
  requiredCapability?: CapabilityFlag
  /**
   * Pool selection mode:
   *  - 'trauma' (default): standard hospital PACE. Applies doctrine sort (golden-hour
   *    Level I first, then tier/capability/transit). Excludes standalone chamber records
   *    (isChamber:true) and Level I (tier 4) facilities beyond the golden hour — those
   *    belong to the Echelons of Care plan, not the Facility PACE plan.
   *    Enforces the tier≥2 eligibility floor for P/A and emits "Level IV" warnings.
   *  - 'capability': chamber/recompression PACE. Skips the isChamber exclusion, the
   *    doctrine sort, the Level I golden-hour filter, and the tier eligibility gate.
   *    Fills slots from the requiredCapability pool in rank order.
   *    Used for the dive-mode Chamber PACE plan.
   */
  poolMode?: 'trauma' | 'capability'
}

export function buildFacilityPace(opts: BuildFacilityPaceOpts): FacilityPace {
  const {
    ranked, overrides = {}, allFacilities,
    requiredCapability, poolMode = 'trauma',
  } = opts
  const letters: PaceLetter[] = ['P', 'A', 'C', 'E']
  const entries: FacilityPaceEntry[] = []
  const warnings: string[] = []

  // Pool: candidates for PACE slot assignment.
  //
  // poolMode:'trauma': applies doctrine sort, then filters:
  //   - Excludes pediatric-only, explicitly-excluded, and chamber records.
  //   - Excludes Level I (tier 4) facilities beyond the golden hour — those belong
  //     to the Echelons of Care plan. A golden-hour Level I stays and becomes Primary.
  //
  // poolMode:'capability': all ranked facilities carrying the required capability, with
  //   NO doctrine sort, NO Level I golden-hour filter. Hyperbaric chambers score lower
  //   than high-tier hospitals, so imposing filters would exclude them. Every in-radius
  //   chamber appears regardless of rank position.
  //
  // Medic overrides can still force-assign any facility (see override path below).
  const sorted = poolMode === 'trauma' ? [...ranked].sort(doctrineCompare) : ranked

  const pool = sorted.filter(s =>
    !s.facility.pediatricOnly &&
    !s.facility.excludeFromPace &&
    (!requiredCapability || s.facility.capabilities.includes(requiredCapability)) &&
    (poolMode !== 'trauma' || !s.facility.isChamber) &&
    // Trauma mode: exclude Level I beyond golden hour (Echelons of Care plan handles them).
    (poolMode !== 'trauma' || (s.facility.tier as number) < 4 || s.transit.effectiveDurationS <= GOLDEN_HOUR_S)
  )

  // Warn when a capability constraint excludes everything (dive mode, chamber PACE).
  if (requiredCapability && pool.length === 0) {
    warnings.push(
      `Dive mode: no recompression/hyperbaric chamber found within the search radius. ` +
      `Expand the search radius, or add the "hyperbaric" capability to a known chamber facility on the Facilities tab.`
    )
  }

  // Eligible sub-pool for P and A: Level III+ (tier ≥ 2) adult trauma facilities.
  // Only enforced in trauma mode — chambers are not trauma-tiered, so in capability
  // mode all pool members are eligible for P/A slots.
  const eligiblePool = poolMode === 'trauma'
    ? pool.filter(s => (s.facility.tier as number) >= 2)
    : pool

  for (const letter of letters) {
    // Medic overrides always win regardless of eligibility
    const overrideId = overrides[letter]
    if (overrideId) {
      const fac = allFacilities.find(f => f.id === overrideId)
      const transit = ranked.find(r => r.facility.id === overrideId)?.transit ?? {
        groundDurationS: null, heloDurationS: null, effectiveDurationS: Infinity,
      }
      if (fac) {
        entries.push({ letter, facility: fac, transit, overridden: true })
        continue
      }
    }

    const usedIds = new Set(entries.map(e => e.facility.id))

    // For P and A: try eligible facilities first.
    // In trauma mode: Level III+ non-pediatric.
    // In capability mode: all pool members (no tier gate for chambers).
    const isPrimaryOrAlt = letter === 'P' || letter === 'A'
    let next: typeof pool[number] | undefined

    if (isPrimaryOrAlt) {
      next = eligiblePool.find(s => !usedIds.has(s.facility.id))
    }

    if (!next) {
      // Fallback to full pool (any tier, any type)
      next = pool.find(s => !usedIds.has(s.facility.id))

      // Warn when a P/A slot had to fall back to Level IV basic care.
      // Only emit in trauma mode — this warning is specific to trauma triage logic
      // and is wrong/misleading when filling the chamber PACE plan.
      if (poolMode === 'trauma' && isPrimaryOrAlt && next && (next.facility.tier as number) < 2) {
        const fac = next.facility
        const msg = `${letter}: No Level III+ adult trauma center available — Level IV basic care used as fallback (${fac.name})`
        warnings.push(msg)
        entries.push({
          letter,
          facility: fac,
          transit: next.transit,
          phasedNote: `⚠ Level IV basic care only — verify suitability for adult trauma`,
          overridden: false,
        })
        continue
      }
    }

    if (next) {
      entries.push({ letter, facility: next.facility, transit: next.transit, overridden: false })
    }
  }

  return { entries, warnings }
}

// ── Treatment PACE builder ─────────────────────────────────────────────────────

export interface BuildTreatmentPaceOpts {
  /** 'training' or 'operational' — controls slot content. */
  environment: 'training' | 'operational'
  /** ISO 3166-1 alpha-2 country code detected from target coordinates. */
  countryCode: string
  /** Pre-formatted emergency number string (from emergencyNumbers.ts). */
  emergencyNumberStr: string
  /** Country name. */
  countryName: string
  /** Medic overrides for any slot. */
  overrides?: Partial<Record<PaceLetter, { label?: string; detail?: string }>>
  /** Whether organic rotary-wing assets are available for this mission. */
  rotaryWingAvailable: boolean
  /** Human-readable label for the organic airframe (e.g. "UH-60 Black Hawk"). Empty string if none selected. */
  organicAssetLabel: string
  /** Name of the primary facility from the facility PACE plan, used in ground-transport E-slot text. */
  nearestFacilityName?: string
}

export function buildTreatmentPace(opts: BuildTreatmentPaceOpts): TreatmentPace {
  const {
    environment, emergencyNumberStr, countryName, overrides = {},
    rotaryWingAvailable, organicAssetLabel, nearestFacilityName,
  } = opts
  const isOp = environment === 'operational'

  const airLabel = organicAssetLabel || 'Organic Air'
  const facilityRef = nearestFacilityName
    ? `nearest facility (${nearestFacilityName})`
    : 'nearest facility per facility PACE plan'

  const pSlot = {
    label: 'TCCC / Self-Aid / Team Medic',
    detail: isOp
      ? 'Apply TCCC protocols. Self-aid/buddy-aid per Card of 9. Control hemorrhage, establish airway, treat for shock.'
      : 'Apply TCCC protocols. Self-aid/buddy-aid per Card of 9. Control hemorrhage, establish airway, treat for shock. If life, limb, or eyesight threatened — immediately coordinate and initiate follow-on care.',
  }

  // A/C/E pool — 3 entries assigned in order to those three letters.
  // When organic air is unavailable, the air slot is removed and the remaining
  // entries are promoted one step up (C→A, E→C) with a modified final entry.
  let pool: Array<{ label: string; detail: string }>

  if (isOp) {
    const rqs = {
      label: 'Theater RQS / PJs',
      detail: 'Request Personnel Recovery / CSAR via theater channels. Coordinate 9-line with PRCC/JRCC.',
    }
    const nineLine = {
      label: 'Theater CASEVAC/MEDEVAC — 9-Line',
      detail: 'Request CASEVAC/MEDEVAC via 9-line. Coordinate with higher command for emergency evacuation to definitive care.',
    }
    if (rotaryWingAvailable) {
      pool = [
        { label: `${airLabel} — Air MEDEVAC IAW Facility PACE Plan`, detail: 'Team medic provides continuous care en-route. Hand off to receiving facility on arrival. Coordinate IAW facility PACE plan.' },
        rqs,
        nineLine,
      ]
    } else {
      pool = [
        rqs,
        nineLine,
        { label: 'Coordinate with Higher Command', detail: 'Coordinate with higher command for emergency medical support. Direct ground CASEVAC if no air available.' },
      ]
    }
  } else {
    const ems = {
      label: `Coordinate Local EMS — ${emergencyNumberStr}`,
      detail: `Call ${emergencyNumberStr}. Provide location, number of casualties, mechanism of injury, and vital signs.`,
    }
    const ground = {
      label: 'Team Organic Vehicle — Ground Transport',
      detail: `Ground transport to ${facilityRef}. ID vehicle, key location, and primary/alternate drivers during med plan brief. Stage everything for transport.`,
    }
    if (rotaryWingAvailable) {
      pool = [
        { label: `${airLabel} — Air MEDEVAC`, detail: 'Team medic provides continuous care en-route. Hand off to receiving facility on arrival. Coordinate IAW facility PACE plan.' },
        ems,
        ground,
      ]
    } else {
      pool = [
        ems,
        ground,
        { label: 'Team Organic Vehicle — Ground Transport + EMS Handoff', detail: `Ground transport to ${facilityRef}; coordinate handoff location to civilian EMS en-route. If limited range access: initiate movement immediately, coordinate handoff en-route.` },
      ]
    }
  }

  const letters: PaceLetter[] = ['P', 'A', 'C', 'E']
  const defaultSlots = [pSlot, ...pool]

  const entries: TreatmentPaceEntry[] = letters.map((letter, i) => {
    const ov = overrides[letter]
    const def = defaultSlots[i] ?? { label: '', detail: '' }
    return {
      letter,
      label:  ov?.label  ?? def.label,
      detail: ov?.detail ?? def.detail,
      overridden: !!(ov?.label || ov?.detail),
    }
  })

  return { entries, emergencyNumber: emergencyNumberStr, emergencyCountry: countryName }
}

// ── Formatters (re-exported for consumers that only import from pace.ts) ───────

export { formatTransit }
