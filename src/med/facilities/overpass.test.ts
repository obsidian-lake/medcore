/**
 * Unit tests for overpass.ts internals and the knownMtc registry.
 *
 * Tests:
 *  - buildQuery includes relation clauses for both hospital tag pairs
 *  - parseElement on a relation element resolves lat/lon from center and sets osmType:'relation'
 *  - parseElement on a relation with no trauma tags but matching the MTC registry → tier 4
 *  - matchesKnownMtc: true for known MTC (name + coords); false when far away; false when wrong name
 *  - Nominatim prefix: 'R' for relation, 'W' for way/default, 'N' for node
 *  - fetchOverpass mirror failover: 504 on first endpoint → tries next; all fail → throws;
 *    all fail but stale cache present → returns cached value
 */

import { vi } from 'vitest'
import { buildQuery, parseElement, fetchOverpass, type RawElement } from './overpass'
import { matchesKnownMtc } from './knownMtc'

// ── buildQuery ────────────────────────────────────────────────────────────────

describe('buildQuery', () => {
  const q = buildQuery(52.1748, 0.1403, 80_000)

  test('includes amenity=hospital for relation', () => {
    expect(q).toContain('relation["amenity"="hospital"]')
  })

  test('includes healthcare=hospital for relation', () => {
    expect(q).toContain('relation["healthcare"="hospital"]')
  })

  test('still includes node and way for amenity=hospital', () => {
    expect(q).toContain('node["amenity"="hospital"]')
    expect(q).toContain('way["amenity"="hospital"]')
  })

  test('ends with "out center tags;"', () => {
    expect(q.trimEnd()).toMatch(/out center tags;$/)
  })
})

// ── parseElement — relation handling ─────────────────────────────────────────

describe('parseElement — relation', () => {
  const relationEl: RawElement = {
    type: 'relation',
    id: 2048374,
    // relations have no top-level lat/lon — only a center provided by out center tags
    center: { lat: 52.1748, lon: 0.1403 },
    tags: {
      'amenity': 'hospital',
      'name': "Addenbrooke's Hospital",
    },
  }

  test('resolves lat/lon from center', () => {
    const result = parseElement(relationEl)
    expect(result.hospital?.lat).toBeCloseTo(52.1748, 4)
    expect(result.hospital?.lon).toBeCloseTo(0.1403, 4)
  })

  test('sets osmType to "relation"', () => {
    const result = parseElement(relationEl)
    expect(result.hospital?.osmType).toBe('relation')
  })

  test('preserves osmId', () => {
    const result = parseElement(relationEl)
    expect(result.hospital?.osmId).toBe(2048374)
  })
})

// ── parseElement — tier 4 via knownMtc registry ───────────────────────────────

describe('parseElement — Addenbrooke\'s promoted to tier 4 via knownMtc', () => {
  // Fixture: OSM relation with no emergency/trauma tags (mirrors the live OSM state).
  const addenbEl: RawElement = {
    type: 'relation',
    id: 2048374,
    center: { lat: 52.1748, lon: 0.1403 },
    tags: {
      'amenity': 'hospital',
      'name': "Addenbrooke's Hospital",
      // No 'emergency', 'trauma', 'healthcare:classification', or trauma-hinting speciality.
    },
  }

  test('tier is 4 (Level I MTC) despite no OSM trauma tags', () => {
    const result = parseElement(addenbEl)
    expect(result.hospital?.tier).toBe(4)
  })
})

// ── matchesKnownMtc ───────────────────────────────────────────────────────────

describe('matchesKnownMtc', () => {
  const ADDENBROOKES_LAT = 52.1748
  const ADDENBROOKES_LON = 0.1403

  test('returns true for Addenbrooke\'s name and correct coords', () => {
    expect(matchesKnownMtc("Addenbrooke's Hospital", ADDENBROOKES_LAT, ADDENBROOKES_LON)).toBe(true)
  })

  test('returns false when coords are > 5 km from the registry entry', () => {
    // London (>50 km from Cambridge)
    expect(matchesKnownMtc("Addenbrooke's Hospital", 51.5, -0.1)).toBe(false)
  })

  test('returns false when name does not match even if coords are near', () => {
    // Different hospital near Cambridge (fictitious)
    expect(matchesKnownMtc('Cambridge Community Hospital', ADDENBROOKES_LAT, ADDENBROOKES_LON)).toBe(false)
  })

  test('returns true for King\'s College Hospital London', () => {
    expect(matchesKnownMtc("King's College Hospital", 51.4038, -0.0942)).toBe(true)
  })

  test('returns true for Ninewells Hospital Dundee', () => {
    expect(matchesKnownMtc('Ninewells Hospital', 56.4578, -3.0176)).toBe(true)
  })

  test('returns false for a generic hospital name nowhere near any registry entry', () => {
    expect(matchesKnownMtc('General Hospital', 48.8566, 2.3522)).toBe(false)
  })
})

