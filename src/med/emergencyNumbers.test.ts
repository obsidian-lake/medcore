/**
 * Unit tests for emergency number lookup.
 */

import { getEmergencyNumbers, formatEmergencyNumber } from './emergencyNumbers'

describe('getEmergencyNumbers', () => {
  test('US → 911', () => {
    const n = getEmergencyNumbers('US')
    expect(n.primary).toBe('911')
    expect(n.country).toBe('United States')
  })

  test('UK → 999', () => {
    const n = getEmergencyNumbers('GB')
    expect(n.primary).toBe('999')
  })

  test('France → 112 primary, 15 ambulance', () => {
    const n = getEmergencyNumbers('FR')
    expect(n.primary).toBe('112')
    expect(n.ambulance).toBe('15')
  })

  test('Norway → 113', () => {
    const n = getEmergencyNumbers('NO')
    expect(n.primary).toBe('113')
  })

  test('unknown country → 112 fallback', () => {
    const n = getEmergencyNumbers('ZZ')
    expect(n.primary).toBe('112')
  })

  test('case-insensitive', () => {
    const n = getEmergencyNumbers('us')
    expect(n.primary).toBe('911')
  })
})

describe('formatEmergencyNumber', () => {
  test('US: no ambulance suffix', () => {
    const s = formatEmergencyNumber('US')
    expect(s).toBe('911 (United States)')
  })

  test('France: includes ambulance suffix', () => {
    const s = formatEmergencyNumber('FR')
    expect(s).toContain('112')
    expect(s).toContain('15')
    expect(s).toContain('France')
  })

  test('UK: single number, no suffix', () => {
    const s = formatEmergencyNumber('GB')
    expect(s).toBe('999 (United Kingdom)')
  })
})
