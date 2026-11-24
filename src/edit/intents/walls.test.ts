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
import { arcFromThrough, distance, pt, refLength, refTangentDeg } from '../../geometry'
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

/** The arc through a third point, bulged `bulge` mm to the left of its own direction. */
const arc = (x1: number, y1: number, x2: number, y2: number, bulge: number): WallRefLine => {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy) || 1
  return {
    kind: 'arc',
    start: pt(x1, y1),
    end: pt(x2, y2),
    through: pt((x1 + x2) / 2 - (dy / length) * bulge, (y1 + y2) / 2 + (dx / length) * bulge),
  }
}

/** One Wall on its own, straight from (0,0) to (3000,0) unless a line is given. */
function withWall(l: WallRefLine = line(0, 0, 3000, 0)): { project: Project; wall: string } {
  const drawn = chain(newProject(), [draft(l)], [free], [free])
  return { project: drawn.project, wall: drawn.ids[0]! }
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }): number => distance(a, b)

describe('wall.dragJunction', () => {
  it('moves every member of an L together', () => {
    const { project, first, second } = withL()
    const junction = junctionsOf(project)[0]!
    const applied = expectRoundTrip(project, intent('wall.dragJunction', { junctionId: junction.id, delta: pt(100, -50) }, []))
    const moved = wallsOf(applied.project)
    expect(moved.find((wall) => wall.id === first)!.line).toEqual(line(0, 0, 3100, -50))
    expect(moved.find((wall) => wall.id === second)!.line).toEqual(line(3100, -50, 3000, 2000))
  })

  it('slides a hosted Junction along its host and takes the branch with it', () => {
    const { project, host, branch, junction } = withT()
    const applied = expectApplied(project, intent('wall.dragJunction', { junctionId: junction.id, delta: pt(600, 300) }, []))
    expect(junctionsOf(applied.project)[0]!.host).toEqual({ wallId: host, at: 1800 })
    expect(wallsOf(applied.project).find((wall) => wall.id === branch)!.line).toEqual(line(1800, 0, 1200, 2400))
  })

  it('keeps a hosted Junction on its host when dragged off it', () => {
    const { project, host, junction } = withT()
    const applied = expectApplied(project, intent('wall.dragJunction', { junctionId: junction.id, delta: pt(2400, 900) }, []))
    const moved = junctionsOf(applied.project)[0]!.host!
    expect(moved.wallId).toBe(host)
    expect(moved.at).toBeLessThan(3000)
    expect(moved.at).toBeGreaterThan(2999)
    // The branch end is back on the host's reference line.
    const branchEnd = wallsOf(applied.project).find((wall) => wall.id !== host)!.line.start
    expect(near(branchEnd, pt(moved.at, 0))).toBeLessThan(0.01)
  })

  it('is one transaction', () => {
    const { project } = withL()
    expectDeterministic(project, intent('wall.dragJunction', { junctionId: junctionsOf(project)[0]!.id, delta: pt(10, 10) }, []))
  })
})

describe('wall.dragEndpoint', () => {
  it('moves a free end and leaves the joined one where it was', () => {
    const { project, branch } = withT()
    const applied = expectApplied(project, intent('wall.dragEndpoint', { wallId: branch, end: 'end', to: pt(1200, 3000) }, []))
    expect(wallsOf(applied.project).find((wall) => wall.id === branch)!.line).toEqual(line(1200, 0, 1200, 3000))
  })

  it('refuses to drag an end that joins another Wall', () => {
    const { project, first } = withL()
    const rejection = expectRejection(project, intent('wall.dragEndpoint', { wallId: first, end: 'end', to: pt(4000, 0) }, []), 'invalid-wall')
    expect(rejection.problems[0]!.message).toContain('move that junction instead')
  })
})

