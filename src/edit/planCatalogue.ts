/**
 * The floor-plan catalogue `plan.addObject` builds an Item Design from (#47).
 *
 * `edit` may import only `domain`, `geometry`, `cabinet`, `derive` and `lib` (#20 §2), so
 * it cannot read the legacy `src/data/floorPlanObjects.ts` list or the converter's
 * typical-height table. This is that data, restated: the same labels, sizes and colours
 * the sidebar offers today, and the same typical heights and base elevations #43's
 * converter gave a converted object. `src/edit/legacyParity.test.ts` holds both legacy
 * sources and fails if any row drifts, which is what keeps the copy honest until #53
 * retires the legacy side.
 *
 * `height` is the "typical — measure yours" height (`heightIsTypical: true`), and `base`
 * the elevation the item hangs at, both in millimetres.
 */
export interface PlanCatalogueEntry {
  label: string
  /** Footprint width in millimetres. */
  w: number
  /** Footprint depth in millimetres. */
  h: number
  height: number
  base: number
  /** `#rrggbb`, lowercase. */
  color: string
}

/** A user-drawn custom shape: 900 mm tall, standing on the Floor Datum. */
export const CUSTOM_PLAN_ENTRY: PlanCatalogueEntry = {
  label: 'Custom',
  w: 600,
  h: 400,
  height: 900,
  base: 0,
  color: '#f59e0b',
}

/** Every catalog key the sidebar offers, keyed as the `catalogKey` field stores it. */
export const PLAN_CATALOGUE: Record<string, PlanCatalogueEntry> = {
  'sofa-2': { label: 'Sofa 2-seater', w: 1500, h: 800, height: 850, base: 0, color: '#6366f1' },
  'sofa-3': { label: 'Sofa 3-seater', w: 2100, h: 800, height: 850, base: 0, color: '#6366f1' },
  armchair: { label: 'Armchair', w: 800, h: 800, height: 850, base: 0, color: '#6366f1' },
  'bed-single': { label: 'Single Bed', w: 900, h: 1900, height: 500, base: 0, color: '#8b5cf6' },
  'bed-double': { label: 'Double Bed', w: 1350, h: 1900, height: 500, base: 0, color: '#8b5cf6' },
  'bed-queen': { label: 'Queen Bed', w: 1520, h: 1980, height: 500, base: 0, color: '#8b5cf6' },
  'bed-king': { label: 'King Bed', w: 1820, h: 1980, height: 500, base: 0, color: '#8b5cf6' },
  fridge: { label: 'Fridge', w: 600, h: 650, height: 1800, base: 0, color: '#10b981' },
  washer: { label: 'Washing Machine', w: 600, h: 600, height: 850, base: 0, color: '#10b981' },
  dryer: { label: 'Dryer', w: 600, h: 600, height: 850, base: 0, color: '#10b981' },
  'water-heater': { label: 'Water Heater', w: 400, h: 400, height: 500, base: 1800, color: '#10b981' },
  'robot-vacuum': { label: 'Robot Vacuum', w: 350, h: 350, height: 100, base: 0, color: '#10b981' },
  toilet: { label: 'Toilet', w: 380, h: 680, height: 750, base: 0, color: '#0ea5e9' },
  basin: { label: 'Basin', w: 500, h: 400, height: 200, base: 650, color: '#0ea5e9' },
  bathtub: { label: 'Bathtub', w: 750, h: 1500, height: 550, base: 0, color: '#0ea5e9' },
  shower: { label: 'Shower', w: 900, h: 900, height: 2100, base: 0, color: '#0ea5e9' },
  'ceiling-fan': { label: 'Ceiling Fan', w: 1200, h: 1200, height: 300, base: 2300, color: '#f59e0b' },
  light: { label: 'Light', w: 200, h: 200, height: 150, base: 2450, color: '#f59e0b' },
  tv: { label: 'TV', w: 1200, h: 80, height: 700, base: 900, color: '#374151' },
  'curtain-rail': { label: 'Curtain Rail', w: 1800, h: 50, height: 100, base: 2400, color: '#374151' },
  wardrobe: { label: 'Wardrobe', w: 1800, h: 600, height: 2400, base: 0, color: '#92400e' },
  'kitchen-counter': { label: 'Kitchen Counter', w: 2400, h: 600, height: 900, base: 0, color: '#92400e' },
  'cabinet-unit': { label: 'Cabinet Unit', w: 600, h: 600, height: 900, base: 0, color: '#92400e' },
  custom: CUSTOM_PLAN_ENTRY,
}
