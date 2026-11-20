/**
 * The Wall family (#64 §8–§11): a chained draw, the Junctions it names, the numeric edits,
 * split, merge and delete.
 *
 * Each test says which Wall keeps its ID and which gains one, because that is what the
 * homeowner's messages turn on: `W-4` has to still be `W-4` after its own split. And each one
 * reads the reference line, never a polygon — the tidied outline is `derive`'s, tested in
 * `derive/walls.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import type { Project, Wall, WallJunction, WallRefLine } from '../../domain'
import { distance, pt } from '../../geometry'
import { newWallDefaults } from '../defaults'
import type { WallDraft, WallEndTarget } from '../intents'
import { chainJunctionCount } from '../intents'
import {
  deepFreeze,
  expectApplied,
  expectDeterministic,
  expectRejection,
  expectRoundTrip,
  idSource,
  intent,
  newProject,
} from '../testing'

const line = (x1: number, y1: number, x2: number, y2: number): WallRefLine => ({
  kind: 'line',
  start: pt(x1, y1),
  end: pt(x2, y2),
})

const draft = (l: WallRefLine, thickness = 100): WallDraft => ({
  line: l,
  thickness,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

const free: WallEndTarget = { kind: 'free' }
const link = (index: number, end: 'start' | 'end'): WallEndTarget => ({ kind: 'segment', index, end })
const join = (wallId: string, end: 'start' | 'end'): WallEndTarget => ({ kind: 'wall', wallId, end })
const attach = (wallId: string): WallEndTarget => ({ kind: 'host', wallId })

const floorIdOf = (project: Project): string => project.floors[0]!.id

/** One ID source for the whole file, so no two draws hand out the same Wall ID. */
const source = idSource('wall')

/** One chained draw, with exactly the IDs it spends. */
function chain(
  project: Project,
  walls: readonly WallDraft[],
  starts: readonly WallEndTarget[],
  ends: readonly WallEndTarget[],
): { project: Project; ids: string[] } {
  const payload = { floorId: floorIdOf(project), walls, starts, ends }
  const ids = source(walls.length + chainJunctionCount(payload))
  const applied = expectApplied(project, intent('wall.createChain', payload, ids))
  return { project: applied.project, ids: ids.slice(0, walls.length) }
}

const wallsOf = (project: Project): Wall[] => project.existingModel.walls
const junctionsOf = (project: Project): WallJunction[] => project.existingModel.wallJunctions
const wallByRef = (project: Project, ref: string): Wall => {
  const found = wallsOf(project).find((wall) => wall.ref === ref)
  if (found === undefined) throw new Error(`no Wall called ${ref} in this test Project`)
  return found
}
const junctionFor = (project: Project, wallId: string, end: 'start' | 'end'): WallJunction | undefined =>
  junctionsOf(project).find((junction) => junction.ends.some((member) => member.wallId === wallId && member.end === end))

/** An L: `W-1` east, then `W-2` south, joined at their shared point. */
function withL(): { project: Project; first: string; second: string } {
  const project = newProject()
  const drawn = chain(project, [draft(line(0, 0, 3000, 0)), draft(line(3000, 0, 3000, 2000))], [free, link(0, 'end')], [link(1, 'start'), free])
  return { project: drawn.project, first: drawn.ids[0]!, second: drawn.ids[1]! }
}

/** `W-2` butts the middle of `W-1` at 1,200 mm, drawn from 900 mm above the host. */
function withT(): { project: Project; host: string; branch: string; junction: WallJunction } {
  const host = chain(newProject(), [draft(line(0, 0, 3000, 0))], [free], [free])
  const branch = chain(host.project, [draft(line(1200, 900, 1200, 2400))], [attach(host.ids[0]!)], [free])
  const project = branch.project
  const branchId = branch.ids[0]!
  const junction = junctionFor(project, branchId, 'start')
  if (junction === undefined) throw new Error('the T-attach made no junction')
  return { project, host: host.ids[0]!, branch: branchId, junction }
}

describe('the Wall defaults', () => {
  it('starts a Wall at 100 mm, centred, on the Floor Datum and one storey high', () => {
    const project = newProject()
    expect(newWallDefaults(project, project.floors[0]!)).toEqual({
      thickness: 100,
      justification: 'centre',
      baseElevation: 0,
      height: 2600,
    })
  })

  it('takes the height from the Floor when that Floor gives one', () => {
    const project = newProject()
    const floor = { ...project.floors[0]!, defaultWallHeight: 2400 }
    expect(newWallDefaults(project, floor).height).toBe(2400)
  })
})

