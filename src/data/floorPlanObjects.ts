import type { FloorPlanObjectType } from '../types'

export const OBJECT_CATALOG = [
  // Seating
  { type: 'sofa-2' as FloorPlanObjectType,          label: 'Sofa 2-seater',   defaultW: 1500, defaultH: 800,  color: '#6366f1' },
  { type: 'sofa-3' as FloorPlanObjectType,          label: 'Sofa 3-seater',   defaultW: 2100, defaultH: 800,  color: '#6366f1' },
  { type: 'armchair' as FloorPlanObjectType,        label: 'Armchair',        defaultW: 800,  defaultH: 800,  color: '#6366f1' },
  // Sleeping
  { type: 'bed-single' as FloorPlanObjectType,      label: 'Single Bed',      defaultW: 900,  defaultH: 1900, color: '#8b5cf6' },
  { type: 'bed-double' as FloorPlanObjectType,      label: 'Double Bed',      defaultW: 1350, defaultH: 1900, color: '#8b5cf6' },
  { type: 'bed-queen' as FloorPlanObjectType,       label: 'Queen Bed',       defaultW: 1520, defaultH: 1980, color: '#8b5cf6' },
  { type: 'bed-king' as FloorPlanObjectType,        label: 'King Bed',        defaultW: 1820, defaultH: 1980, color: '#8b5cf6' },
  // Appliances
  { type: 'fridge' as FloorPlanObjectType,          label: 'Fridge',          defaultW: 600,  defaultH: 650,  color: '#10b981' },
  { type: 'washer' as FloorPlanObjectType,          label: 'Washing Machine', defaultW: 600,  defaultH: 600,  color: '#10b981' },
  { type: 'dryer' as FloorPlanObjectType,           label: 'Dryer',           defaultW: 600,  defaultH: 600,  color: '#10b981' },
  { type: 'water-heater' as FloorPlanObjectType,    label: 'Water Heater',    defaultW: 400,  defaultH: 400,  color: '#10b981' },
  { type: 'robot-vacuum' as FloorPlanObjectType,    label: 'Robot Vacuum',    defaultW: 350,  defaultH: 350,  color: '#10b981' },
  // Bathroom
  { type: 'toilet' as FloorPlanObjectType,          label: 'Toilet',          defaultW: 380,  defaultH: 680,  color: '#0ea5e9' },
  { type: 'basin' as FloorPlanObjectType,           label: 'Basin',           defaultW: 500,  defaultH: 400,  color: '#0ea5e9' },
  { type: 'bathtub' as FloorPlanObjectType,         label: 'Bathtub',         defaultW: 750,  defaultH: 1500, color: '#0ea5e9' },
  { type: 'shower' as FloorPlanObjectType,          label: 'Shower',          defaultW: 900,  defaultH: 900,  color: '#0ea5e9' },
  // Lighting & other
  { type: 'ceiling-fan' as FloorPlanObjectType,     label: 'Ceiling Fan',     defaultW: 1200, defaultH: 1200, color: '#f59e0b' },
  { type: 'light' as FloorPlanObjectType,           label: 'Light',           defaultW: 200,  defaultH: 200,  color: '#f59e0b' },
  { type: 'tv' as FloorPlanObjectType,              label: 'TV',              defaultW: 1200, defaultH: 80,   color: '#374151' },
  { type: 'curtain-rail' as FloorPlanObjectType,    label: 'Curtain Rail',    defaultW: 1800, defaultH: 50,   color: '#374151' },
  // Carpentry
  { type: 'wardrobe' as FloorPlanObjectType,        label: 'Wardrobe',        defaultW: 1800, defaultH: 600,  color: '#92400e' },
  { type: 'kitchen-counter' as FloorPlanObjectType, label: 'Kitchen Counter', defaultW: 2400, defaultH: 600,  color: '#92400e' },
  { type: 'cabinet-unit' as FloorPlanObjectType,    label: 'Cabinet Unit',    defaultW: 600,  defaultH: 600,  color: '#92400e' },
] as const satisfies ReadonlyArray<{ type: FloorPlanObjectType; label: string; defaultW: number; defaultH: number; color: string }>

export const OBJECT_CATEGORIES = {
  'Seating':          ['sofa-2', 'sofa-3', 'armchair'],
  'Sleeping':         ['bed-single', 'bed-double', 'bed-queen', 'bed-king'],
  'Appliances':       ['fridge', 'washer', 'dryer', 'water-heater', 'robot-vacuum'],
  'Bathroom':         ['toilet', 'basin', 'bathtub', 'shower'],
  'Lighting & Other': ['ceiling-fan', 'light', 'tv', 'curtain-rail'],
  'Carpentry':        ['wardrobe', 'kitchen-counter', 'cabinet-unit'],
} as const satisfies Record<string, FloorPlanObjectType[]>
