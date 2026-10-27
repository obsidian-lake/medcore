/**
 * MedWorkspaceState — the slice of a consumer app's own state that the
 * shared med-workspace widgets (MedMap, MedMissionParamsCard, MedPacePreview,
 * MedFacilityList) read and patch. Narrower than medplanner's full AppState:
 * it excludes fields none of these four widgets touch (multi-segment support,
 * suite-handoff import metadata, free-text notes, the ORS API key, slide
 * branding). Consumers extract these fields from their own app state and
 * pass them in via a controlled `state`/`onPatch` pair — same fully-
 * controlled, no-context-no-hooks pattern as slide/BrandEditor.tsx.
 *
 * Fetched/derived pipeline outputs that live OUTSIDE a consumer's persisted
 * state entirely (medplanner's `rankedFacilities` useMemo, `groundRoutes`/
 * `isochrone60` fetch results) are deliberately NOT part of this type —
 * those stay separate widget props, same as medplanner's own App.tsx already
 * threads them.
 */

import type { FacilityRecord, FacilityOverride } from './facilities/merge'
import type { CustomFacility } from '../types/customFacility'
import type { RankResult } from './rank'
import type { FacilityPace, TreatmentPace, PaceLetter } from './pace'
import type { EchelonPlan } from './echelon'

export interface MedWorkspaceState {
  targetLat: number
  targetLon: number
  targetRaw: string

  environment: 'training' | 'operational'
  diveMode: boolean
  rotaryWingAvailable: boolean
  rotaryWingType: string
  heloSpeedKt: number
  transferAssetType: string
  transferAssetSpeedKt: number
  countryCode: string
  searchRadiusM: number
  showIsochrone: boolean

  opName: string
  unitName: string

  facilities: FacilityRecord[]
  customFacilities: CustomFacility[]
  facilityOverrides: Record<string, FacilityOverride>
  facilityRankOrder: string[] | null

  rankResult: RankResult | null
  facilityPace: FacilityPace | null
  facilityPaceOverrides: Partial<Record<PaceLetter, string>>
  chamberPace: FacilityPace | null
  chamberPaceOverrides: Partial<Record<PaceLetter, string>>
  treatmentPace: TreatmentPace | null
  treatmentPaceOverrides: Partial<Record<PaceLetter, { label?: string; detail?: string }>>
  echelonPlan: EchelonPlan | null
}

/** A controlled-component patch callback — same shape as slide/BrandEditor.
 *  tsx's `onChange`, just named `onPatch` per the widgets' own convention
 *  (every widget reads `state` as a prop and computes a patch from it, so a
 *  plain partial object is always sufficient — no functional updater is
 *  ever needed here). */
export type MedWorkspacePatch = (patch: Partial<MedWorkspaceState>) => void
