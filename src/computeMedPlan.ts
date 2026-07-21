/**
 * computeMedPlan — self-contained med planning pipeline.
 *
 * Extracted from medplanner's App.tsx `runFetch` so any consumer (MFFJM, future tools)
 * can compute a full PACE plan without embedding the medplanner app.
 *
 * Requires network at compute time (Overpass / HIFLD / Nominatim / ORS).
 * Result is serializable; store in app state for offline slide rendering.
 */

import type { FacilityRecord } from './med/facilities/merge'
import { mergeFacilities, applyOverrides } from './med/facilities/merge'
import { fetchOverpass } from './med/facilities/overpass'
import { fetchHifld, isConus } from './med/facilities/hifld'
import { enrichOsmAddresses } from './med/facilities/nominatim'
import { selectChambersInRadius } from './med/facilities/hyperbaricChambers'
import { selectTraumaCentersInRadius } from './med/facilities/traumaCenters'
import { findNearestLevelIBeyondRadius, EXPANDED_LEVELI_RADIUS_M } from './med/facilities/expandedLevelI'
import { rankFacilities } from './med/rank'
import type { FacilityScore, RankResult } from './med/rank'
import { buildFacilityPace, buildTreatmentPace } from './med/pace'
import type { FacilityPace, TreatmentPace, PaceLetter } from './med/pace'
import { getRouteMatrix, heloTransitS, DEFAULT_HELO_SPEED_KT, FIXED_WING_SPEED_KT, AIRFRAMES, resetOrsFailure, getOrsFailure } from './med/routing/ors'
import type { RouteResult } from './med/routing/ors'
import { selectEchelonNodes, buildEchelonPlan, pickNearestLevelI, LEG2_DROP_GROUND_DIST_M, LEG2_FIXED_WING_DIST_M } from './med/echelon'
import type { EchelonNodes, EchelonPlan } from './med/echelon'
import { getEmergencyNumbers, formatEmergencyNumber } from './med/emergencyNumbers'
import { inverse } from './calc/geo'
import { detectCountryCode } from './util/countryCode'
import type { CustomFacility } from './types/customFacility'

// ── Input / Output types ───────────────────────────────────────────────────────

export interface ComputeMedPlanInput {
  lat: number
  lon: number
  searchRadiusM: number
  environment: 'training' | 'operational'
  diveMode: boolean
  rotaryWingAvailable: boolean
  heloSpeedKt: number
  /** AIRFRAME id for organic rotary-wing (used for label in treatment PACE). */
  rotaryWingType?: string
  /** AIRFRAME id for patient transfer asset. Defaults to rotaryWingType. */
  transferAssetType?: string
  transferAssetSpeedKt?: number
  customFacilities?: CustomFacility[]
  facilityOverrides?: Record<string, Partial<FacilityRecord>>
  facilityPaceOverrides?: Partial<Record<PaceLetter, string>>
  chamberPaceOverrides?: Partial<Record<PaceLetter, string>>
  treatmentPaceOverrides?: Partial<Record<PaceLetter, { label?: string; detail?: string }>>
}

export interface MedPlanResult {
  /** All facilities found and ranked (used for map compositor). */
  facilities: FacilityRecord[]
  /** Ground-route geometries keyed by facility id (and 'leg2:...' for inter-facility). */
  groundRoutes: Record<string, RouteResult>
  facilityPace: FacilityPace
  chamberPace: FacilityPace | null
  treatmentPace: TreatmentPace
  echelonPlan: EchelonPlan | null
  countryCode: string
  targetLat: number
  targetLon: number
  /**
   * Final ranked facility list (post Level-I expansion) used by consumers to
   * rebuild PACE plans offline without a network round-trip (e.g. the MFFJM
   * refine panel in the Products tab).
   */
  ranked: FacilityScore[]
}

// ── Main function ──────────────────────────────────────────────────────────────

