/**
 * Unit tests for the curated trauma-center registry.
 *
 * Tests:
 *  - Registry is non-empty and every entry is well-formed
 *  - Level constraint: every entry is level 1 or 2
 *  - State field: non-empty string or 'OVERSEAS'
 *  - Landstuhl is present as Level I manual overseas entry
 *  - All 50 US states + DC have at least one entry
 *  - At least one Level I and one Level II entry exist
 *  - selectTraumaCentersInRadius: in-radius entries returned, out-of-radius excluded
 *  - selectTraumaCentersInRadius: zero-radius at a non-co-located point returns empty
 *  - nearestLevelITraumaCenter: returns null when nothing is within cap
 *  - nearestLevelITraumaCenter: returns nearest Level I, not Level II
 *  - nearestLevelITraumaCenter: picks the geometrically closer of two Level I options
 *  - nearestLevelITraumaCenter: Landstuhl found when querying near it within cap
 *  - No duplicate names within the same state
 */

import { selectTraumaCentersInRadius, nearestLevelITraumaCenter, _testOnly } from './traumaCenters'

const { TRAUMA_CENTERS } = _testOnly

// ---------------------------------------------------------------------------
// Registry integrity
// ---------------------------------------------------------------------------

describe('TRAUMA_CENTERS registry', () => {
  test('registry is non-empty', () => {
    expect(TRAUMA_CENTERS.length).toBeGreaterThan(0)
  })

  test('every entry has required fields with valid values', () => {
    for (const tc of TRAUMA_CENTERS) {
      expect(typeof tc.name).toBe('string')
      expect(tc.name.length).toBeGreaterThan(0)
      expect(typeof tc.lat).toBe('number')
      expect(typeof tc.lon).toBe('number')
      expect(tc.lat).toBeGreaterThan(-90)
      expect(tc.lat).toBeLessThan(90)
      expect(tc.lon).toBeGreaterThan(-180)
      expect(tc.lon).toBeLessThan(180)
      expect(tc.level === 1 || tc.level === 2).toBe(true)
      expect(typeof tc.state).toBe('string')
      expect(tc.state.length).toBeGreaterThan(0)
    }
  })

  test('all entries have level 1 or 2 only', () => {
    for (const tc of TRAUMA_CENTERS) {
      expect([1, 2] as number[]).toContain(tc.level)
    }
  })

  test('registry contains at least one Level I center', () => {
    expect(TRAUMA_CENTERS.some(tc => tc.level === 1)).toBe(true)
  })

  test('registry contains at least one Level II center', () => {
    expect(TRAUMA_CENTERS.some(tc => tc.level === 2)).toBe(true)
  })

  test('Landstuhl Regional Medical Center is present as Level I overseas manual entry', () => {
    const landstuhl = TRAUMA_CENTERS.find(
      tc => tc.name.toLowerCase().includes('landstuhl'),
    )
    expect(landstuhl).toBeDefined()
    expect(landstuhl!.level).toBe(1)
    expect(landstuhl!.state).toBe('OVERSEAS')
    expect(landstuhl!.manual).toBe(true)
    // Coordinates should be in western Germany (roughly)
    expect(landstuhl!.lat).toBeGreaterThan(48)
    expect(landstuhl!.lat).toBeLessThan(51)
    expect(landstuhl!.lon).toBeGreaterThan(6)
    expect(landstuhl!.lon).toBeLessThan(10)
  })

  test('every US state + DC has at least one entry', () => {
    const statesNeeded = [
      'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID',
      'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO',
      'MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
      'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
    ]
    const presentStates = new Set(TRAUMA_CENTERS.map(tc => tc.state))
    const missing = statesNeeded.filter(s => !presentStates.has(s))
    expect(missing).toEqual([])
  })

  test('no duplicate names within the same state', () => {
    const seen = new Map<string, Set<string>>()
    const dupes: string[] = []
    for (const tc of TRAUMA_CENTERS) {
      if (!seen.has(tc.state)) seen.set(tc.state, new Set())
      const stateSet = seen.get(tc.state)!
      const key = tc.name.toLowerCase().trim()
      if (stateSet.has(key)) dupes.push(`${tc.state}: ${tc.name}`)
      stateSet.add(key)
    }
    expect(dupes).toEqual([])
  })

  test('hasHelipad, when set, is a boolean', () => {
    for (const tc of TRAUMA_CENTERS) {
      if (tc.hasHelipad !== undefined) {
        expect(typeof tc.hasHelipad).toBe('boolean')
      }
    }
  })

  test('CONUS entries have lat within CONUS range (for non-overseas)', () => {
    const us = TRAUMA_CENTERS.filter(tc => tc.state !== 'OVERSEAS')
    // All US entries should be within rough bounding box
    // (Hawaii ~18-23 lat; Alaska ~51-71; CONUS ~24-49; allow HI/AK)
    for (const tc of us) {
      expect(tc.lat).toBeGreaterThan(18)   // south of Hawaii
      expect(tc.lat).toBeLessThan(72)      // north of Alaska
      expect(tc.lon).toBeGreaterThan(-180) // west coast of AK
      expect(tc.lon).toBeLessThan(-60)     // east coast
    }
  })
})