describe('wall.dragBody', () => {
  it('moves the Wall, carries its Junction along and stretches the other member', () => {
    const { project, first, second } = withL()
    const applied = expectRoundTrip(project, intent('wall.dragBody', { wallId: second, delta: pt(0, 500) }, []))
    const walls = wallsOf(applied.project)
    expect(walls.find((wall) => wall.id === second)!.line).toEqual(line(3000, 500, 3000, 2500))
    expect(walls.find((wall) => wall.id === first)!.line).toEqual(line(0, 0, 3000, 500))
  })

  it('keeps a hosted end on its host while the rest of the Wall moves', () => {
    const { project, host, branch, junction } = withT()
    const applied = expectApplied(project, intent('wall.dragBody', { wallId: branch, delta: pt(300, 0) }, []))
    expect(junctionsOf(applied.project)[0]!.host).toEqual({ wallId: host, at: 1500 })
    expect(wallsOf(applied.project).find((wall) => wall.id === branch)!.line).toEqual(line(1500, 0, 1500, 2400))
    expect(junction.ends).toHaveLength(1)
  })

  it('re-measures a Junction hosted on the neighbour that stretched to stay joined', () => {
    // `W-1` hosts `W-3` at 1 200 mm and `W-2` butts `W-1`'s start. Dragging `W-2` moves `W-1`'s
    // start, so the distance that describes `W-3` along `W-1` is no longer the one it was (#64 §10):
    // `W-3` stands still and its measurement follows the Wall it stands on.
    const started = chain(newProject(), [draft(line(0, 0, 3000, 0))], [free], [free])
    const first = started.ids[0]!
    const butted = chain(started.project, [draft(line(-2000, 0, 0, 0))], [free], [join(first, 'start')])
    const hosted = chain(butted.project, [draft(line(1200, 900, 1200, 2400))], [attach(first)], [free])
    const second = butted.ids[0]!

    const applied = expectRoundTrip(hosted.project, intent('wall.dragBody', { wallId: second, delta: pt(20, 0) }, []))
    const walls = wallsOf(applied.project)
    expect(walls.find((wall) => wall.id === first)!.line).toEqual(line(20, 0, 3000, 0))
    expect(walls.find((wall) => wall.id === second)!.line).toEqual(line(-1980, 0, 20, 0))
    expect(walls.find((wall) => wall.id === hosted.ids[0]!)!.line).toEqual(line(1200, 0, 1200, 2400))
    expect(junctionsOf(applied.project).find((entry) => entry.host !== undefined)!.host).toEqual({ wallId: first, at: 1180 })
  })
})

