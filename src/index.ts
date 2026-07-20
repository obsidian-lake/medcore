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
export { careLevelRoman, ALL_CAPABILITY_FLAGS, careLevelLabel, tierLabel } from './med/careLevel'

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
export type { FacilityScore, RankResult } from './med/rank'
export { rankFacilities, formatTransit } from './med/rank'

// ── PACE plans ────────────────────────────────────────────────────────────────
export type { FacilityPace, FacilityPaceEntry, TreatmentPace } from './med/pace'
export { buildFacilityPace, buildTreatmentPace } from './med/pace'

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

// ── MedSlide component ────────────────────────────────────────────────────────
export type { MedSlideInput } from './slide/MedSlide'
export { MedSlide } from './slide/MedSlide'