describe('wall.createChain', () => {
  it('makes one Wall per segment, with the next references', () => {
    const project = newProject()
    const applied = expectRoundTrip(
      deepFreeze(project),
      intent(
        'wall.createChain',
        { floorId: floorIdOf(project), walls: [draft(line(0, 0, 4000, 0)), draft(line(0, 0, 0, 3000))], starts: [free, free], ends: [free, free] },
        source(2),
      ),
    )
    expect(wallsOf(applied.project).map((wall) => wall.ref)).toEqual(['W-1', 'W-2'])
    expect(junctionsOf(applied.project)).toEqual([])
    expect(applied.affected).toEqual({ floorId: floorIdOf(project), viewId: null, view: 'plan', itemDesignIds: [], placedItemIds: [] })
  })

  it('joins consecutive segments into one Junction of exactly two ends', () => {
    const { project, first, second } = withL()
    expect(junctionsOf(project)).toHaveLength(1)
    const junction = junctionsOf(project)[0]!
    expect(junction.host).toBeUndefined()
    expect(junction.ends).toEqual([
      { wallId: first, end: 'end' },
      { wallId: second, end: 'start' },
    ])
  })

  it('closes a chain back onto its first point, joining the last Wall to the first', () => {
    const project = newProject()
    const drawn = chain(
      project,
      [draft(line(0, 0, 3000, 0)), draft(line(3000, 0, 3000, 3000)), draft(line(3000, 3000, 0, 0))],
      [link(2, 'end'), link(0, 'end'), link(1, 'end')],
      [link(1, 'start'), link(2, 'start'), link(0, 'start')],
    )
    expect(junctionsOf(drawn.project)).toHaveLength(3)
    const closed = junctionFor(drawn.project, drawn.ids[2]!, 'end')!
    expect(closed.ends).toEqual([
      { wallId: drawn.ids[0], end: 'start' },
      { wallId: drawn.ids[2], end: 'end' },
    ])
  })

  it('creates no Junction for an end that names no target, however near another Wall it ends', () => {
    // 30 mm short of the first Wall's start, with nothing snapped: still a free end (#64 §20
    // criterion 4). Proximity alone never joins; only an explicit target does.
    const drawn = chain(newProject(), [draft(line(0, 0, 3000, 0)), draft(line(3030, 0, 3030, 2000))], [free, free], [free, free])
    expect(junctionsOf(drawn.project)).toEqual([])
    expect(distance(wallByRef(drawn.project, 'W-1').line.end, wallByRef(drawn.project, 'W-2').line.start)).toBeCloseTo(30, 6)
  })

  it('crosses a Wall mid-span without joining it or splitting it', () => {
    const started = chain(newProject(), [draft(line(0, 0, 3000, 0))], [free], [free])
    const host = started.ids[0]!
    const hostLine = wallByRef(started.project, 'W-1').line
    const drawn = chain(started.project, [draft(line(1500, -900, 1500, 900))], [free], [free])
    expect(junctionsOf(drawn.project)).toEqual([])
    expect(wallsOf(drawn.project)).toHaveLength(2)
    expect(wallByRef(drawn.project, 'W-1').line).toEqual(hostLine)
    expect(wallByRef(drawn.project, 'W-1').id).toBe(host)
  })

  it('stores a T-attach on the host line and leaves the host exactly as it was', () => {
    const { project, host, branch, junction } = withT()
    expect(junction.host).toEqual({ wallId: host, at: 1200 })
    expect(junction.ends).toEqual([{ wallId: branch, end: 'start' }])
    // The end is stored where it meets the host, not where it was drawn.
    expect(wallByRef(project, 'W-2').line.start).toEqual(pt(1200, 0))
    expect(wallsOf(project)).toHaveLength(2)
  })

  it('leaves the host Wall untouched by a T-attach', () => {
    const project = newProject()
    const host = chain(project, [draft(line(0, 0, 3000, 0))], [free], [free]).project
    const before = wallByRef(host, 'W-1')
    const drawn = chain(host, [draft(line(1200, 900, 1200, 2400))], [attach(before.id)], [free])
    expect(wallByRef(drawn.project, 'W-1')).toEqual(before)
    expect(wallsOf(drawn.project)).toHaveLength(2)
  })

  it('adds a branch to the Junction an already-joined end belongs to', () => {
    const { project, first, second } = withL()
    const drawn = chain(project, [draft(line(3000, 0, 5000, -1200))], [join(first, 'end')], [free])
    expect(junctionsOf(drawn.project)).toHaveLength(1)
    expect(junctionsOf(drawn.project)[0]!.ends).toHaveLength(3)
    expect(junctionFor(drawn.project, second, 'start')).toBeDefined()
  })

  it('refuses a T-attach that falls outside the host', () => {
    const { project, host } = withT()
    expectRejection(
      project,
      intent('wall.createChain', { floorId: floorIdOf(project), walls: [draft(line(3600, 900, 3600, 2400))], starts: [attach(host)], ends: [free] }, source(2)),
      'invalid-wall',
    )
  })

  it('refuses a chain link that its other end does not name back', () => {
    const project = newProject()
    expectRejection(
      project,
      intent(
        'wall.createChain',
        { floorId: floorIdOf(project), walls: [draft(line(0, 0, 1000, 0)), draft(line(1000, 0, 1000, 1000))], starts: [free, link(0, 'end')], ends: [free, free] },
        source(3),
      ),
      'invalid-wall',
    )
  })

  it('is one reproducible transaction', () => {
    const project = newProject()
    const payload = {
      floorId: floorIdOf(project),
      walls: [draft(line(0, 0, 3000, 0)), draft(line(3000, 0, 3000, 2000))],
      starts: [free, link(0, 'end')] as const,
      ends: [link(1, 'start'), free] as const,
    }
    expectDeterministic(project, intent('wall.createChain', payload, source(3)))
  })

  it('refuses a chain whose ends and targets do not line up', () => {
    const project = newProject()
    expectRejection(
      project,
      intent('wall.createChain', { floorId: floorIdOf(project), walls: [draft(line(0, 0, 1000, 0))], starts: [free], ends: [] }, source(1)),
      'invalid-wall',
    )
  })
})
