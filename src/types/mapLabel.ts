/**
 * MapLabel — descriptor for a map label drawn by composeMapCanvas / renderMedMapToCanvas.
 * Extracted from medplanner MapScreen so medcore is self-contained.
 */

export interface MapLabel {
  text: string
  lat: number
  lon: number
  color: string
  variant: 'icon' | 'label'
  /** Optional outer ring color for two-color combo labels (e.g. dive cyan on chamber primary). */
  ringColor?: string
}