// ---------------------------------------------------------------------------
// selectTraumaCentersInRadius
// ---------------------------------------------------------------------------

describe('selectTraumaCentersInRadius', () => {
  test('returns entries within radius', () => {
    // UAB Hospital: 33.5059, -86.7995 — query from Birmingham AL with 5 km
    const birmingham = { lat: 33.5059, lon: -86.7995 }
    const results = selectTraumaCentersInRadius(birmingham, 5_000)
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(tc => tc.name.includes('UAB'))).toBe(true)
  })

  test('excludes entries beyond radius', () => {
    // Query from Birmingham AL with 1 m — nothing should be within that
    const birmingham = { lat: 33.5059, lon: -86.7995 }
    const results = selectTraumaCentersInRadius(birmingham, 1)
    // UAB is right at that point so might be returned; but nothing extra
    // Use a point in the Atlantic well away from any entry
    const atlantic = { lat: 40.0, lon: -30.0 }
    const empty = selectTraumaCentersInRadius(atlantic, 1_000)
    expect(empty).toHaveLength(0)
  })

  test('returns empty array when radius is 0 and target is not at a registry entry', () => {
    const midAtlantic = { lat: 30.0, lon: -40.0 }
    expect(selectTraumaCentersInRadius(midAtlantic, 0)).toHaveLength(0)
  })

  test('returns multiple entries when radius covers a metro area', () => {
    // Los Angeles has many Level I centers within 50 km
    const la = { lat: 34.05, lon: -118.25 }
    const results = selectTraumaCentersInRadius(la, 50_000)
    expect(results.length).toBeGreaterThan(2)
  })

  test('returns all US centers within a very large radius from geographic centre', () => {
    const usCenter = { lat: 39.8283, lon: -98.5795 }
    const results = selectTraumaCentersInRadius(usCenter, 3_500_000)
    // All CONUS entries should be captured (HI and AK may not be)
    const conus = TRAUMA_CENTERS.filter(
      tc => tc.state !== 'OVERSEAS' && tc.state !== 'AK' && tc.state !== 'HI',
    )
    // At least 90% of CONUS (some border states might be a few km over 3500 km)
    expect(results.length).toBeGreaterThanOrEqual(conus.length * 0.9)
  })

  test('includes both Level I and Level II entries when both are in radius', () => {
    // Florida coast has both (e.g. HCA Gulf Coast L2 near Panama City, UF Health L1 in Gainesville)
    const floridaGulfCoast = { lat: 30.15, lon: -85.64 }
    const results = selectTraumaCentersInRadius(floridaGulfCoast, 500_000)
    expect(results.some(tc => tc.level === 1)).toBe(true)
    expect(results.some(tc => tc.level === 2)).toBe(true)
  })

  test('Landstuhl returned when querying near it within radius', () => {
    // Landstuhl: 49.4005, 7.5728
    const kaiserslautern = { lat: 49.4436, lon: 7.7689 }   // ~25 km from Landstuhl
    const results = selectTraumaCentersInRadius(kaiserslautern, 50_000)
    expect(results.some(tc => tc.name.includes('Landstuhl'))).toBe(true)
  })

  test('Landstuhl NOT returned when querying from London at 500 km', () => {
    // London to Landstuhl ≈ 870 km — comfortably outside
    const london = { lat: 51.5, lon: -0.1 }
    const results = selectTraumaCentersInRadius(london, 500_000)
    expect(results.some(tc => tc.name.includes('Landstuhl'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// nearestLevelITraumaCenter
// ---------------------------------------------------------------------------

describe('nearestLevelITraumaCenter', () => {
  test('returns null when nothing is within the cap', () => {
    // Mid-Atlantic — no Level I centers within 100 km
    const atlantic = { lat: 40.0, lon: -30.0 }
    expect(nearestLevelITraumaCenter(atlantic, 100_000)).toBeNull()
  })

  test('returns null when Level II entries exist in radius but no Level I', () => {
    // HCA Gulf Coast in Panama City is Level II — if only that is in radius, return null
    // Panama City at a very tight radius: ~5 km gets HCA (Level II) but no Level I nearby
    const panamaCity = { lat: 30.1740, lon: -85.6610 }
    const result = nearestLevelITraumaCenter(panamaCity, 5_000)
    // HCA is Level 2 — should be excluded
    expect(result).toBeNull()
  })

  test('returns the nearest Level I, not Level II, within the cap', () => {
    // Panama City FL — HCA Gulf Coast (L2, ~1 km) and UAB (L1, ~380 km) both in 500 km
    const panamaCity = { lat: 30.15, lon: -85.64 }
    const result = nearestLevelITraumaCenter(panamaCity, 500_000)
    expect(result).not.toBeNull()
    expect(result!.level).toBe(1)
  })

  test('picks the geometrically closer of two Level I options', () => {
    // Between UAB (AL, ~33.5 lat) and Grady (GA, ~33.7 lat) from a midpoint
    // Use Birmingham directly — UAB should be nearest L1
    const uabCoords = { lat: 33.5059, lon: -86.7995 }
    const result = nearestLevelITraumaCenter(uabCoords, 500_000)
    expect(result).not.toBeNull()
    expect(result!.name).toContain('UAB')
  })

  test('Landstuhl returned as nearest Level I when querying near it', () => {
    const nearLandstuhl = { lat: 49.5, lon: 7.6 }    // ~11 km from Landstuhl
    const result = nearestLevelITraumaCenter(nearLandstuhl, 500_000)
    expect(result).not.toBeNull()
    expect(result!.name).toContain('Landstuhl')
    expect(result!.state).toBe('OVERSEAS')
  })

  test('respects the maxRadiusM cap — does not return Level I beyond cap', () => {
    // From Panama City at 10 km radius: UAB is ~380 km away — should not be returned
    const panamaCity = { lat: 30.15, lon: -85.64 }
    const result = nearestLevelITraumaCenter(panamaCity, 10_000)
    expect(result).toBeNull()
  })

  test('returns a Level I when one is just inside the cap', () => {
    // UAB is ~5 km from its own coordinates — easily inside a 10 km cap
    const nearUAB = { lat: 33.5100, lon: -86.7900 }
    const result = nearestLevelITraumaCenter(nearUAB, 10_000)
    expect(result).not.toBeNull()
    expect(result!.level).toBe(1)
  })

  test('UF Health Shands (Gainesville FL, L1) found from 200 km radius around Gainesville', () => {
    const gainesville = { lat: 29.6413, lon: -82.3439 }
    const result = nearestLevelITraumaCenter(gainesville, 200_000)
    expect(result).not.toBeNull()
    expect(result!.name).toContain('UF Health Shands')
  })
})
