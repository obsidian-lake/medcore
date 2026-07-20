/**
 * CustomFacility — a facility entered manually by the medic (SOST, FARP, etc.)
 * Extracted from medplanner/state.ts so medcore is self-contained.
 */

import type { CareTier, CapabilityFlag } from '../med/careLevel'

export interface CustomFacility {
  id: string
  name: string
  lat: number
  lon: number
  phone: string
  address: string
  beds: number
  hasHelipad: boolean
  tier: CareTier
  capabilities: CapabilityFlag[]
  notes: string
}
