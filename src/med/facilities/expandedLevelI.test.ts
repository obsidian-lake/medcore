/**
 * Unit tests for the expanded Level-I facility finder.
 *
 * Because nearestLevelITraumaCenter, fromTraumaCenter, fetchOverpassLevelIOnly,
 * fetchHifld, and mergeFacilities all have external dependencies, we mock them
 * with vi.mock so tests run without network access or the real registry.
 *
 * Tests:
 *  - Registry-first: returns registry entry immediately when nearestLevelITraumaCenter hits
 *  - Returns null when no tier-4 facility is found in merged output (registry miss)
 *  - Returns the nearest tier-4 facility when found by expanded fetch
 *  - Excludes pediatric-only tier-4 facilities
 *  - Excludes custom (isCustom) tier-4 facilities
 *  - Sets excludeFromPace: true on the returned facility
 *  - Returns null when the merged list is empty (both fetchers return nothing)
 *  - Picks the nearest among multiple tier-4 candidates
 *  - CONUS path uses HIFLD only (no Overpass) when registry misses
 *  - Non-CONUS path uses targeted Overpass only (no HIFLD) when registry misses
 *  - Fetches at EXPANDED_LEVELI_RADIUS_M even when innerRadiusM is smaller
 */

import { vi, describe, test, expect, beforeEach } from 'vitest'
import { findNearestLevelIBeyondRadius, EXPANDED_LEVELI_RADIUS_M } from './expandedLevelI'
import type { FacilityRecord } from './merge'
import type { TraumaCenter } from './traumaCenters'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('./traumaCenters', () => ({
  nearestLevelITraumaCenter: vi.fn(),
}))
vi.mock('./merge', () => ({
  mergeFacilities: vi.fn(),
  fromTraumaCenter: vi.fn(),
}))
vi.mock('./overpass', () => ({
  fetchOverpassLevelIOnly: vi.fn(),
}))
vi.mock('./hifld', () => ({
  fetchHifld: vi.fn(),
}))

import { nearestLevelITraumaCenter } from './traumaCenters'
import { mergeFacilities, fromTraumaCenter } from './merge'
import { fetchOverpassLevelIOnly } from './overpass'
import { fetchHifld } from './hifld'

const mockNearestLevelI   = nearestLevelITraumaCenter as ReturnType<typeof vi.fn>
const mockFromTraumaCenter = fromTraumaCenter          as ReturnType<typeof vi.fn>
const mockMergeFacilities  = mergeFacilities            as ReturnType<typeof vi.fn>
const mockFetchLevelIOnly  = fetchOverpassLevelIOnly    as ReturnType<typeof vi.fn>
const mockFetchHifld       = fetchHifld                 as ReturnType<typeof vi.fn>

// ── Factory helpers ───────────────────────────────────────────────────────────

function mkFacility(overrides: Partial<FacilityRecord> & { lat: number; lon: number }): FacilityRecord {
  return {
    id:                   `fac-${Math.random().toString(36).slice(2)}`,
    name:                 'Test Facility',
    lat:                  overrides.lat,
    lon:                  overrides.lon,
    phone:                '',
    address:              '',
    beds:                 200,
    hasHelipad:           true,
    hasEmergency:         true,
    tier:                 4,
    capabilities:         [],
    inferredCapabilities: [],
    pediatricOnly:        false,
    source:               'registry',
    isCustom:             false,
    ...overrides,
  }
}

function mkTraumaCenter(overrides?: Partial<TraumaCenter>): TraumaCenter {
  return {
    name: 'UAB Hospital',
    lat: 33.5059, lon: -86.7995,
    level: 1,
    state: 'AL',
    ...overrides,
  }
}

