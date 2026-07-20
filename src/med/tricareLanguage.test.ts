import { getTricareLanguageNote, formatTricareLanguageNote } from './tricareLanguage'

// ── getTricareLanguageNote ────────────────────────────────────────────────────────

describe('getTricareLanguageNote — suppression', () => {
  it('returns null for US', () => {
    expect(getTricareLanguageNote('US')).toBeNull()
  })

  it('returns null for lowercase us', () => {
    expect(getTricareLanguageNote('us')).toBeNull()
  })

  it('returns null for GB (English-speaking)', () => {
    expect(getTricareLanguageNote('GB')).toBeNull()
  })

  it('returns null for IE (English-speaking)', () => {
    expect(getTricareLanguageNote('IE')).toBeNull()
  })

  it('returns null for AU (English-speaking)', () => {
    expect(getTricareLanguageNote('AU')).toBeNull()
  })

  it('returns null for NZ (English-speaking)', () => {
    expect(getTricareLanguageNote('NZ')).toBeNull()
  })

  it('returns null for CA (English-speaking)', () => {
    expect(getTricareLanguageNote('CA')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(getTricareLanguageNote('')).toBeNull()
  })

  it('returns null for ZZ (unknown / off-grid)', () => {
    expect(getTricareLanguageNote('ZZ')).toBeNull()
  })
})

describe('getTricareLanguageNote — Eurasia-Africa', () => {
  it('returns Eurasia-Africa note for DE with in-country number', () => {
    const note = getTricareLanguageNote('DE')
    expect(note).not.toBeNull()
    expect(note!.countryName).toBe('Germany')
    expect(note!.regionName).toBe('Eurasia-Africa')
    expect(note!.regionalNumber).toBe('+44-20-8762-8384')
    expect(note!.inCountryNumber).toBe('08007234214')
  })

  it('returns Eurasia-Africa note for FR with in-country number', () => {
    const note = getTricareLanguageNote('FR')
    expect(note).not.toBeNull()
    expect(note!.regionName).toBe('Eurasia-Africa')
    expect(note!.countryName).toBe('France')
    expect(note!.inCountryNumber).toBe('0805540855')
  })

  it('does not map JP to Eurasia-Africa', () => {
    const note = getTricareLanguageNote('JP')
    expect(note!.regionName).not.toBe('Eurasia-Africa')
  })
})

describe('getTricareLanguageNote — Pacific Singapore', () => {
  it('returns Pacific-SG note for JP with in-country number', () => {
    const note = getTricareLanguageNote('JP')
    expect(note).not.toBeNull()
    expect(note!.countryName).toBe('Japan')
    expect(note!.regionName).toBe('Pacific (Singapore)')
    expect(note!.regionalNumber).toBe('+65-6339-2676')
    expect(note!.inCountryNumber).toBe('0120-310200')
  })

  it('returns Pacific-SG note with in-country number for KR (medical assistance line)', () => {
    const note = getTricareLanguageNote('KR')
    expect(note).not.toBeNull()
    expect(note!.countryName).toBe('South Korea')
    expect(note!.regionName).toBe('Pacific (Singapore)')
    expect(note!.regionalNumber).toBe('+65-6339-2676')
    expect(note!.inCountryNumber).toBe('080-591-0880')
  })
})

describe('getTricareLanguageNote — LAC', () => {
  it('returns LAC note for MX', () => {
    const note = getTricareLanguageNote('MX')
    expect(note).not.toBeNull()
    expect(note!.regionName).toBe('Latin America & Canada')
    expect(note!.regionalNumber).toBe('+1-215-942-8393')
  })

  it('returns LAC note for BR', () => {
    const note = getTricareLanguageNote('BR')
    expect(note).not.toBeNull()
    expect(note!.regionName).toBe('Latin America & Canada')
  })
})

describe('getTricareLanguageNote — generic fallback', () => {
  it('returns a generic note for a non-English country not in the region map', () => {
    // XK (Kosovo) is not in our region table
    const note = getTricareLanguageNote('XK')
    expect(note).not.toBeNull()
    expect(note!.regionalNumber).toContain('tricare-overseas')
    expect(note!.regionName).toBe('TRICARE Overseas')
  })
})

// ── formatTricareLanguageNote ─────────────────────────────────────────────────────

describe('formatTricareLanguageNote — suppression', () => {
  it('returns null for US', () => {
    expect(formatTricareLanguageNote('US')).toBeNull()
  })

  it('returns null for CA', () => {
    expect(formatTricareLanguageNote('CA')).toBeNull()
  })

  it('returns null for AU', () => {
    expect(formatTricareLanguageNote('AU')).toBeNull()
  })

  it('returns null for ZZ', () => {
    expect(formatTricareLanguageNote('ZZ')).toBeNull()
  })
})

describe('formatTricareLanguageNote — in-country + regional', () => {
  it('formats note for DE with in-country number and regional CC', () => {
    const s = formatTricareLanguageNote('DE')
    expect(s).not.toBeNull()
    expect(s).toContain('Germany')
    expect(s).toContain('08007234214')
    expect(s).toContain('+44-20-8762-8384')
    expect(s).toContain('interpreter')
    expect(s).toMatch(/Regional CC/)
  })

  it('formats note for JP with in-country number and regional CC', () => {
    const s = formatTricareLanguageNote('JP')
    expect(s).toContain('Japan')
    expect(s).toContain('0120-310200')
    expect(s).toContain('+65-6339-2676')
    expect(s).toMatch(/Regional CC/)
  })

  it('formats full note for KR with both numbers (medical assistance line)', () => {
    const s = formatTricareLanguageNote('KR')
    expect(s).not.toBeNull()
    expect(s).toContain('South Korea')
    expect(s).toContain('080-591-0880')
    expect(s).toContain('+65-6339-2676')
    expect(s).toContain('interpreter')
    expect(s).toMatch(/Regional CC/)
  })
})

describe('formatTricareLanguageNote — regional-only (no in-country number)', () => {
  it('formats regional-only note for IQ (Iraq — no in-country number)', () => {
    const s = formatTricareLanguageNote('IQ')
    expect(s).not.toBeNull()
    expect(s).toContain('Iraq')
    expect(s).toContain('Eurasia-Africa')
    expect(s).toContain('+44-20-8762-8384')
    expect(s).toContain('interpreter')
  })
})

describe('formatTricareLanguageNote — generic fallback', () => {
  it('formats generic note for unmapped country', () => {
    const s = formatTricareLanguageNote('XK')
    expect(s).not.toBeNull()
    expect(s).toContain('tricare-overseas')
    expect(s).toContain('interpreter')
  })
})
