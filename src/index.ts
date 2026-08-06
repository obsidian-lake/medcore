/**
 * @pipehitter/medcore — public API
 *
 * Re-exports the med planning domain, MedSlide component, and map compositor
 * so any consumer app can import them directly without duplicating code.
 */

// ── Geo utilities ─────────────────────────────────────────────────────────────
export type { LatLon, GeoPoint } from './calc/geo'
export { mgrsToLatLon, latLonToMgrs, destination, inverse, backAzimuth, trueToGrid, trueToMagnetic, formatMgrs, parseLatLon } from './calc/geo'

// ── Care-level domain ─────────────────────────────────────────────────────────
export type { CareTier, CapabilityFlag } from './med/careLevel'
export {
  careLevelRoman, ALL_CAPABILITY_FLAGS, careLevelLabel, tierLabel,
  usTraumaLevelToTier, ukClassificationToTier, osmHeuristicTier,
  isPediatricOnly, inferCapsFromName, inferCapsFromClassifiedTier,
  inferCapsFromTraumaLevel, hifldServiceLinesToCaps, osmSpecialitiesToCaps,
} from './med/careLevel'

// ── Facilities ────────────────────────────────────────────────────────────────
export type { FacilityRecord } from './med/facilities/merge'
export { mergeFacilities, applyOverrides } from './med/facilities/merge'
export { fetchOverpass } from './med/facilities/overpass'
export { fetchHifld, isConus } from './med/facilities/hifld'
export type { HifldFacility } from './med/facilities/hifld'
export { enrichOsmAddresses } from './med/facilities/nominatim'
export { selectChambersInRadius } from './med/facilities/hyperbaricChambers'
export { selectTraumaCentersInRadius } from './med/facilities/traumaCenters'
export { findNearestLevelIBeyondRadius, EXPANDED_LEVELI_RADIUS_M } from './med/facilities/expandedLevelI'

// ── Routing ───────────────────────────────────────────────────────────────────
export type { RouteResult, IsochroneResult } from './med/routing/ors'
export { getRouteMatrix, getGroundRoute, getIsochrone60min, heloTransitS, DEFAULT_HELO_SPEED_KT, FIXED_WING_SPEED_KT, AIRFRAMES, resetOrsFailure, getOrsFailure } from './med/routing/ors'

// ── Ranking ───────────────────────────────────────────────────────────────────
export type { FacilityScore, RankResult, TransitInfo, RankInput, PhasedRecommendation } from './med/rank'
export { rankFacilities, formatTransit, transitColorClass, transitColorHex, tierDisplayLabel } from './med/rank'

// ── PACE plans ────────────────────────────────────────────────────────────────
export type { PaceLetter, FacilityPace, FacilityPaceEntry, TreatmentPace, TreatmentPaceEntry } from './med/pace'
export { buildFacilityPace, buildTreatmentPace, paceLetterColor } from './med/pace'

// ── Echelons of care ─────────────────────────────────────────────────────────
export type { EchelonNodes, EchelonPlan } from './med/echelon'
export { selectEchelonNodes, buildEchelonPlan, pickNearestLevelI, LEG2_DROP_GROUND_DIST_M, LEG2_FIXED_WING_DIST_M } from './med/echelon'

// ── Emergency numbers ─────────────────────────────────────────────────────────
export { getEmergencyNumbers, formatEmergencyNumber } from './med/emergencyNumbers'

// ── TRICARE language ──────────────────────────────────────────────────────────
export { formatTricareLanguageNote } from './med/tricareLanguage'

// ── Map compositor ────────────────────────────────────────────────────────────
export type { MapLabel } from './types/mapLabel'
export type { ComposeOptions, Arrow } from './export/composeMapCanvas'
export { composeMapCanvas } from './export/composeMapCanvas'
export { renderMedMapToCanvas } from './export/mapSnapshot'
export { applyPolylineOffsetPatch, assignRouteOffsets, DEFAULT_OFFSET_GAP_PX } from './export/polylineOffset'

// ── PDF link annotations ─────────────────────────────────────────────────────
export type { LinkAnnotation } from './export/pdfLinkAnnotations'
export { collectLinkAnnotations } from './export/pdfLinkAnnotations'

// ── Country code detection ────────────────────────────────────────────────────
export { detectCountryCode } from './util/countryCode'

// ── Full pipeline ─────────────────────────────────────────────────────────────
export type { ComputeMedPlanInput, MedPlanResult } from './computeMedPlan'
export { computeMedPlan } from './computeMedPlan'
export type { UseMedPlanGenerationResult } from './useMedPlanGeneration'
export { useMedPlanGeneration } from './useMedPlanGeneration'

// ── Slide template / branding system ─────────────────────────────────────────
export type { SlideThemeId, SlideTheme, HeaderStyle } from './slide/theme'
export { SLIDE_W, SLIDE_H, CLASS_BAR_H, HEADER_H_THIN, HEADER_H_THICK, FOOTER_H, SLIDE_PAD_H, SLIDE_PAD_V, SLIDE_THEMES } from './slide/theme'
export type { BrandConfig } from './slide/brand'
export { DEFAULT_BRAND, CLASS_PRESET_COLORS } from './slide/brand'
export { ClassificationBar } from './slide/ClassificationBar'
export { SlideHeader } from './slide/SlideHeader'
export { SlideChrome } from './slide/SlideChrome'
export { BrandEditor } from './slide/BrandEditor'
// Layout primitives for the Mission Planning tool (and any future suite app)
export { TitleSlide as MpTitleSlide } from './slide/layouts/TitleSlide'
export { BulletSlide as MpBulletSlide } from './slide/layouts/BulletSlide'
export { TwoColSlide as MpTwoColSlide } from './slide/layouts/TwoColSlide'
export { GraphicSlide as MpGraphicSlide } from './slide/layouts/GraphicSlide'

// ── MedSlide component ────────────────────────────────────────────────────────
export type { MedSlideInput } from './slide/MedSlide'
export { MedSlide } from './slide/MedSlide'