const TARGET    = { lat: 51.5, lon: -0.1 }   // London — non-CONUS
const TARGET_US = { lat: 30.15, lon: -85.64 } // Panama City FL — CONUS

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  // Default: registry misses (fall through to network path)
  mockNearestLevelI.mockReturnValue(null)
  mockFromTraumaCenter.mockReturnValue(mkFacility({ lat: 33.5, lon: -86.8, id: 'registry-uab' }))
  mockFetchLevelIOnly.mockResolvedValue([])
  mockFetchHifld.mockResolvedValue([])
  mockMergeFacilities.mockReturnValue([])
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('findNearestLevelIBeyondRadius', () => {

  // ── Registry-first path ──────────────────────────────────────────────────

  test('returns registry Level I immediately when nearestLevelITraumaCenter finds one', async () => {
    const tc = mkTraumaCenter()
    const record = mkFacility({ lat: 33.5, lon: -86.8, id: 'registry-uab' })
    mockNearestLevelI.mockReturnValue(tc)
    mockFromTraumaCenter.mockReturnValue(record)

    const result = await findNearestLevelIBeyondRadius(TARGET_US, 80_000, true)
    expect(result).not.toBeNull()
    expect(result!.excludeFromPace).toBe(true)
    // Network calls should be skipped entirely
    expect(mockFetchHifld).not.toHaveBeenCalled()
    expect(mockFetchLevelIOnly).not.toHaveBeenCalled()
  })

  test('registry hit: sets excludeFromPace on the converted registry record', async () => {
    const tc = mkTraumaCenter()
    const base = mkFacility({ lat: 33.5, lon: -86.8 })
    mockNearestLevelI.mockReturnValue(tc)
    mockFromTraumaCenter.mockReturnValue(base)

    const result = await findNearestLevelIBeyondRadius(TARGET, 80_000, false)
    expect(result!.excludeFromPace).toBe(true)
    // fromTraumaCenter was called with the registry entry
    expect(mockFromTraumaCenter).toHaveBeenCalledWith(tc)
  })

  // ── Network fallback path (registry returns null) ────────────────────────

  test('returns null when no tier-4 facility is found in merged output', async () => {
    const t2 = mkFacility({ lat: 51.6, lon: -0.2, tier: 2 })
    mockMergeFacilities.mockReturnValue([t2])

    const result = await findNearestLevelIBeyondRadius(TARGET, 80_000, false)
    expect(result).toBeNull()
  })

  test('returns the nearest tier-4 facility from network when registry misses', async () => {
    const level1 = mkFacility({ id: 'l1', lat: 51.7, lon: -0.3, tier: 4 })
    mockMergeFacilities.mockReturnValue([level1])

    const result = await findNearestLevelIBeyondRadius(TARGET, 80_000, false)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('l1')
  })

  test('sets excludeFromPace: true on network-found facility', async () => {
    const level1 = mkFacility({ id: 'l1', lat: 51.7, lon: -0.3, tier: 4 })
    mockMergeFacilities.mockReturnValue([level1])

    const result = await findNearestLevelIBeyondRadius(TARGET, 80_000, false)
    expect(result!.excludeFromPace).toBe(true)
  })

  test('excludes pediatric-only tier-4 facilities (network path)', async () => {
    const ped   = mkFacility({ id: 'ped', lat: 51.55, lon: -0.1, tier: 4, pediatricOnly: true })
    const adult = mkFacility({ id: 'adu', lat: 51.9,  lon: -0.3, tier: 4, pediatricOnly: false })
    mockMergeFacilities.mockReturnValue([ped, adult])

    const result = await findNearestLevelIBeyondRadius(TARGET, 80_000, false)
    expect(result!.id).toBe('adu')
  })

  test('excludes isCustom tier-4 facilities (network path)', async () => {
    const sost  = mkFacility({ id: 'sost', lat: 51.55, lon: -0.1, tier: 4, isCustom: true })
    const hosp  = mkFacility({ id: 'hosp', lat: 51.9,  lon: -0.3, tier: 4, isCustom: false })
    mockMergeFacilities.mockReturnValue([sost, hosp])

    const result = await findNearestLevelIBeyondRadius(TARGET, 80_000, false)
    expect(result!.id).toBe('hosp')
  })

  test('picks the nearest among multiple valid tier-4 candidates', async () => {
    const near = mkFacility({ id: 'near', lat: 51.6, lon: -0.1, tier: 4 })
    const far  = mkFacility({ id: 'far',  lat: 55.0, lon: -3.0, tier: 4 })
    mockMergeFacilities.mockReturnValue([far, near])

    const result = await findNearestLevelIBeyondRadius(TARGET, 80_000, false)
    expect(result!.id).toBe('near')
  })

  test('returns null when merged list is empty (network path)', async () => {
    mockMergeFacilities.mockReturnValue([])
    const result = await findNearestLevelIBeyondRadius(TARGET, 80_000, false)
    expect(result).toBeNull()
  })

  // ── Data-source routing (registry misses → network) ──────────────────────

  test('CONUS: calls fetchHifld when registry misses, does not call fetchOverpassLevelIOnly', async () => {
    mockMergeFacilities.mockReturnValue([])
    await findNearestLevelIBeyondRadius(TARGET_US, 80_000, true)
    expect(mockFetchHifld).toHaveBeenCalledWith(TARGET_US, expect.any(Number))
    expect(mockFetchLevelIOnly).not.toHaveBeenCalled()
  })

  test('non-CONUS: calls fetchOverpassLevelIOnly when registry misses, does not call fetchHifld', async () => {
    mockMergeFacilities.mockReturnValue([])
    await findNearestLevelIBeyondRadius(TARGET, 80_000, false)
    expect(mockFetchLevelIOnly).toHaveBeenCalledWith(TARGET, expect.any(Number))
    expect(mockFetchHifld).not.toHaveBeenCalled()
  })

  test('fetches at EXPANDED_LEVELI_RADIUS_M even when innerRadiusM is smaller', async () => {
    mockMergeFacilities.mockReturnValue([])
    await findNearestLevelIBeyondRadius(TARGET, 30_000, false)
    expect(mockFetchLevelIOnly).toHaveBeenCalledWith(TARGET, EXPANDED_LEVELI_RADIUS_M)
  })

  test('CONUS: fetches HIFLD at EXPANDED_LEVELI_RADIUS_M when innerRadiusM is smaller', async () => {
    mockMergeFacilities.mockReturnValue([])
    await findNearestLevelIBeyondRadius(TARGET_US, 30_000, true)
    expect(mockFetchHifld).toHaveBeenCalledWith(TARGET_US, EXPANDED_LEVELI_RADIUS_M)
  })

  test('nearestLevelITraumaCenter is called with the expanded radius', async () => {
    mockMergeFacilities.mockReturnValue([])
    await findNearestLevelIBeyondRadius(TARGET, 30_000, false)
    expect(mockNearestLevelI).toHaveBeenCalledWith(TARGET, EXPANDED_LEVELI_RADIUS_M)
  })

})
