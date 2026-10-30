/**
 * Care-level normalization.
 *
 * All facility sources (US trauma levels, UK MTCs, OSM heuristics, custom)
 * are normalized into a single internal tier 0–4 so the ranking algorithm
 * operates on a comparable scale regardless of source.
 *
 * Internal tier (ascending capability):
 *   4 — Level I  (US Level I / UK MTC / highest definitive care)
 *   3 — Level II (US Level II / UK Trauma Unit high)
 *   2 — Level III (US Level III / UK Trauma Unit standard / community with A&E)
 *   1 — Level IV (US Level IV–V / UK Local ED / rural clinic / 24/7 ED but no trauma designation)
 *   0 — NTC (Non-Trauma Center: no emergency department, or an ED that is not open 24/7)
 *
 * NOTE: US ACS trauma levels run I (highest) → V (lowest) — the INVERSE of
 * this tier scale. Invert on ingest: usLevel 1 → tier 4, 2 → 3, 3 → 2, 4/5 → 1.
 *
 * NTC (tier 0) is distinct from Level IV: Level IV still has a staffed 24/7 ED,
 * just no formal trauma designation. NTC facilities are excluded from the trauma
 * PACE plan regardless of distance from the target — see isNonTraumaCenter().
 * A formal trauma/MTC designation always overrides an NTC heuristic result.
 *
 * USER-FACING LABELS: Always use careLevelLabel() / careLevelRoman() so the UI
 * consistently shows "Level I–IV" / "NTC" without exposing the internal tier number.
 */

/** Exquisite capability flags — subset relevant for trauma triage. */
export type CapabilityFlag =
  | 'neuro'
  | 'burns'
  | 'cardiothoracic'
  | 'surgical'
  | 'pediatric'
  | 'obstetric'
  | 'vascular'
  | 'hyperbaric'

export const ALL_CAPABILITY_FLAGS: CapabilityFlag[] = [
  'neuro', 'burns', 'cardiothoracic', 'surgical', 'pediatric', 'obstetric', 'vascular', 'hyperbaric',
]

/** Internal care tier (0–4, higher = more capable). 0 = NTC (non-trauma center). */
export type CareTier = 0 | 1 | 2 | 3 | 4

/** Tier value for a Non-Trauma Center — no 24/7 ED. Use isNonTraumaCenter() to test. */
export const NTC_TIER: CareTier = 0

/** True when a tier represents a Non-Trauma Center (no 24/7 ED). */
export function isNonTraumaCenter(tier: CareTier): boolean {
  return tier === NTC_TIER
}

/**
 * Convert a US ACS/State trauma level number to internal tier.
 * US levels run I (best) → V (worst); we invert.
 */
export function usTraumaLevelToTier(level: number): CareTier {
  if (level <= 1) return 4
  if (level === 2) return 3
  if (level === 3) return 2
  return 1   // 4, 5, or unknown
}

/**
 * Convert a trauma classification string to internal tier.
 *
 * Handles UK NHS designations (primary use case) and common international
 * OSM `trauma=` / `healthcare:classification=` values so that facilities
 * across Europe and beyond are correctly promoted when mappers use
 * recognised tag values.
 *
 * References:
 *  - NHS England "Major Trauma Networks" guidance (UK)
 *  - OSM wiki: Tag:trauma=* and Tag:healthcare:classification=*
 */
export function ukClassificationToTier(cls: string): CareTier {
  const s = cls.toLowerCase().trim().replace(/_/g, ' ')
  // UK NHS designations
  if (s.includes('major trauma centre') || s === 'mtc') return 4
  if (s.includes('trauma unit') && (s.includes('level 1') || s.includes('l1'))) return 3
  if (s.includes('trauma unit')) return 2
  if (s.includes('local emergency hospital') || s.includes('leh')) return 1
  // International OSM trauma= values (trauma_centre / trauma_center)
  if (s === 'trauma centre' || s === 'trauma center') return 4
  // Level-based designations used in healthcare:classification= worldwide.
  // Match patterns like "level 1", "level i", "level-1", "level_1", or bare "1".
  if (/^level[\s-]?1$/.test(s) || /^level[\s-]?i$/.test(s) || s === '1') return 4
  if (/^level[\s-]?2$/.test(s) || /^level[\s-]?ii$/.test(s) || s === '2') return 3
  if (/^level[\s-]?3$/.test(s) || /^level[\s-]?iii$/.test(s) || s === '3') return 2
  return 1
}