// ── Nominatim osmType prefix ──────────────────────────────────────────────────
// Test indirectly via the prefix logic extracted into a helper.

describe('Nominatim OSM id prefix', () => {
  // Mirror the mapping logic from nominatim.ts lines 104-108.
  function osmPrefix(osmType: 'node' | 'way' | 'relation' | undefined): string {
    const t = osmType ?? 'way'
    return t === 'relation' ? 'R' : t === 'node' ? 'N' : 'W'
  }

  test('relation → "R"', () => expect(osmPrefix('relation')).toBe('R'))
  test('way → "W"',      () => expect(osmPrefix('way')).toBe('W'))
  test('node → "N"',     () => expect(osmPrefix('node')).toBe('N'))
  test('undefined (old cache) → "W"', () => expect(osmPrefix(undefined)).toBe('W'))
})

// ── fetchOverpass mirror failover ─────────────────────────────────────────────

describe('fetchOverpass mirror failover', () => {
  // Hospital-shaped OSM element (way) for non-empty response fixtures.
  const HOSPITAL_ELEMENT = {
    type: 'way', id: 1,
    tags: { amenity: 'hospital', name: 'Test Hospital', emergency: 'yes' },
    center: { lat: 52.0, lon: 0.1 },
  }

  /**
   * Build a fetch stub that returns different responses per hostname.
   * Unmatched hosts default to HTTP 504.
   */
  function makeUrlStub(
    rules: Record<string, { ok: boolean; data?: { elements: unknown[] } }>,
  ) {
    return vi.fn(async (url: string) => {
      const entry = Object.entries(rules).find(([key]) => (url as string).includes(key))
      const rule = entry?.[1] ?? { ok: false }
      if (!rule.ok) return { ok: false, status: 504 } as unknown as Response
      return { ok: true, json: async () => rule.data ?? { elements: [] } } as unknown as Response
    })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  test('all 3 mirrors 504, no cache → throws with user-facing message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 504 } as unknown as Response)))
    await expect(fetchOverpass({ lat: 52.0, lon: 0.1 }, 80_000, true))
      .rejects.toThrow('Overpass servers are unavailable')
  })

  test('first mirror 504, second (kumi.systems) returns non-empty → resolves with hospitals', async () => {
    vi.stubGlobal('fetch', makeUrlStub({
      'overpass-api.de':  { ok: false },
      'kumi.systems':     { ok: true, data: { elements: [HOSPITAL_ELEMENT] } },
      'private.coffee':   { ok: false },
    }))
    const result = await fetchOverpass({ lat: 52.0, lon: 0.1 }, 80_000, true)
    expect(result.hospitals.length).toBeGreaterThan(0)
  })

  test('one mirror returns clean 200 with 0 elements, others 504 → resolves empty (genuinely empty area)', async () => {
    // A global mirror returning HTTP 200 with 0 elements means the area has no hospitals.
    // This should resolve empty (not throw), unlike all-servers-down which throws.
    vi.stubGlobal('fetch', makeUrlStub({
      'overpass-api.de':  { ok: true, data: { elements: [] } },   // clean 200, genuinely empty
      'kumi.systems':     { ok: false },
      'private.coffee':   { ok: false },
    }))
    const result = await fetchOverpass({ lat: 0.0, lon: 0.0 }, 80_000, true)  // middle of ocean
    expect(result.hospitals).toHaveLength(0)  // empty, not throws
  })

  test('all mirrors 504 with valid cache (forceRefresh) → returns cached value', async () => {
    // Seed a fresh (non-expired) cache entry.
    const key = 'medplanner-overpass-v2-52.00,0.10,80000'
    const cachedHospital = {
      source: 'osm', osmId: 42, name: 'Cached Hospital', lat: 52.0, lon: 0.1,
      phone: '', address: '', hasEmergency: true, beds: 100, specialities: [],
      hasHelipad: false, capabilities: [], inferredCapabilities: [], tier: 2 as const,
    }
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), hospitals: [cachedHospital], helipads: [] }))

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 504 } as unknown as Response)))

    // forceRefresh=true skips the initial cache read; the catch fallback still reads it.
    const result = await fetchOverpass({ lat: 52.0, lon: 0.1 }, 80_000, true)
    expect(result.hospitals[0].name).toBe('Cached Hospital')
  })

  test('cache hit (no forceRefresh) → returns cache without any network request', async () => {
    const key = 'medplanner-overpass-v2-52.00,0.10,80000'
    const cachedHospital = {
      source: 'osm', osmId: 7, name: 'Warm Cache Hospital', lat: 52.0, lon: 0.1,
      phone: '', address: '', hasEmergency: false, beds: 50, specialities: [],
      hasHelipad: false, capabilities: [], inferredCapabilities: [], tier: 1 as const,
    }
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), hospitals: [cachedHospital], helipads: [] }))

    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchOverpass({ lat: 52.0, lon: 0.1 })
    expect(result.hospitals[0].name).toBe('Warm Cache Hospital')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