describe('the numeric edits', () => {
  it('runs a Wall to a new length with its start held', () => {
    const { project, wall } = withWall()
    const applied = expectApplied(project, intent('wall.setLength', { wallId: wall, length: 1500, keepFixed: 'start' }, []))
    expect(wallsOf(applied.project)[0]!.line).toEqual(line(0, 0, 1500, 0))
  })

  it('runs a Wall to a new length with its end held', () => {
    const { project, wall } = withWall()
    const applied = expectApplied(project, intent('wall.setLength', { wallId: wall, length: 1500, keepFixed: 'end' }, []))
    expect(wallsOf(applied.project)[0]!.line).toEqual(line(1500, 0, 3000, 0))
  })

  it('rejects a typed length of 0 whole', () => {
    const { project, wall } = withWall()
    expectRejection(project, intent('wall.setLength', { wallId: wall, length: 0, keepFixed: 'start' }, []), 'invalid-wall')
  })

  it('runs a curved Wall to a new length along its own curve', () => {
    const { project, wall } = withWall(arc(0, 0, 2000, 0, 500))
    const before = wallsOf(project)[0]!.line
    const applied = expectApplied(project, intent('wall.setLength', { wallId: wall, length: 1000, keepFixed: 'start' }, []))
    const after = wallsOf(applied.project)[0]!.line
    expect(after.kind).toBe('arc')
    expect(refLength(after)).toBeCloseTo(1000, 4)
    if (after.kind !== 'arc') return
    expect(after.start).toEqual(before.start)
  })

  it('turns a Wall to a new direction about its start', () => {
    const { project, wall } = withWall()
    const applied = expectApplied(project, intent('wall.setDirection', { wallId: wall, directionDeg: 45 }, []))
    const after = wallsOf(applied.project)[0]!.line
    expect(refTangentDeg(after, 'start')).toBeCloseTo(45, 9)
    expect(refLength(after)).toBeCloseTo(3000, 6)
  })

  it('refuses to give a radius to a straight Wall', () => {
    const { project, wall } = withWall()
    expectRejection(project, intent('wall.setArc', { wallId: wall, radius: 2500 }, []), 'invalid-wall')
  })

  it('refuses a curve edit that changes nothing', () => {
    const { project, wall } = withWall(arc(0, 0, 2000, 0, 500))
    expectRejection(project, intent('wall.setArc', { wallId: wall }, []), 'invalid-wall')
  })

  it('opens a curved Wall to a new radius about its own centre', () => {
    const { project, wall } = withWall(arc(0, 0, 2000, 0, 500))
    const applied = expectApplied(project, intent('wall.setArc', { wallId: wall, radius: 2500 }, []))
    const after = wallsOf(applied.project)[0]!.line
    if (after.kind !== 'arc') throw new Error('a curved Wall stopped being a curve')
    const circle = arcFromThrough(after.start, after.through, after.end)!
    expect(circle.radius).toBeCloseTo(2500, 6)
  })

  it('swings a curved Wall to a new sweep from the same start', () => {
    const { project, wall } = withWall(arc(0, 0, 2000, 0, 500))
    const before = wallsOf(project)[0]!.line
    const applied = expectApplied(project, intent('wall.setArc', { wallId: wall, sweepDeg: 60 }, []))
    const after = wallsOf(applied.project)[0]!.line
    if (after.kind !== 'arc') throw new Error('a curved Wall stopped being a curve')
    const circle = arcFromThrough(after.start, after.through, after.end)!
    expect(Math.abs(circle.t1 - circle.t0)).toBeCloseTo((60 * Math.PI) / 180, 6)
    expect(after.start).toEqual(before.start)
  })

  it('restates the thickness, and refuses one of 0', () => {
    const { project, wall } = withWall()
    expect(wallsOf(expectApplied(project, intent('wall.setThickness', { wallId: wall, thickness: 150 }, [])).project)[0]!.thickness).toBe(150)
    expectRejection(project, intent('wall.setThickness', { wallId: wall, thickness: 0 }, []), 'invalid-wall')
  })

  it('moves the reference line to the chosen side', () => {
    const { project, wall } = withWall()
    const left = wallsOf(expectApplied(project, intent('wall.offset', { wallId: wall, distance: 200, side: 'left' }, [])).project)[0]!.line
    const right = wallsOf(expectApplied(project, intent('wall.offset', { wallId: wall, distance: 200, side: 'right' }, [])).project)[0]!.line
    expect(left).toEqual(line(0, 200, 3000, 200))
    expect(right).toEqual(line(0, -200, 3000, -200))
  })
  it('offsets a curved Wall concentrically, and refuses to turn it inside out', () => {
    const { project, wall } = withWall(arc(0, 0, 2000, 0, 500))
    const before = wallsOf(project)[0]!.line
    if (before.kind !== 'arc') throw new Error('a curved Wall stopped being a curve')
    const original = arcFromThrough(before.start, before.through, before.end)!
    const applied = expectApplied(project, intent('wall.offset', { wallId: wall, distance: 100, side: 'left' }, []))
    const after = wallsOf(applied.project)[0]!.line
    if (after.kind !== 'arc') throw new Error('a curved Wall stopped being a curve')
    const circle = arcFromThrough(after.start, after.through, after.end)!
    expect(Math.abs(circle.radius - original.radius)).toBeCloseTo(100, 6)
    expectRejection(project, intent('wall.offset', { wallId: wall, distance: 5000, side: 'right' }, []), 'invalid-wall')
  })
})

