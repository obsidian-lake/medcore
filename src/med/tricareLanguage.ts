/**
 * TRICARE Overseas on-demand language translation assistance.
 *
 * TRICARE beneficiaries in non-English-speaking countries can access telephonic
 * interpreter services through the TRICARE Overseas Program (TOP) Regional Call
 * Centers, administered by International SOS (24/7, 365 days/year).
 *
 * Source: https://tricare-overseas.com/contact-us
 *
 * The four regional call-center numbers are the reliable backbone — they cover
 * every country in the TOP coverage area. Selected countries also publish an
 * in-country toll-free number that routes directly to the correct center; those
 * are listed in IN_COUNTRY and grow by hand as numbers are confirmed.
 *
 * NOTE: tricare-overseas.com serves a cert that automated scripts cannot verify,
 * so in-country numbers cannot be auto-refreshed. Regional backbone numbers do
 * not change without a TOP contract modification.
 */

import { getEmergencyNumbers } from './emergencyNumbers'

// ── Region types ─────────────────────────────────────────────────────────────────

export type TricareRegion =
  | 'eurasia-africa'
  | 'lac'          // Latin America & Canada
  | 'pacific-sg'   // Pacific — Singapore (East / SE Asia)
  | 'pacific-au'   // Pacific — Sydney (Australia / NZ / Pacific islands)

const REGION_NAMES: Record<TricareRegion, string> = {
  'eurasia-africa': 'Eurasia-Africa',
  'lac':            'Latin America & Canada',
  'pacific-sg':     'Pacific (Singapore)',
  'pacific-au':     'Pacific (Sydney)',
}

/** TOP Regional Call Center numbers. Confirmed correct as of 2026-07. */
const REGIONAL_CC: Record<TricareRegion, string> = {
  'eurasia-africa': '+44-20-8762-8384',
  'lac':            '+1-215-942-8393',
  'pacific-sg':     '+65-6339-2676',
  'pacific-au':     '+61-2-9273-2710',
}

// ── Country → region mapping ──────────────────────────────────────────────────────
// Covers all ISO codes present in emergencyNumbers.ts + countryCode.ts BBOX_TABLE.
// English-speaking countries are included for completeness but suppressed by
// ENGLISH_SPEAKING before this table is reached.

