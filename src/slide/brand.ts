import type { SlideThemeId } from './theme'

export interface BrandConfig {
  themeId:        SlideThemeId
  classification: { color: string; label: string }
  /** Base64 data URL for left header logo slot. */
  logoLeft?:  string
  /** Base64 data URL for right header logo slot. */
  logoRight?: string
}

export const DEFAULT_BRAND: BrandConfig = {
  themeId:        'mission-planning',
  classification: { color: '#4caf50', label: 'UNCLASSIFIED' },
}

/** Preset swatches shown in the customisation UI, each with a suggested label. */
export const CLASS_PRESET_COLORS: Array<{ name: string; color: string; defaultLabel: string }> = [
  { name: 'GREEN',  color: '#4caf50', defaultLabel: 'UNCLASSIFIED' },
  { name: 'RED',    color: '#ef5350', defaultLabel: 'SECRET'        },
  { name: 'YELLOW', color: '#d4a017', defaultLabel: 'CUI'           },
]
