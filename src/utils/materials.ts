import type { MaterialId } from '../types'

export const MATERIALS: Record<MaterialId, { label: string; fill: string; stroke: string }> = {
  oak: { label: 'Oak', fill: '#C8A96E', stroke: '#8B6914' },
  walnut: { label: 'Walnut', fill: '#5C3D1E', stroke: '#3B2410' },
  white: { label: 'White', fill: '#F5F5F0', stroke: '#D0CEC8' },
  birch: { label: 'Birch', fill: '#E8D5A3', stroke: '#B09050' },
  mdf: { label: 'MDF', fill: '#D4C5A9', stroke: '#9E8E72' },
}