/** One split, with exactly the two IDs it spends. */
function splitAt(project: Project, wallId: string, at: number): { project: Project; newId: string; seam: string } {
  const [newId, seam, skirtingId] = source(3)
  const applied = expectApplied(project, intent('wall.split', { wallId, at }, [newId, seam, skirtingId]))
  return { project: applied.project, newId, seam }
}

describe('wall.split', () => {
  it('keeps the ID and the reference for the start piece and gives the next one to the rest', () => {
    const { project, wall } = withWall()
    const applied = expectRoundTrip(project, intent('wall.split', { wallId: wall, at: 1000 }, source(3)))
    const kept = wallByRef(applied.project, 'W-1')
    const added = wallByRef(applied.project, 'W-2')
    expect(kept.id).toBe(wall)
    expect(kept.line).toEqual(line(0, 0, 1000, 0))
    expect(added.line).toEqual(line(1000, 0, 3000, 0))
    expect(added).toMatchObject({ thickness: 100, justification: 'centre', baseElevation: 0, height: 2600 })
    expect(junctionsOf(applied.project)).toHaveLength(1)
    const seam = junctionsOf(applied.project)[0]!
    expect(seam.ends).toEqual([
      { wallId: wall, end: 'end' },
      { wallId: added.id, end: 'start' },
    ])
  })

  it('leaves an attachment on the piece it lies on', () => {
    const { project, host, junction } = withT()
    const split = splitAt(project, host, 2000)
    expect(junctionsOf(split.project).find((candidate) => candidate.id === junction.id)!.host).toEqual({ wallId: host, at: 1200 })
  })

  it('moves an attachment to the new piece when the split falls before it', () => {
    const { project, host, junction } = withT()
    const split = splitAt(project, host, 600)
    expect(junctionsOf(split.project).find((candidate) => candidate.id === junction.id)!.host).toEqual({ wallId: split.newId, at: 600 })
    expect(wallsOf(split.project).find((candidate) => candidate.id === split.newId)!.line).toEqual(line(600, 0, 3000, 0))
  })

  it('moves the far end of the Wall onto the new piece', () => {
    const { project, first, second } = withL()
    const split = splitAt(project, first, 1000)
    const corner = junctionFor(split.project, second, 'start')!
    expect(corner.ends).toEqual([
      { wallId: split.newId, end: 'end' },
      { wallId: second, end: 'start' },
    ])
    expect(junctionFor(split.project, first, 'end')!.id).toBe(split.seam)
  })

  it('cuts a curved Wall into two curved Walls that still add up', () => {
    const { project, wall } = withWall(arc(0, 0, 2000, 0, 500))
    const before = refLength(wallsOf(project)[0]!.line)
    const split = splitAt(project, wall, 400)
    const pieces = wallsOf(split.project)
    expect(pieces.every((piece) => piece.line.kind === 'arc')).toBe(true)
    expect(refLength(pieces[0]!.line) + refLength(pieces[1]!.line)).toBeCloseTo(before, 4)
  })

  it('blocks a split exactly where another Wall attaches', () => {
    const { project, host } = withT()
    const rejection = expectRejection(project, intent('wall.split', { wallId: host, at: 1200 }, source(3)), 'split-blocked')
    expect(rejection.problems[0]!.message).toContain('Move the attachment first')
  })

  it('refuses a split at an end', () => {
    const { project, wall } = withWall()
    expectRejection(project, intent('wall.split', { wallId: wall, at: 3000 }, source(3)), 'invalid-wall')
  })
})

