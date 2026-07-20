/**
 * Emergency services number lookup by ISO 3166-1 alpha-2 country code.
 *
 * Used for the Treatment PACE "C" (Contingency) entry in training environment.
 * In operational environment, civilian emergency services are NOT used and
 * this entry is suppressed or annotated accordingly.
 *
 * Sources: ITU-T E.164, national telecoms regulators.
 */

/** Emergency number(s) for a country. Some countries have separate police/fire/ambulance. */
export interface EmergencyNumbers {
  /** Primary all-services number (dial this first). */
  primary: string
  /** Ambulance-specific number (if different from primary). */
  ambulance?: string
  /** Country display name. */
  country: string
}

/**
 * Sparse table — covers NATO nations, major operational areas, and common
 * training locations. Add entries as needed; unknown countries fall through
 * to the pan-EU 112 default.
 */
const TABLE: Record<string, EmergencyNumbers> = {
  // North America
  US: { primary: '911', country: 'United States' },
  CA: { primary: '911', country: 'Canada' },
  MX: { primary: '911', country: 'Mexico' },

  // UK / Ireland
  GB: { primary: '999', ambulance: '999', country: 'United Kingdom' },
  IE: { primary: '999', ambulance: '112', country: 'Ireland' },

  // EU / Schengen (112 is universal; listed separately where national number differs)
  DE: { primary: '112', ambulance: '112', country: 'Germany' },
  FR: { primary: '112', ambulance: '15', country: 'France' },
  IT: { primary: '112', ambulance: '118', country: 'Italy' },
  ES: { primary: '112', country: 'Spain' },
  PT: { primary: '112', country: 'Portugal' },
  NL: { primary: '112', country: 'Netherlands' },
  BE: { primary: '112', country: 'Belgium' },
  LU: { primary: '112', country: 'Luxembourg' },
  AT: { primary: '112', ambulance: '144', country: 'Austria' },
  CH: { primary: '112', ambulance: '144', country: 'Switzerland' },
  PL: { primary: '112', ambulance: '999', country: 'Poland' },
  CZ: { primary: '112', ambulance: '155', country: 'Czech Republic' },
  SK: { primary: '112', ambulance: '155', country: 'Slovakia' },
  HU: { primary: '112', ambulance: '104', country: 'Hungary' },
  RO: { primary: '112', country: 'Romania' },
  BG: { primary: '112', country: 'Bulgaria' },
  GR: { primary: '112', ambulance: '166', country: 'Greece' },
  HR: { primary: '112', country: 'Croatia' },
  SI: { primary: '112', country: 'Slovenia' },
  EE: { primary: '112', country: 'Estonia' },
  LV: { primary: '112', country: 'Latvia' },
  LT: { primary: '112', country: 'Lithuania' },
  FI: { primary: '112', country: 'Finland' },
  SE: { primary: '112', country: 'Sweden' },
  NO: { primary: '113', ambulance: '113', country: 'Norway' },
  DK: { primary: '112', country: 'Denmark' },
  IS: { primary: '112', country: 'Iceland' },

  // Middle East / CENTCOM AOR
  SA: { primary: '911', ambulance: '920001111', country: 'Saudi Arabia' },
  AE: { primary: '998', ambulance: '998', country: 'UAE' },
  KW: { primary: '112', ambulance: '177', country: 'Kuwait' },
  QA: { primary: '999', ambulance: '999', country: 'Qatar' },
  BH: { primary: '999', country: 'Bahrain' },
  JO: { primary: '911', country: 'Jordan' },
  IQ: { primary: '122', ambulance: '115', country: 'Iraq' },
  AF: { primary: '119', country: 'Afghanistan' },

  // Asia
  CN: { primary: '120', ambulance: '120', country: 'China' },
  IN: { primary: '112', ambulance: '108', country: 'India' },
  RU: { primary: '103', ambulance: '103', country: 'Russia' },
  PK: { primary: '115', ambulance: '115', country: 'Pakistan' },
  BD: { primary: '999', ambulance: '199', country: 'Bangladesh' },
  ID: { primary: '118', ambulance: '118', country: 'Indonesia' },
  TR: { primary: '112', ambulance: '112', country: 'Turkey' },

  // Pacific / INDO-PACOM AOR
  JP: { primary: '119', ambulance: '119', country: 'Japan' },
  KR: { primary: '119', ambulance: '119', country: 'South Korea' },
  PH: { primary: '911', country: 'Philippines' },
  AU: { primary: '000', ambulance: '000', country: 'Australia' },
  NZ: { primary: '111', ambulance: '111', country: 'New Zealand' },

  // Africa / AFRICOM AOR
  ZA: { primary: '112', ambulance: '10177', country: 'South Africa' },
  KE: { primary: '999', ambulance: '999', country: 'Kenya' },
  NG: { primary: '112', country: 'Nigeria' },
  DJ: { primary: '15', ambulance: '15', country: 'Djibouti' },

  // Americas / SOUTHCOM AOR
  CO: { primary: '123', country: 'Colombia' },
  BR: { primary: '192', ambulance: '192', country: 'Brazil' },
  PE: { primary: '117', country: 'Peru' },
  CL: { primary: '131', ambulance: '131', country: 'Chile' },
  HN: { primary: '911', country: 'Honduras' },
  GT: { primary: '911', country: 'Guatemala' },
  PA: { primary: '911', country: 'Panama' },
  EC: { primary: '911', country: 'Ecuador' },
}

/**
 * Look up emergency numbers for a country code.
 * Falls back to 112 (pan-EU / international) for unknown codes.
 */
export function getEmergencyNumbers(countryCode: string): EmergencyNumbers {
  const code = countryCode.toUpperCase().slice(0, 2)
  return TABLE[code] ?? { primary: '112', country: `Unknown (${countryCode})` }
}

/**
 * All-services formatted string for display in the PACE "C" cell.
 * e.g. "999 (United Kingdom)" or "112 / Ambulance: 15 (France)"
 */
export function formatEmergencyNumber(code: string): string {
  const nums = getEmergencyNumbers(code)
  if (nums.ambulance && nums.ambulance !== nums.primary) {
    return `${nums.primary} / Amb: ${nums.ambulance} (${nums.country})`
  }
  return `${nums.primary} (${nums.country})`
}