const REGION_BY_COUNTRY: Record<string, TricareRegion> = {
  // North America
  CA: 'lac',  // Canada
  MX: 'lac',  // Mexico

  // Europe (all → Eurasia-Africa CC)
  DE: 'eurasia-africa',  // Germany
  FR: 'eurasia-africa',  // France
  IT: 'eurasia-africa',  // Italy
  ES: 'eurasia-africa',  // Spain
  PT: 'eurasia-africa',  // Portugal
  NL: 'eurasia-africa',  // Netherlands
  BE: 'eurasia-africa',  // Belgium
  LU: 'eurasia-africa',  // Luxembourg
  AT: 'eurasia-africa',  // Austria
  CH: 'eurasia-africa',  // Switzerland
  PL: 'eurasia-africa',  // Poland
  CZ: 'eurasia-africa',  // Czech Republic
  SK: 'eurasia-africa',  // Slovakia
  HU: 'eurasia-africa',  // Hungary
  RO: 'eurasia-africa',  // Romania
  BG: 'eurasia-africa',  // Bulgaria
  GR: 'eurasia-africa',  // Greece
  HR: 'eurasia-africa',  // Croatia
  SI: 'eurasia-africa',  // Slovenia
  EE: 'eurasia-africa',  // Estonia
  LV: 'eurasia-africa',  // Latvia
  LT: 'eurasia-africa',  // Lithuania
  FI: 'eurasia-africa',  // Finland
  SE: 'eurasia-africa',  // Sweden
  NO: 'eurasia-africa',  // Norway
  DK: 'eurasia-africa',  // Denmark
  IS: 'eurasia-africa',  // Iceland
  // English-speaking EU / UK — suppressed by ENGLISH_SPEAKING but mapped for completeness
  GB: 'eurasia-africa',  // United Kingdom
  IE: 'eurasia-africa',  // Ireland

  // Middle East / CENTCOM AOR
  SA: 'eurasia-africa',  // Saudi Arabia
  AE: 'eurasia-africa',  // United Arab Emirates
  KW: 'eurasia-africa',  // Kuwait
  QA: 'eurasia-africa',  // Qatar
  BH: 'eurasia-africa',  // Bahrain
  JO: 'eurasia-africa',  // Jordan
  IQ: 'eurasia-africa',  // Iraq
  AF: 'eurasia-africa',  // Afghanistan
  TR: 'eurasia-africa',  // Turkey

  // South / Central Asia
  IN: 'eurasia-africa',  // India
  PK: 'eurasia-africa',  // Pakistan
  BD: 'eurasia-africa',  // Bangladesh

  // Russia
  RU: 'eurasia-africa',  // Russia

  // Africa / AFRICOM AOR
  ZA: 'eurasia-africa',  // South Africa — 11 official languages, not suppressed
  KE: 'eurasia-africa',  // Kenya
  NG: 'eurasia-africa',  // Nigeria
  DJ: 'eurasia-africa',  // Djibouti

  // Pacific — Singapore CC (East / SE Asia)
  JP: 'pacific-sg',  // Japan
  KR: 'pacific-sg',  // South Korea
  CN: 'pacific-sg',  // China
  PH: 'pacific-sg',  // Philippines
  ID: 'pacific-sg',  // Indonesia

  // Pacific — Sydney CC
  AU: 'pacific-au',  // Australia — English-speaking, suppressed
  NZ: 'pacific-au',  // New Zealand — English-speaking, suppressed

  // Americas / SOUTHCOM + LAC AOR
  BR: 'lac',  // Brazil
  CO: 'lac',  // Colombia
  PE: 'lac',  // Peru
  CL: 'lac',  // Chile
  HN: 'lac',  // Honduras
  GT: 'lac',  // Guatemala
  PA: 'lac',  // Panama
  EC: 'lac',  // Ecuador
}

// ── In-country toll-free numbers ──────────────────────────────────────────────────
// Auto-refreshed by refreshTricareLanguage.mjs (quarterly via GitHub Actions).
// Countries with no in-country number fall through to the regional call-center number.

const IN_COUNTRY: Record<string, string> = {
  // Europe
  AT: '080080639',        // Austria
  BE: '80081365',         // Belgium
  BG: '008001194462',     // Bulgaria
  CH: '0800000216',       // Switzerland
  CZ: '800500380',        // Czech Republic
  DE: '08007234214',      // Germany
  DK: '80603479',         // Denmark
  EE: '8000044525',       // Estonia
  ES: '800900551',        // Spain
  FI: '080094464',        // Finland
  FR: '0805540855',       // France
  GB: '08000234384',      // United Kingdom — English-speaking, suppressed
  GR: '0080044143269',    // Greece
  HR: '0800806251',       // Croatia
  HU: '06-80-98-7462',    // Hungary
  IE: '1800946742',       // Ireland — English-speaking, suppressed
  IT: '800-928-305',      // Italy
  LT: '880031619',        // Lithuania
  LU: '80021235',         // Luxembourg
  LV: '80004573',         // Latvia
  NO: '80030193',         // Norway
  PL: '800702496',        // Poland
  PT: '800209127',        // Portugal
  RO: '0800896747',       // Romania
  SE: '0859366590',       // Sweden
  SI: '080080042',        // Slovenia
  SK: '0800121565',       // Slovakia

  // Middle East
  AE: '80004445066',      // United Arab Emirates
  BH: '80081346',         // Bahrain
  SA: '8008443274',       // Saudi Arabia
  TR: '00800448823293',   // Turkey

  // Africa
  ZA: '0800007133',       // South Africa

  // Pacific
  AU: '1-800-683-925',    // Australia — English-speaking, suppressed
  CN: '10800-852-1230',   // China
  ID: '001803442597',     // Indonesia
  JP: '0120-310200',      // Japan
  KR: '080-591-0880',     // South Korea
  NZ: '0508330203',       // New Zealand — English-speaking, suppressed
  PH: '180014410711',     // Philippines

  // Latin America & Canada
  BR: '0800-04-74890',    // Brazil
  CA: '1-877-205-2990',   // Canada — English-speaking, suppressed
  CL: '1230-020-0495',    // Chile
  CO: '01-800-518-2804',  // Colombia
  MX: '018000835914',     // Mexico
  PE: '0800-77-869',      // Peru
}