/**
 * True when an OSM/HIFLD opening-hours style string represents round-the-clock
 * service: "24/7", "Mo-Su 00:00-24:00", "00:00-24:00", or a closing time that
 * rolls to midnight ("...-23:59" / "...-24:00"). Conservative: anything else
 * (specific days, specific hours, "by appointment", empty) is treated as not 24/7.
 */
export function isOpen24x7(hours: string): boolean {
  const s = hours.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!s) return false
  if (s === '24/7') return true
  // Strip an optional day range prefix (e.g. "mo-su ") — any day coverage is fine,
  // the thing that matters here is whether the time span itself is round-the-clock.
  const timePart = s.replace(/^[a-z,\s-]+(?=\d)/, '')
  return /^(00:00-24:00|00:00-23:59|0:00-24:00)$/.test(timePart)
}

/**
 * Determine whether a hospital's emergency department is open 24/7, using
 * the ED-specific hours tag first and falling back to the hospital's general
 * hours tag only when no ED-specific tag is present.
 *
 * `opening_hours:emergency` is authoritative when present — some hospitals tag
 * general `opening_hours` with outpatient/clinic/visiting hours even though
 * their ED runs around the clock, so falling back to it when an ED-specific
 * tag exists would wrongly demote a real 24/7 ED.
 */
export function edIs24x7(tags: {
  openingHoursEmergency?: string
  openingHours?: string
}): boolean {
  if (tags.openingHoursEmergency) return isOpen24x7(tags.openingHoursEmergency)
  if (tags.openingHours) return isOpen24x7(tags.openingHours)
  // No hours tag at all — assume 24/7 (most EDs are); absence of data is not
  // itself evidence of restricted hours. `hasEmergency` is what gates NTC.
  return true
}

/**
 * OSM heuristic: derive a care tier from OSM tags + bed count.
 * Used as fallback when no formal trauma classification is available.
 *
 * Logic (NTC → Level I, higher is better capability):
 *  - NTC (tier 0): no emergency department, or an ED present but not open 24/7
 *  - Level I (tier 4): 24/7 A&E + neurosurgery + surgical capability
 *  - Level II (tier 3): 24/7 A&E + surgical capability OR A&E + large hospital (>150 beds)
 *  - Level III (tier 2): 24/7 A&E/ED present (emergency=yes) — community hospital with ER
 *  - Level IV (tier 1): reserved for formal classification only; the heuristic alone
 *    never lands here — a hospital either has a qualifying 24/7 ED (tier ≥2) or is NTC (tier 0)
 *
 * Key change from naive heuristic: ANY hospital with a 24/7 emergency=yes is at
 * least Level III. Previously, missing bed count + speciality data caused UK/NHS
 * hospitals to always fall to Level IV despite having active A&E departments.
 *
 * Level I note: the previous heuristic additionally required burns OR cardiothoracic
 * for tier 4. Those specialities are very rarely tagged in OSM for non-UK/US
 * facilities, causing genuine Level I trauma centres worldwide to be capped at
 * tier 3. Neurosurgery + surgical capability + A&E is the internationally consistent
 * minimum indicator — burns/cardio are now treated as supporting evidence that
 * no longer gate the promotion.
 */