export async function computeMedPlan(
  input: ComputeMedPlanInput,
  opts?: { onProgress?: (msg: string) => void },
): Promise<MedPlanResult> {
  const { onProgress } = opts ?? {}
  const progress = (msg: string) => { onProgress?.(msg) }

  const target = { lat: input.lat, lon: input.lon }
  const heloSpeed = input.heloSpeedKt || DEFAULT_HELO_SPEED_KT
  const searchRadius = input.searchRadiusM

  resetOrsFailure()

  // 1. OSM Overpass
  progress('Querying OSM Overpass…')
  const { hospitals: osmFacilities } = await fetchOverpass(target, searchRadius)

  // 2. HIFLD (CONUS only)
  let hifldFacilities: Awaited<ReturnType<typeof fetchHifld>> = []
  if (isConus(target)) {
    progress('Enriching with HIFLD (US trauma data)…')
    hifldFacilities = await fetchHifld(target, searchRadius)
  }

  // 3. Nominatim address enrichment
  progress('Enriching facility addresses…')
  const addressEnrichment = await enrichOsmAddresses(osmFacilities)
  const enrichedOsm = addressEnrichment.size > 0
    ? osmFacilities.map(f =>
        !f.address && addressEnrichment.has(f.osmId)
          ? { ...f, address: addressEnrichment.get(f.osmId)! }
          : f
      )
    : osmFacilities

  // 4. Merge + apply overrides
  const inRadiusChambers      = selectChambersInRadius(target, searchRadius)
  const inRadiusTraumaCenters = selectTraumaCentersInRadius(target, searchRadius)
  const rawMerged = mergeFacilities(
    enrichedOsm, hifldFacilities, input.customFacilities ?? [],
    inRadiusChambers, inRadiusTraumaCenters,
  )
  const merged: FacilityRecord[] = rawMerged.map(f => {
    const ov = input.facilityOverrides?.[f.id]
    return ov ? applyOverrides(f, ov) : f
  })

  // 5. Ground transit matrix (ORS)
  progress('Computing ground transit times…')
  const destinations = merged.map(f => ({ lat: f.lat, lon: f.lon }))
  const durations = await getRouteMatrix(target, destinations)

  // 6. Helo transits
  const heloTransits = merged.map(f =>
    input.rotaryWingAvailable && !input.diveMode && f.hasHelipad
      ? heloTransitS(target, { lat: f.lat, lon: f.lon }, heloSpeed)
      : null
  )

  // 7. Rank
  progress('Ranking facilities…')
  const rankInputs = merged.map((f, i) => ({
    facility: f,
    groundDurationS: durations[i] > 0 ? durations[i] : null,
    heloDurationS: heloTransits[i],
  }))
  let rankResult: RankResult = rankFacilities(rankInputs)

  // 8. Level-I guarantee (echelon plan needs definitive care)
  let finalMerged: FacilityRecord[] = merged
  let levelINotFoundWarning: string | null = null
  if (!input.diveMode) {
    let levelIScore: FacilityScore | null = pickNearestLevelI(rankResult.ranked)
    if (!levelIScore) {
      try {
        progress('Searching wider area for Level I trauma center…')
        const levelIFacility = await findNearestLevelIBeyondRadius(target, searchRadius, isConus(target))
        if (levelIFacility) {
          let l1GroundS: number | null = null
          try {
            const { getGroundRoute } = await import('./med/routing/ors')
            const r = await getGroundRoute(target, { lat: levelIFacility.lat, lon: levelIFacility.lon })
            if (r.durationS > 0) l1GroundS = r.durationS
          } catch { /* non-fatal */ }
          const l1HeloS =
            input.rotaryWingAvailable && levelIFacility.hasHelipad
              ? heloTransitS(target, { lat: levelIFacility.lat, lon: levelIFacility.lon }, heloSpeed)
              : null
          const l1EffectiveS =
            l1HeloS !== null && l1GroundS !== null ? Math.min(l1HeloS, l1GroundS)
            : l1HeloS ?? l1GroundS ?? Infinity
          levelIScore = {
            facility: levelIFacility,
            transit: { groundDurationS: l1GroundS, heloDurationS: l1HeloS, effectiveDurationS: l1EffectiveS },
            score: 0,
            withinGoldenHour: l1EffectiveS <= 3600,
          }
          finalMerged = [...merged, levelIFacility]
          rankResult = { ...rankResult, ranked: [...rankResult.ranked, levelIScore] }
        }
      } catch { /* non-fatal */ }

      if (!pickNearestLevelI(rankResult.ranked)) {
        levelINotFoundWarning =
          `No Level I trauma center found within ${Math.round(EXPANDED_LEVELI_RADIUS_M / 1000)} km — ` +
          `verify onward evacuation to definitive care manually.`
      }
    }
  }

  // 9. Country code + emergency numbers
  const countryCode = await detectCountryCode(target.lat, target.lon)
  const emergNums = getEmergencyNumbers(countryCode)

  // 10. Build PACE plans
  progress('Building PACE plans…')
  let facilityPace = buildFacilityPace({
    ranked: rankResult.ranked,
    overrides: input.facilityPaceOverrides,
    allFacilities: finalMerged,
    poolMode: 'trauma',
  })

  if (levelINotFoundWarning) {
    facilityPace = { ...facilityPace, warnings: [...facilityPace.warnings, levelINotFoundWarning] }
  }

  const orsFailure = getOrsFailure()
  if (orsFailure) {
    const orsWarn =
      orsFailure.kind === 'auth'
        ? `⚠ ORS rejected the API key (HTTP ${orsFailure.status}) — check VITE_ORS_API_KEY. Transit times are straight-line estimates; Echelons of Care may be suppressed.`
        : orsFailure.kind === 'rate-limit'
          ? `⚠ ORS rate limit hit (HTTP 429) — routing degraded to straight-line estimates.`
          : orsFailure.kind === 'no-key'
            ? `⚠ No ORS API key configured — transit times are straight-line estimates only.`
            : `⚠ ORS routing failed — transit times are straight-line estimates.`
    facilityPace = { ...facilityPace, warnings: [...facilityPace.warnings, orsWarn] }
  }

  const chamberPace = input.diveMode
    ? buildFacilityPace({
        ranked: rankResult.ranked,
        overrides: input.chamberPaceOverrides,
        allFacilities: finalMerged,
        requiredCapability: 'hyperbaric',
        poolMode: 'capability',
      })
    : null

  // 11. Echelon plan
  const organicAf = AIRFRAMES.find(a => a.id === input.rotaryWingType)
  const organicAssetLabel = organicAf ? organicAf.label : (input.rotaryWingAvailable ? 'Organic lift' : '')
  const transferAf = AIRFRAMES.find(a => a.id === input.transferAssetType)
  const transferAssetLabel = transferAf ? transferAf.label : organicAssetLabel

  const nearestFacilityName = facilityPace.entries.find(e => e.letter === 'P')?.facility.name
  const treatmentPace = buildTreatmentPace({
    environment: input.environment,
    countryCode,
    emergencyNumberStr: formatEmergencyNumber(countryCode),
    countryName: emergNums.country,
    overrides: input.treatmentPaceOverrides,
    rotaryWingAvailable: input.rotaryWingAvailable,
    organicAssetLabel,
    nearestFacilityName,
  })

  const pEntry = facilityPace.entries.find(e => e.letter === 'P')
  const pacePrimaryScore = pEntry
    ? rankResult.ranked.find(s => s.facility.id === pEntry.facility.id)
      ?? { facility: pEntry.facility, transit: pEntry.transit, score: 0, withinGoldenHour: pEntry.transit.effectiveDurationS <= 3600 }
    : undefined

  let echelonNodes: EchelonNodes | null = selectEchelonNodes(
    rankResult.ranked,
    pacePrimaryScore,
    input.environment,
  )

  let echelonPlan: EchelonPlan | null = null
  if (echelonNodes) {
    const stabCoord = { lat: echelonNodes.stabilizeAt.lat, lon: echelonNodes.stabilizeAt.lon }
    const defCoord  = { lat: echelonNodes.definitive.lat,  lon: echelonNodes.definitive.lon  }
    const transferSpeed = input.transferAssetSpeedKt || heloSpeed

    const leg2DistM     = inverse(stabCoord, defCoord).distM
    const isOp          = input.environment === 'operational'
    const showFixedWing = isOp && leg2DistM >= LEG2_FIXED_WING_DIST_M

    let leg2HeloS: number | null = null
    if (echelonNodes.stabilizeAt.hasHelipad && echelonNodes.definitive.hasHelipad) {
      leg2HeloS = heloTransitS(stabCoord, defCoord, transferSpeed)
    }
    const leg2FixedWingS = showFixedWing ? heloTransitS(stabCoord, defCoord, FIXED_WING_SPEED_KT) : null
    const initialEffective = Math.min(
      ...[leg2HeloS, leg2FixedWingS].filter((v): v is number => v !== null),
      Infinity,
    )

    echelonPlan = buildEchelonPlan({
      nodes:              echelonNodes,
      leg2Transit:        { groundDurationS: null, heloDurationS: leg2HeloS, fixedWingDurationS: leg2FixedWingS, effectiveDurationS: initialEffective },
      environment:        input.environment,
      organicAssetLabel,
      transferAssetLabel,
    })
  }

  // 12. Ground-route geometries for map + export
  progress('Fetching route geometries…')
  const routes: Record<string, RouteResult> = {}
  const top8Ids = new Set(rankResult.ranked.slice(0, 8).map(s => s.facility.id))
  const extraIds = new Set<string>()
  if (echelonNodes) {
    if (!top8Ids.has(echelonNodes.definitive.id))  extraIds.add(echelonNodes.definitive.id)
    if (!top8Ids.has(echelonNodes.stabilizeAt.id)) extraIds.add(echelonNodes.stabilizeAt.id)
  }
  if (chamberPace) {
    for (const entry of chamberPace.entries) {
      if (!top8Ids.has(entry.facility.id)) extraIds.add(entry.facility.id)
    }
  }
  const routeFetchTargets = rankResult.ranked.filter(s =>
    top8Ids.has(s.facility.id) || extraIds.has(s.facility.id)
  )
  await Promise.allSettled(routeFetchTargets.map(async fs => {
    try {
      const facDistM = inverse(target, { lat: fs.facility.lat, lon: fs.facility.lon }).distM
      if (facDistM > LEG2_DROP_GROUND_DIST_M && input.rotaryWingAvailable) return
      const { getGroundRoute } = await import('./med/routing/ors')
      const route = await getGroundRoute(target, { lat: fs.facility.lat, lon: fs.facility.lon })
      routes[fs.facility.id] = route
    } catch { /* keep estimate */ }
  }))

  // Leg-2 inter-facility ground route
  const leg2NeedsGround = echelonPlan?.legs[1].mode === 'ground'
  if (echelonNodes && leg2NeedsGround) {
    try {
      const { getGroundRoute } = await import('./med/routing/ors')
      const leg2Key = `leg2:${echelonNodes.stabilizeAt.id}->${echelonNodes.definitive.id}`
      const leg2Route = await getGroundRoute(
        { lat: echelonNodes.stabilizeAt.lat, lon: echelonNodes.stabilizeAt.lon },
        { lat: echelonNodes.definitive.lat,  lon: echelonNodes.definitive.lon  },
      )
      routes[leg2Key] = leg2Route
      if (leg2Route.durationS > 0 && echelonNodes) {
        const existingLeg2 = echelonPlan!.legs[1]
        const updatedLeg2Transit = {
          ...existingLeg2.transit,
          groundDurationS: leg2Route.durationS,
          effectiveDurationS: Math.min(
            ...[existingLeg2.transit.heloDurationS, existingLeg2.transit.fixedWingDurationS, leg2Route.durationS]
              .filter((v): v is number => v != null),
            Infinity,
          ),
        }
        echelonPlan = buildEchelonPlan({
          nodes: echelonNodes,
          leg2Transit: updatedLeg2Transit,
          environment: input.environment,
          organicAssetLabel,
          transferAssetLabel,
        })
      }
    } catch { /* non-fatal */ }
  }

  return {
    facilities: finalMerged,
    groundRoutes: routes,
    facilityPace,
    chamberPace,
    treatmentPace,
    echelonPlan,
    countryCode,
    targetLat: target.lat,
    targetLon: target.lon,
    ranked: rankResult.ranked,
  }
}
