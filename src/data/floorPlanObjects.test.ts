import { describe, expect, it } from 'vitest'
import { OBJECT_CATALOG, OBJECT_CATEGORIES } from './floorPlanObjects'

describe('OBJECT_CATALOG', () => {
  it('every item has positive defaultW and defaultH', () => {
    OBJECT_CATALOG.forEach(o => {
      expect(o.defaultW).toBeGreaterThan(0)
      expect(o.defaultH).toBeGreaterThan(0)
    })
  })

  it('OBJECT_CATEGORIES covers all catalog items', () => {
    const allCategoryTypes = Object.values(OBJECT_CATEGORIES).flat()
    OBJECT_CATALOG.forEach(o => {
      expect(allCategoryTypes).toContain(o.type)
    })
  })
})
