/**
 * useMedPlanGeneration — shared generating/progress/error state around computeMedPlan.
 *
 * computeMedPlan already reports step-by-step progress via onProgress (see
 * computeMedPlan.ts), but each consumer app was left to wire that into its own
 * loading state by hand — medplanner duplicated the whole pipeline inline to get
 * step messages, MFFJM skipped onProgress entirely and only shows a static
 * "GENERATING…" label. This hook centralizes that plumbing, including the
 * monotonic-generation staleness guard medplanner's runFetch implements manually,
 * so any consumer gets real progress messages for free.
 */
import { useCallback, useRef, useState } from 'react'
import { computeMedPlan } from './computeMedPlan'
import type { ComputeMedPlanInput, MedPlanResult } from './computeMedPlan'

export interface UseMedPlanGenerationResult {
  /** Run computeMedPlan, tracking generating/progressMsg/error. Resolves to null if a newer generate() call superseded this one, or on failure. */
  generate: (input: ComputeMedPlanInput) => Promise<MedPlanResult | null>
  generating: boolean
  /** Latest onProgress message from computeMedPlan (e.g. "Ranking facilities…"), cleared on new generate() call. */
  progressMsg: string
  error: string | null
}

export function useMedPlanGeneration(): UseMedPlanGenerationResult {
  const [generating, setGenerating] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const genRef = useRef(0)

  const generate = useCallback(async (input: ComputeMedPlanInput): Promise<MedPlanResult | null> => {
    const myGen = ++genRef.current
    setGenerating(true)
    setProgressMsg('')
    setError(null)

    try {
      const result = await computeMedPlan(input, {
        onProgress: msg => { if (myGen === genRef.current) setProgressMsg(msg) },
      })
      if (myGen !== genRef.current) return null
      return result
    } catch (err) {
      if (myGen === genRef.current) setError((err as Error).message)
      return null
    } finally {
      if (myGen === genRef.current) setGenerating(false)
    }
  }, [])

  return { generate, generating, progressMsg, error }
}