// ── English-speaking suppression set ─────────────────────────────────────────────
// Note: CA (Canada) is suppressed — English primary; LAC CC is for non-English use.
// ZA (South Africa) is intentionally NOT suppressed — 11 official languages.
// Add/remove codes here as policy clarifies.

const ENGLISH_SPEAKING = new Set<string>([
  'US',  // United States
  'GB',  // United Kingdom
  'IE',  // Ireland
  'AU',  // Australia
  'NZ',  // New Zealand
  'CA',  // Canada
])

// ── Types ─────────────────────────────────────────────────────────────────────────

export interface TricareLanguageNote {
  /** Display name of the detected country. */
  countryName: string
  /** In-country toll-free number, if confirmed for this country. */
  inCountryNumber?: string
  /** Display name of the applicable regional call center. */
  regionName: string
  /**
   * TOP Regional Call Center number, or a URL string if the country is detected
   * but not yet mapped to a region (generic fallback).
   */
  regionalNumber: string
}

// ── Lookup ────────────────────────────────────────────────────────────────────────

/**
 * Returns a language-assistance note for a given ISO 3166-1 alpha-2 country code,
 * or null when:
 *   - the code is empty or 'ZZ' (unknown / off-grid)
 *   - the country is in the English-speaking suppression set
 *
 * For countries not yet mapped to a TOP region, returns a generic note pointing
 * to the TRICARE Overseas website rather than returning null — the interpreter
 * service still exists, the specific routing is just unknown.
 *
 * Country display name comes from getEmergencyNumbers() to avoid a parallel table.
 */
export function getTricareLanguageNote(countryCode: string): TricareLanguageNote | null {
  const code = countryCode.toUpperCase().slice(0, 2)
  if (!code || code === 'ZZ') return null
  if (ENGLISH_SPEAKING.has(code)) return null

  const region = REGION_BY_COUNTRY[code]
  const countryName = getEmergencyNumbers(code).country

  if (!region) {
    // Country detected via geonames but not yet in our region map — generic fallback.
    return {
      countryName,
      regionName: 'TRICARE Overseas',
      regionalNumber: 'tricare-overseas.com/contact-us',
    }
  }

  return {
    countryName,
    inCountryNumber: IN_COUNTRY[code],
    regionName: REGION_NAMES[region],
    regionalNumber: REGIONAL_CC[region],
  }
}

// ── Formatter ─────────────────────────────────────────────────────────────────────

/**
 * One-line formatted string for display on the med brief.
 *
 * With in-country number:
 *   "TRICARE Overseas language line (South Korea): 080-429-0880 — select the
 *    interpreter option. (Regional CC: +65-6339-2676)"
 *
 * Regional CC only:
 *   "TRICARE Overseas language assistance (Germany): call the Eurasia-Africa
 *    Regional Call Center +44-20-8762-8384 and select the interpreter option."
 *
 * Generic (unmapped country):
 *   "TRICARE Overseas language assistance (Unknown): see
 *    tricare-overseas.com/contact-us for interpreter services."
 *
 * Returns null for English-speaking or unknown countries.
 */
export function formatTricareLanguageNote(countryCode: string): string | null {
  const note = getTricareLanguageNote(countryCode)
  if (!note) return null

  const { countryName, inCountryNumber, regionName, regionalNumber } = note

  if (inCountryNumber) {
    return (
      `TRICARE Overseas language line (${countryName}): ${inCountryNumber} — ` +
      `select the interpreter option. (Regional CC: ${regionalNumber})`
    )
  }

  if (regionalNumber.startsWith('tricare-overseas')) {
    return (
      `TRICARE Overseas language assistance (${countryName}): ` +
      `see ${regionalNumber} for interpreter services.`
    )
  }

  return (
    `TRICARE Overseas language assistance (${countryName}): ` +
    `call the ${regionName} Regional Call Center ${regionalNumber} and select the interpreter option.`
  )
}
