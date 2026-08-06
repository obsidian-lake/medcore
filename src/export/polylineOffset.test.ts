import { describe, it, expect } from 'vitest'
import { assignRouteOffsets, DEFAULT_OFFSET_GAP_PX } from './polylineOffset'

describe('assignRouteOffsets', () => {
  it('returns zero offset for a single route', () => {
    const offsets = assignRouteOffsets(['a'])
    expect(offsets.get('a')).toBe(0)
  })

  it('returns zero offset when there are no routes', () => {
    expect(assignRouteOffsets([]).size).toBe(0)
  })

  it('centers offsets symmetrically around zero', () => {
    const offsets = assignRouteOffsets(['a', 'b', 'c'])
    expect(offsets.get('a')).toBe(-DEFAULT_OFFSET_GAP_PX)
    expect(offsets.get('b')).toBe(0)
    expect(offsets.get('c')).toBe(DEFAULT_OFFSET_GAP_PX)
  })

  it('spaces an even count of routes symmetrically with no route at zero', () => {
    const offsets = assignRouteOffsets(['a', 'b'], 4)
    expect(offsets.get('a')).toBe(-2)
    expect(offsets.get('b')).toBe(2)
  })

  it('honors a custom gap', () => {
    const offsets = assignRouteOffsets(['a', 'b', 'c'], 10)
    expect(offsets.get('a')).toBe(-10)
    expect(offsets.get('c')).toBe(10)
  })
})