export function osmHeuristicTier(opts: {
  hasEmergency: boolean
  specialities: string[]
  beds: number
}): CareTier {
  const { hasEmergency, specialities, beds } = opts
  const sp = specialities.map(s => s.toLowerCase())

  const hasNeuro       = sp.some(s => s.includes('neuro'))
  const hasSurgical    = sp.some(s => s.includes('surg') || s.includes('trauma'))
  const hasMajorTrauma = sp.some(s => s.includes('major trauma'))

  // Level I: A&E + neurosurgery + surgical capability (globally consistent indicator)
  if (hasEmergency && hasMajorTrauma) return 4
  if (hasEmergency && hasNeuro && hasSurgical) return 4
  // Level II: surgical + A&E, or large general hospital
  if (hasEmergency && hasSurgical) return 3
  if (hasEmergency && beds > 150) return 3
  // Level III: any A&E/ED present (minimum for active emergency care)
  if (hasEmergency) return 2
  // NTC: no emergency department (or an ED present but not 24/7 — gated by the caller)
  return 0
}

/**
 * Canonical user-facing label for a care level.
 * Use this everywhere a tier is displayed to the medic — never show raw tier numbers.
 */
export function careLevelLabel(tier: CareTier): string {
  switch (tier) {
    case 4: return 'Level I — Definitive'
    case 3: return 'Level II — Major'
    case 2: return 'Level III — Intermediate'
    case 1: return 'Level IV — Basic'
    case 0: return 'NTC — Non-Trauma Center'
  }
}

/**
 * Roman-numeral shorthand for the Level rating — used for map badges and compact displays.
 */
export function careLevelRoman(tier: CareTier): string {
  switch (tier) {
    case 4: return 'I'
    case 3: return 'II'
    case 2: return 'III'
    case 1: return 'IV'
    case 0: return 'NTC'
  }
}

/**
 * Human-readable label for internal tier.
 * @deprecated Use careLevelLabel() for consistent Level I–IV terminology.
 */
export function tierLabel(tier: CareTier): string {
  return careLevelLabel(tier)
}

/**
 * Return true when a facility is not suitable for adult TCCC trauma casualties.
 *
 * A facility is pediatric-only when:
 *  - Its name contains a children's/paediatric indicator, OR
 *  - Its OSM/HIFLD capability set marks it as pediatric without explicit surgical
 *    capability documented in the source data.
 *
 * Note: surgical capability inferred from trauma tier (see inferCapsFromTraumaLevel)
 * is deliberately NOT applied to pediatric-sounding hospitals in hifld.ts, so
 * "surgical" here always reflects explicitly documented adult trauma surgery.
 */
export function isPediatricOnly(name: string, capabilities: CapabilityFlag[]): boolean {
  // Name is the primary and most reliable signal — always wins
  if (/child|paediatric|pediatric/i.test(name)) return true
  // Secondary: OSM/HIFLD explicitly tags as pediatric with no documented adult surgical capability
  if (capabilities.includes('pediatric') && !capabilities.includes('surgical')) return true
  return false
}

/**
 * Infer capability flags from a facility's name.
 *
 * Additive signal — combine with caps from speciality strings, deduplicating.
 * Conservative: only flag when the name strongly implies the capability.
 * Mirrors the `isPediatricOnly` name-based pattern for other capability types.
 */
export function inferCapsFromName(name: string): CapabilityFlag[] {
  const n = name.toLowerCase()
  const caps: CapabilityFlag[] = []
  if (/neurolog|neurosurg/.test(n)) caps.push('neuro')
  if (/\bburn/.test(n)) caps.push('burns')
  if (/\bvascular/.test(n)) caps.push('vascular')
  // "Trauma Centre/Center" in the name strongly implies surgical trauma capability
  if (/trauma cent(re|er)|trauma hospital/.test(n)) caps.push('surgical')
  return caps
}