describe('wall.merge', () => {
  it('puts a split Wall back together under its original ID', () => {
    const { project, wall } = withWall()
    const original = wallsOf(project)[0]!.line
    const split = splitAt(project, wall, 1000)
    const merged = expectRoundTrip(split.project, intent('wall.merge', { wallIds: [wall, split.newId] }, []))
    expect(wallsOf(merged.project)).toHaveLength(1)
    expect(wallsOf(merged.project)[0]!.id).toBe(wall)
    expect(wallsOf(merged.project)[0]!.ref).toBe('W-1')
    expect(near(wallsOf(merged.project)[0]!.line.start, original.start)).toBeLessThan(0.01)
    expect(near(wallsOf(merged.project)[0]!.line.end, original.end)).toBeLessThan(0.01)
    expect(junctionsOf(merged.project)).toEqual([])
  })

  it('keeps the corner and the attachment when the pieces go back together', () => {
    const { project, host } = withT()
    const split = splitAt(project, host, 600)
    const merged = expectApplied(split.project, intent('wall.merge', { wallIds: [host, split.newId] }, []))
    expect(wallsOf(merged.project)).toHaveLength(2)
    expect(junctionsOf(merged.project)).toHaveLength(1)
    expect(junctionsOf(merged.project)[0]!.host).toEqual({ wallId: host, at: 1200 })
  })

  it('blocks two Walls of different thicknesses with the plain message', () => {
    const drawn = chain(
      newProject(),
      [draft(line(0, 0, 1500, 0), 100), draft(line(1500, 0, 3000, 0), 150)],
      [free, link(0, 'end')],
      [link(1, 'start'), free],
    )
    const rejection = expectRejection(
      drawn.project,
      intent('wall.merge', { wallIds: [drawn.ids[0]!, drawn.ids[1]!] }, []),
      'merge-mismatch',
    )
    expect(rejection.problems[0]!.message).toBe('These walls have different thicknesses (100 mm and 150 mm).')
  })

  it('blocks two Walls that do not meet at a junction of their own', () => {
    const drawn = chain(newProject(), [draft(line(0, 0, 1500, 0)), draft(line(2000, 0, 3000, 0))], [free, free], [free, free])
    const rejection = expectRejection(drawn.project, intent('wall.merge', { wallIds: [drawn.ids[0]!, drawn.ids[1]!] }, []), 'merge-mismatch')
    expect(rejection.problems[0]!.message).toContain('do not meet at a junction of their own')
  })

  it('blocks two Walls that are not one straight run', () => {
    const { project, first, second } = withL()
    const rejection = expectRejection(project, intent('wall.merge', { wallIds: [first, second] }, []), 'merge-mismatch')
    expect(rejection.problems[0]!.message).toBe('These walls are not one straight run.')
  })
})

describe('wall.delete', () => {
  it('removes the attachments to a host and leaves the branch standing free', () => {
    const { project, host, branch } = withT()
    const applied = expectRoundTrip(project, intent('wall.delete', { wallId: host }, []))
    expect(wallsOf(applied.project).map((wall) => wall.id)).toEqual([branch])
    expect(junctionsOf(applied.project)).toEqual([])
    expect(wallsOf(applied.project)[0]!.line).toEqual(wallByRef(project, 'W-2').line)
  })

  it('removes the junction when one Wall of an L goes', () => {
    const { project, first, second } = withL()
    const applied = expectApplied(project, intent('wall.delete', { wallId: first }, []))
    expect(wallsOf(applied.project).map((wall) => wall.id)).toEqual([second])
    expect(junctionsOf(applied.project)).toEqual([])
  })

  it('keeps a corner that still has two ends after one Wall goes', () => {
    const { project, first, second } = withL()
    const drawn = chain(project, [draft(line(3000, 0, 5000, -1200))], [join(first, 'end')], [free])
    expect(junctionsOf(drawn.project)[0]!.ends).toHaveLength(3)
    const applied = expectApplied(drawn.project, intent('wall.delete', { wallId: second }, []))
    expect(wallsOf(applied.project)).toHaveLength(2)
    // The three-way corner loses one end and stays a corner between the other two Walls.
    expect(junctionsOf(applied.project)[0]!.ends).toEqual([
      { wallId: first, end: 'end' },
      { wallId: drawn.ids[0], end: 'start' },
    ])
  })

  it('is one reproducible transaction', () => {
    const { project, host } = withT()
    expectDeterministic(project, intent('wall.delete', { wallId: host }, []))
  })
})
