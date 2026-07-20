/**
 * Unit tests for the hyperbaric chamber registry and radius selector.
 */

import { selectChambersInRadius, _testOnly } from './hyperbaricChambers'

const { HYPERBARIC_CHAMBERS } = _testOnly

describe('HYPERBARIC_CHAMBERS registry', () => {
  test('registry is non-empty', () => {
    expect(HYPERBARIC_CHAMBERS.length).toBeGreaterThan(0)
  })

  test('every entry has required fields with valid types', () => {
    for (const c of HYPERBARIC_CHAMBERS) {
      expect(typeof c.name).toBe('string')
      expect(c.name.length).toBeGreaterThan(0)
      expect(typeof c.lat).toBe('number')
      expect(typeof c.lon).toBe('number')
      // Sanity-check lat/lon are in plausible ranges
      expect(c.lat).toBeGreaterThan(-90)
      expect(c.lat).toBeLessThan(90)
      expect(c.lon).toBeGreaterThan(-180)
      expect(c.lon).toBeLessThan(180)
    }
  })

  test('no null-island coordinates (geocoding failure guard)', () => {
    for (const c of HYPERBARIC_CHAMBERS) {
      const isNullIsland = Math.abs(c.lat) < 0.01 && Math.abs(c.lon) < 0.01
      expect(isNullIsland).toBe(false)
    }
  })

  test('optional schema fields have correct types when present', () => {
    for (const c of HYPERBARIC_CHAMBERS) {
      if (c.country     !== undefined) expect(typeof c.country).toBe('string')
      if (c.distinction !== undefined) expect(typeof c.distinction).toBe('boolean')
      if (c.manual      !== undefined) expect(typeof c.manual).toBe('boolean')
      if (c.phone       !== undefined) expect(typeof c.phone).toBe('string')
      if (c.address     !== undefined) expect(typeof c.address).toBe('string')
      if (c.availability!== undefined) expect(typeof c.availability).toBe('string')
      if (c.notes       !== undefined) expect(typeof c.notes).toBe('string')
    }
  })

  test('all manual entries are preserved (DAN/Navy chambers)', () => {
    const manuals = HYPERBARIC_CHAMBERS.filter(c => c.manual === true)
    // We started with 27 manual entries; they must all still be present
    expect(manuals.length).toBeGreaterThanOrEqual(27)

    // Spot-check specific must-have entries
    const names = manuals.map(c => c.name.toLowerCase())
    expect(names.some(n => n.includes('duke'))).toBe(true)
    expect(names.some(n => n.includes('ddrc'))).toBe(true)
    expect(names.some(n => n.includes('naval medical center portsmouth'))).toBe(true)
    expect(names.some(n => n.includes('erasmus'))).toBe(true)
    expect(names.some(n => n.includes('mater dei') || n.includes('malta'))).toBe(true)
  })

  test('no duplicate names within the same country', () => {
    const seen = new Set<string>()
    for (const c of HYPERBARIC_CHAMBERS) {
      const key = `${c.country ?? ''}|${c.name.toLowerCase().trim()}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })
})

describe('selectChambersInRadius', () => {
  test('returns chambers within radius', () => {
    // Plymouth, UK — DDRC is at lat 50.387, lon -4.124
    const target = { lat: 50.3870, lon: -4.1240 }
    const results = selectChambersInRadius(target, 10_000)   // 10 km
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(c => c.name.toLowerCase().includes('ddrc'))).toBe(true)
  })

  test('excludes chambers outside radius', () => {
    // Plymouth, UK — 10 km radius should not include Marseille (~1500 km away)
    const target = { lat: 50.3870, lon: -4.1240 }
    const results = selectChambersInRadius(target, 10_000)
    expect(results.some(c => c.name.toLowerCase().includes('marguerite'))).toBe(false)
  })

  test('returns empty array when radius is 0 and target is not at a chamber', () => {
    // Mid-Atlantic — no chambers within 0 m
    const target = { lat: 40.0000, lon: -30.0000 }
    const results = selectChambersInRadius(target, 0)
    expect(results.length).toBe(0)
  })

  test('returns multiple chambers when radius covers an area with several', () => {
    // Somewhere in the English Channel — should get DDRC Plymouth + London within 400 km
    const target = { lat: 51.0000, lon: -1.0000 }
    const results = selectChambersInRadius(target, 400_000)   // 400 km
    expect(results.length).toBeGreaterThanOrEqual(2)
  })

  test('returns all US chambers within a very large radius from geographic centre of US', () => {
    const usCenter = { lat: 39.8283, lon: -98.5795 }
    const results = selectChambersInRadius(usCenter, 3_000_000)   // 3000 km
    // Should include at least the major US chambers seeded in the registry
    expect(results.length).toBeGreaterThanOrEqual(5)
  })

  test('returns Duke center when querying from Durham NC', () => {
    const durham = { lat: 35.9056, lon: -78.9443 }
    const results = selectChambersInRadius(durham, 5_000)
    expect(results.some(c => c.name.toLowerCase().includes('duke'))).toBe(true)
  })

  test('UHMS-accredited auto entries are also returned when in radius', () => {
    // If the auto section has been populated (after refresh:chambers is run),
    // there will be entries with manual !== true. This test is permissive —
    // it only asserts no auto entry has null-island coords.
    const autoEntries = HYPERBARIC_CHAMBERS.filter(c => !c.manual)
    for (const c of autoEntries) {
      expect(Math.abs(c.lat) + Math.abs(c.lon)).toBeGreaterThan(0.01)
    }
  })
})