/**
 * Infer capability flags from a *formal* internal care-tier designation.
 *
 * Use ONLY when the tier originates from a confirmed classification source —
 * HIFLD trauma level, UK NHS MTC/TU designation, or OSM `trauma`/
 * `healthcare:classification` tags. Do NOT pass the OSM heuristic tier here
 * (bed-count/speciality derived) — that would create circular inference.
 *
 * Per ACS / NHS England standards:
 *  - tier 4 (Level I / MTC): 24/7 trauma surgery + neurosurgery mandated → surgical, neuro
 *  - tier 3 (Level II / TU-high): 24/7 trauma surgery mandated → surgical
 *  - tier ≤2: no mandated specialist capability
 *
 * Burns is intentionally NOT inferred — no formal designation mandates a burns unit.
 */
export function inferCapsFromClassifiedTier(tier: CareTier | null): CapabilityFlag[] {
  if (!tier) return []
  const caps: CapabilityFlag[] = []
  if (tier >= 3) caps.push('surgical')    // Level I & II: trauma surgery mandated
  if (tier === 4) caps.push('neuro')      // Level I / MTC: neurosurgery mandated
  return caps
}

/**
 * Infer capability flags from a formal US ACS trauma level number.
 *
 * Per ACS standards:
 *  - Level I: 24/7 trauma surgery + neurosurgery required (→ surgical, neuro)
 *  - Level II: 24/7 trauma surgery required (→ surgical)
 *  - Level III+: surgical capability implied only when confirmed elsewhere
 *
 * Only apply to facilities with a confirmed formal designation (HIFLD traumaLevel).
 * Do NOT apply to OSM heuristic tier — that would create circular inference.
 */
export function inferCapsFromTraumaLevel(traumaLevel: number | null): CapabilityFlag[] {
  if (!traumaLevel) return []
  const caps: CapabilityFlag[] = []
  if (traumaLevel <= 2) caps.push('surgical')   // Level I & II: trauma surgery required by ACS
  if (traumaLevel === 1) caps.push('neuro')      // Level I: neurosurgery required by ACS
  return caps
}

/**
 * Parse HIFLD service-line strings to capability flags.
 * HIFLD uses comma-separated TYPE/SERVICE field.
 */
export function hifldServiceLinesToCaps(serviceStr: string): CapabilityFlag[] {
  const s = serviceStr.toLowerCase()
  const caps: CapabilityFlag[] = []
  if (s.includes('neuro')) caps.push('neuro')
  if (s.includes('burn')) caps.push('burns')
  if (s.includes('cardio') || s.includes('cardiac') || s.includes('thoracic')) caps.push('cardiothoracic')
  if (s.includes('surg') || s.includes('trauma')) caps.push('surgical')
  if (s.includes('pediatric') || s.includes('children')) caps.push('pediatric')
  if (s.includes('obstetric') || s.includes('matern')) caps.push('obstetric')
  if (s.includes('vascular')) caps.push('vascular')
  if (s.includes('hyperbaric')) caps.push('hyperbaric')
  return caps
}

/**
 * Parse OSM healthcare:speciality tags to capability flags.
 * OSM uses semicolon-separated values.
 */
export function osmSpecialitiesToCaps(specialityStr: string): CapabilityFlag[] {
  const parts = specialityStr.split(/[;,]/).map(s => s.trim().toLowerCase())
  const caps: CapabilityFlag[] = []
  for (const p of parts) {
    if (p.includes('neuro')) caps.push('neuro')
    if (p.includes('burn')) caps.push('burns')
    if (p.includes('cardio') || p.includes('thoracic')) caps.push('cardiothoracic')
    if (p.includes('surg') || p.includes('trauma')) caps.push('surgical')
    if (p.includes('paediatric') || p.includes('pediatric') || p.includes('children')) caps.push('pediatric')
    if (p.includes('obstetric') || p.includes('midwife') || p.includes('matern')) caps.push('obstetric')
    if (p.includes('vascular')) caps.push('vascular')
    if (p.includes('hyperbaric')) caps.push('hyperbaric')
  }
  // Dedupe
  return [...new Set(caps)]
}
