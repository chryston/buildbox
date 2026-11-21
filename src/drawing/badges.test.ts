/**
 * The warning badges as geometry (#66 §14, criterion 7).
 *
 * Four things are asserted here and none of them is the colour. One badge per entity however
 * many warnings name it; a badge that fits is placed where it covers nothing, in an order that
 * does not depend on the order the warnings arrived; a badge that cannot fit is still drawn,
 * further out and joined by a leader, because a dropped badge is an invisible warning; and the
 * export's own lists never contain one, which is the criterion the whole design rests on.
 */
import { describe, expect, it } from 'vitest'
import { deriveWalls, effectiveFloor } from '../derive'
import { domainFixture } from '../derive/testing'
import type { Project, Wall } from '../domain'
import type { Pt } from '../geometry'
import { badgeRadius, displayRects, drawWarningBadges } from './badges'
import { drawPlanView } from './planView'
import type { DisplayList, Rect } from './types'
import { drawWalls } from './walls'

const sizing = { kind: 'screen', pxPerMm: 1 } as const

const wall = (id: string, ref: string, thickness: number, start: Pt, end: Pt): Wall => ({
  id,
  ref,
  floorId: 'floor-main',
  line: { kind: 'line', start, end },
  thickness,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

/** The box a Wall takes, the same box the Warning strip locates with. */
const wallBox = (one: Wall): Rect => {
  const half = one.thickness / 2
  const x = Math.min(one.line.start.x, one.line.end.x) - half
  const y = Math.min(one.line.start.y, one.line.end.y) - half
  return { x, y, w: Math.abs(one.line.end.x - one.line.start.x) + one.thickness, h: Math.abs(one.line.end.y - one.line.start.y) + one.thickness }
}

const projectWith = (walls: readonly Wall[]): Project => {
  const base = domainFixture('v4/project-basic.json')
  return { ...base, existingModel: { ...base.existingModel, walls: [...walls], wallJunctions: [] } }
}

/** The badge boxes out of a badge list, so the assertions read the geometry and not the DOM. */
function badgeRects(list: DisplayList | null): Rect[] {
  if (list === null) return []
  const r = badgeRadius(sizing)
  return list.layers
    .flatMap((layer) => layer.items)
    .map((item) => (item.kind === 'group' ? item.transform : undefined))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map((t) => ({ x: t.e - r, y: t.f - r, w: 2 * r, h: 2 * r }))
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Two Walls crossing at 90° with 100 mm, the range prototype's W-2 and W-5. */
const crossing = (): Project =>
  projectWith([
    wall('w1', 'W-1', 100, { x: 0, y: 0 }, { x: 4000, y: 0 }),
    wall('w2', 'W-2', 100, { x: 2000, y: -1500 }, { x: 2000, y: 1500 }),
  ])

describe('the badge list', () => {
  it('is nothing when there is nothing open', () => {
    expect(drawWarningBadges([], { sizing })).toBeNull()
  })

  it('draws one badge per entity, whatever the number of warnings naming it', () => {
    const bounds = { x: 0, y: -50, w: 4000, h: 100 }
    const list = drawWarningBadges(
      [
        { id: 'w1', bounds },
        { id: 'w1', bounds },
        { id: 'w2', bounds: { x: 1950, y: -1500, w: 100, h: 3000 } },
      ],
      { sizing },
    )
    expect(badgeRects(list)).toHaveLength(2)
    const ids = list!.layers.flatMap((layer) => layer.items).map((item) => item.kind === 'group' ? item.ref?.id : undefined)
    expect(ids).toEqual(['w1', 'w2'])
  })

  it('is stable: the same Floor gets the same picture whatever order the warnings arrived in', () => {
    const a = { id: 'w1', bounds: { x: 0, y: -50, w: 4000, h: 100 } }
    const b = { id: 'w2', bounds: { x: 1950, y: -1500, w: 100, h: 3000 } }
    const first = drawWarningBadges([a, b], { sizing })
    const second = drawWarningBadges([b, a], { sizing })
    // The second entity may take a different seat because the first sat down first — that is
    // the rule about other badges — but each entity's own badge is where its bounds put it.
    const centreOf = (list: DisplayList | null, id: string): string => {
      const item = list?.layers[0]!.items.find((one) => one.kind === 'group' && one.ref?.id === id)
      return item?.kind === 'group' ? `${item.transform?.e},${item.transform?.f}` : 'missing'
    }
    expect(centreOf(first, 'w1')).toBe(centreOf(second, 'w1'))
  })

  it('covers no label box, no handle box and no other badge on the crossing fixture', () => {
    const project = crossing()
    const drawn = drawPlanView(effectiveFloor(project, 0, 'floor-main', null), { showPlanImage: false }, { sizing })
    const withWalls = drawWalls(deriveWalls(project, 'floor-main'), { sizing })
    // Everything the canvas would have drawn under a badge: both lists' labels, dimensions,
    // chips and handles.
    const obstacles = [...displayRects(drawn), ...displayRects(withWalls)]
    expect(obstacles.length).toBeGreaterThan(0)
    const boxes = badgeRects(
      drawWarningBadges(project.existingModel.walls.map((one) => ({ id: one.id, bounds: wallBox(one) })), { sizing, obstacles }),
    )
    expect(boxes).toHaveLength(project.existingModel.walls.length)
    for (const box of boxes) {
      for (const obstacle of obstacles) {
        expect(overlaps(box, obstacle), `badge ${JSON.stringify(box)} covers ${JSON.stringify(obstacle)}`).toBe(false)
      }
    }
  })

  it('offsets outward with a leader when nothing fits', () => {
    const bounds = { x: 1000, y: 1000, w: 200, h: 200 }
    // A ring of obstacles thick enough to cover all eight seats.
    const obstacles: Rect[] = []
    for (let x = 900; x <= 1300; x += 50) {
      for (let y = 900; y <= 1300; y += 50) obstacles.push({ x, y, w: 50, h: 50 })
    }
    const list = drawWarningBadges([{ id: 'w1', bounds }], { sizing, obstacles })
    expect(list).not.toBeNull()
    const items = list!.layers[0]!.items
    const group = items[0]!
    expect(group.kind).toBe('group')
    const leader = group.kind === 'group'
      ? group.items.find((one) => one.kind === 'path' && one.style === 'plan-warning-badge-leader')
      : undefined
    expect(leader).toBeDefined()
    // Further out than any of the eight seats, and still one badge.
    expect(badgeRects(list)).toHaveLength(1)
    const box = badgeRects(list)[0]!
    expect(box.x + box.w).toBeLessThan(bounds.x)
  })
})

describe('the export never carries a badge', () => {
  it('leaves the badge band out of the Plan View and Wall lists', () => {
    const project = crossing()
    const lists = [
      drawPlanView(effectiveFloor(project, 0, 'floor-main', null), { showPlanImage: false }, { sizing }),
      drawWalls(deriveWalls(project, 'floor-main'), { sizing }),
    ]
    for (const list of lists) {
      expect(list.layers.map((layer) => layer.key)).not.toContain('plan-warning-badges')
      const roles = list.layers
        .flatMap((layer) => layer.items)
        .map((item) => item.kind === 'group' ? item.ref?.role : item.kind === 'text' ? item.role : undefined)
      expect(roles).not.toContain('warning-badge')
    }
  })
})
