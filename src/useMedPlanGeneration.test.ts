/**
 * Unit tests for useMedPlanGeneration.
 *
 * Tests:
 *  - Surfaces onProgress messages from computeMedPlan as progressMsg
 *  - generating flips true → false around the call, error stays null on success
 *  - Failure sets error and clears generating, without throwing
 *  - A stale generate() call (superseded by a newer one) resolves null and never
 *    commits its progress/error after being superseded
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { computeMedPlanMock } = vi.hoisted(() => ({ computeMedPlanMock: vi.fn() }))
vi.mock('./computeMedPlan', () => ({ computeMedPlan: computeMedPlanMock }))

import { useMedPlanGeneration } from './useMedPlanGeneration'
import type { ComputeMedPlanInput, MedPlanResult } from './computeMedPlan'

const input = {} as ComputeMedPlanInput
const result = { facilities: [] } as unknown as MedPlanResult

describe('useMedPlanGeneration', () => {
  it('surfaces progress messages and resolves the result', async () => {
    computeMedPlanMock.mockImplementation(async (_input, opts) => {
      opts.onProgress('Querying OSM Overpass…')
      opts.onProgress('Ranking facilities…')
      return result
    })

    const { result: hook } = renderHook(() => useMedPlanGeneration())

    let resolved: MedPlanResult | null = null
    await act(async () => {
      resolved = await hook.current.generate(input)
    })

    expect(resolved).toBe(result)
    expect(hook.current.progressMsg).toBe('Ranking facilities…')
    expect(hook.current.generating).toBe(false)
    expect(hook.current.error).toBeNull()
  })

  it('sets error and clears generating on failure', async () => {
    computeMedPlanMock.mockRejectedValue(new Error('ORS unreachable'))

    const { result: hook } = renderHook(() => useMedPlanGeneration())

    let resolved: MedPlanResult | null = result
    await act(async () => {
      resolved = await hook.current.generate(input)
    })

    expect(resolved).toBeNull()
    expect(hook.current.generating).toBe(false)
    expect(hook.current.error).toBe('ORS unreachable')
  })

  it('discards a stale call superseded by a newer generate()', async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })

    computeMedPlanMock
      .mockImplementationOnce(async (_input, opts) => {
        opts.onProgress('stale step')
        await firstGate
        return { ...result, tag: 'stale' } as unknown as MedPlanResult
      })
      .mockImplementationOnce(async (_input, opts) => {
        opts.onProgress('fresh step')
        return { ...result, tag: 'fresh' } as unknown as MedPlanResult
      })

    const { result: hook } = renderHook(() => useMedPlanGeneration())

    let stalePromise!: Promise<MedPlanResult | null>
    act(() => {
      stalePromise = hook.current.generate(input)
    })

    await waitFor(() => expect(hook.current.progressMsg).toBe('stale step'))

    let freshResolved: MedPlanResult | null = null
    await act(async () => {
      freshResolved = await hook.current.generate(input)
    })

    expect((freshResolved as unknown as { tag: string } | null)?.tag).toBe('fresh')
    expect(hook.current.progressMsg).toBe('fresh step')

    releaseFirst()
    const staleResolved = await act(async () => stalePromise)
    expect(staleResolved).toBeNull()
    // The stale call's completion must not clobber the fresh state that already landed.
    expect(hook.current.progressMsg).toBe('fresh step')
    expect(hook.current.generating).toBe(false)
  })
})
