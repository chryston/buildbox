/**
 * The Wall Intents (#64 §8–§11): drawing a chain, moving a Junction, an end or a whole Wall,
 * the numeric edits, split, merge and delete.
 *
 * Two rules run through all of them. A Wall stores its ends **on the reference line** and
 * nothing else: the tidied faces, the mitres and the caps are derived on read, so an edit moves
 * reference-line points and never a polygon. And a Junction is topology — which ends meet — so
 * an edit that moves an end moves the Junction's other members with it, or refuses when that
 * would break what the user joined.
 *
 * A Junction is created only by an explicit target (#64 §20 criterion 4): ending a Wall 30 mm
 * short of another creates nothing. Nothing here infers a join from proximity.
 */
import type { EntityId, Project, Wall, WallEnd, WallJunction, WallJunctionEnd, WallRefLine } from '../../domain'
import { openingDependencies } from '../../domain'
import {
  DEG,
  TOLERANCE_MM,
  arcFromThrough,
  distance,
  normaliseDeg,
  offsetRefLine,
  openingEnd,
  pt,
  refLength,
  refParamAt,
  refPointAt,
  refTangentDeg,
} from '../../geometry'
import { chainJunctionCount, wallEndKey } from '../intents'
import type { CreateWallChain, DependencyReview, Locator, WallEndTarget, WallIntent } from '../intents'
import type { Handler, IntentHandler } from './context'
import { refuse, spendIds } from './support'
import { faceRefsOn, followWallFaces, refuseReferencedWall } from './roomSupport'
import { requireOpeningsFit } from './openingSupport'

const wallPath = (wallId: EntityId): string => `existingModel.walls[${wallId}]`
const junctionPath = (junctionId: EntityId): string => `existingModel.wallJunctions[${junctionId}]`

/** The Wall, or a rejection: every Wall Intent names one. */
const requireWall = (project: Project, wallId: EntityId): Wall => {
  const found = project.existingModel.walls.find((wall) => wall.id === wallId)
  if (found === undefined) refuse('unknown-target', wallPath(wallId), `No Wall answers to ${wallId}.`)
  return found
}

const requireJunction = (project: Project, junctionId: EntityId): WallJunction => {
  const found = project.existingModel.wallJunctions.find((junction) => junction.id === junctionId)
  if (found === undefined) refuse('unknown-target', junctionPath(junctionId), `No junction answers to ${junctionId}.`)
  return found
}

/** The Wall as the draft holds it, which is what a handler writes to. */
const editWall = (draft: Project, wallId: EntityId): Wall => requireWall(draft, wallId)

/** The Junction holding one Wall end, if that end is joined at all. */
const junctionOf = (project: Project, wallId: EntityId, end: WallEnd): WallJunction | undefined =>
  project.existingModel.wallJunctions.find((junction) =>
    junction.ends.some((member) => member.wallId === wallId && member.end === end),
  )

/**
 * The next free `W-n`. The Project keeps no counter of its own, so this is one past the highest
 * number in use among the Walls that exist; a deleted Wall's number is spent only until the
 * Walls above it are deleted too (#64 §1).
 */
export const nextWallRef = (project: Project): string => {
  let highest = 0
  for (const wall of project.existingModel.walls) {
    const digits = /\d+/.exec(wall.ref)
    if (digits !== null) highest = Math.max(highest, Number(digits[0]))
  }
  return `W-${highest + 1}`
}

// --- Reference lines ---------------------------------------------------------

const endOf = (line: WallRefLine, end: WallEnd): { x: number; y: number } => (end === 'start' ? line.start : line.end)

/** The same line with one end moved. An arc keeps its `through`, so it re-solves the bulge. */
const withEnd = (line: WallRefLine, end: WallEnd, at: { x: number; y: number }): WallRefLine =>
  end === 'start' ? { ...line, start: at } : { ...line, end: at }

const translateLine = (line: WallRefLine, d: { x: number; y: number }): WallRefLine => ({
  ...line,
  start: pt(line.start.x + d.x, line.start.y + d.y),
  end: pt(line.end.x + d.x, line.end.y + d.y),
  ...(line.kind === 'arc' ? { through: pt(line.through.x + d.x, line.through.y + d.y) } : {}),
})

/** The line turned about its start by `deltaDeg` clockwise. A circle stays a circle. */
const rotateLine = (line: WallRefLine, deltaDeg: number): WallRefLine => {
  if (deltaDeg === 0) return line
  const about = line.start
  const cos = Math.cos(deltaDeg * DEG)
  const sin = Math.sin(deltaDeg * DEG)
  const turn = (at: { x: number; y: number }): { x: number; y: number } => {
    const dx = at.x - about.x
    const dy = at.y - about.y
    return pt(about.x + dx * cos - dy * sin, about.y + dx * sin + dy * cos)
  }
  return {
    ...line,
    start: about,
    end: turn(line.end),
    ...(line.kind === 'arc' ? { through: turn(line.through) } : {}),
  }
}

/** The line's own circle. `null` for a straight line, or three points that do not describe one. */
const circleOf = (line: WallRefLine) => (line.kind === 'arc' ? arcFromThrough(line.start, line.through, line.end) : null)

type ArcLine = Extract<WallRefLine, { kind: 'arc' }>

/** The Wall's curve, or a rejection: only a curved Wall has a radius, a sweep or a centre. */
const arcLineOf = (wall: Wall, wallId: EntityId): ArcLine => {
  if (wall.line.kind !== 'arc') refuse('invalid-wall', wallPath(wallId), 'Only a curved wall has a radius or a sweep.')
  return wall.line
}

/** The arc with the same start and radius that runs `sweep` degrees from it. */
const arcWithSweep = (line: WallRefLine, sweep: number): WallRefLine => {
  const arc = circleOf(line)
  if (arc === null) return line
  const at = (t: number): { x: number; y: number } =>
    pt(arc.center.x + arc.radius * Math.cos(t), arc.center.y + arc.radius * Math.sin(t))
  return { kind: 'arc', start: at(arc.t0), through: at(arc.t0 + sweep / 2), end: at(arc.t0 + sweep) }
}

// --- Creating ----------------------------------------------------------------

/** One drawn end's contribution to the Junction it names. */
interface Group {
  members: WallJunctionEnd[]
  host?: { wallId: EntityId; at: number }
}

const addMember = (group: Group, member: WallJunctionEnd): void => {
  if (!group.members.some((other) => other.wallId === member.wallId && other.end === member.end)) {
    group.members.push(member)
  }
}

/**
 * A chained draw: every segment becomes its own Wall, and every explicit target becomes a
 * Junction (#64 §8, §9). Consecutive segments name each other; closing on the chain's first
 * point is the same link back to index 0, which joins the last Wall to the first.
 *
 * A T-attach stores its end on the host's reference line at the projection of the drawn point,
 * so the branch butts the host's face once clean-up runs. The host keeps its ID, its line and
 * both its faces: it is never split.
 */
const createChain: Handler<'wall.createChain'> = (ctx) => {
  const payload = ctx.intent.payload as CreateWallChain
  const { floorId, walls, starts, ends } = payload
  if (walls.length === 0 || starts.length !== walls.length || ends.length !== walls.length) {
    refuse('invalid-wall', 'existingModel.walls', 'A chained draw carries one target for each end of every segment.')
  }
  if (!ctx.project.floors.some((floor) => floor.id === floorId)) {
    refuse('unknown-target', `floors[${floorId}]`, `No floor answers to ${floorId}.`)
  }
  const spent = spendIds(ctx.intent.ids, walls.length + chainJunctionCount(payload), 'wall.createChain')
  const wallIds = spent.slice(0, walls.length)

  const groups = new Map<string, Group>()
  let firstRef = 0
  {
    let highest = 0
    for (const wall of ctx.project.existingModel.walls) {
      const digits = /\d+/.exec(wall.ref)
      if (digits !== null) highest = Math.max(highest, Number(digits[0]))
    }
    firstRef = highest + 1
  }
  const drawn = walls.map((wall) => ({ ...wall, line: wall.line }))

  const groupFor = (key: string): Group => {
    const existing = groups.get(key)
    if (existing !== undefined) return existing
    const created: Group = { members: [] }
    groups.set(key, created)
    return created
  }

  for (let index = 0; index < walls.length; index += 1) {
    const targets: readonly [WallEnd, WallEndTarget][] = [
      ['start', starts[index] as WallEndTarget],
      ['end', ends[index] as WallEndTarget],
    ]
    for (const [end, target] of targets) {
      const key = wallEndKey(target, index, end)
      if (key === '') continue
      const group = groupFor(key)
      addMember(group, { wallId: wallIds[index] as string, end })
      if (target.kind === 'segment') {
        const partner = walls[target.index]
        if (partner === undefined) {
          refuse('invalid-wall', 'existingModel.walls', 'A chain link names a segment this draw does not have.')
        }
        const back = target.end === 'start' ? starts[target.index] : ends[target.index]
        if (back === undefined || back.kind !== 'segment' || back.index !== index || back.end !== end) {
          refuse('invalid-wall', 'existingModel.walls', 'A chain link has to be named by both of its ends.')
        }
        addMember(group, { wallId: wallIds[target.index] as string, end: target.end })
      } else if (target.kind === 'wall') {
        requireWall(ctx.project, target.wallId)
        addMember(group, { wallId: target.wallId, end: target.end })
        // Joining an end that is already joined adds this Wall to that Junction rather than
        // making a second one at the same point.
        const joined = junctionOf(ctx.project, target.wallId, target.end)
        if (joined !== undefined) {
          groups.delete(key)
          const carried = groups.get(joined.id) ?? group
          for (const member of group.members) addMember(carried, member)
          groups.set(joined.id, carried)
        }
      } else if (target.kind === 'host') {
        const host = requireWall(ctx.project, target.wallId)
        const source = drawn[index] as Wall
        const at = refParamAt(host.line, endOf(source.line, end))
        if (at <= 0 || at >= refLength(host.line)) {
          refuse(
            'invalid-wall',
            wallPath(target.wallId),
            `That point is not along the middle of ${host.ref}, so the new wall cannot attach to it.`,
          )
        }
        group.host = { wallId: target.wallId, at }
        // The end is stored on the host's reference line, not where it was drawn.
        drawn[index] = { ...source, line: withEnd(source.line, end, refPointAt(host.line, at)) }
      }
    }
  }

  const created: Wall[] = drawn.map((wall, index) => ({
    id: wallIds[index] as string,
    ref: `W-${firstRef + index}`,
    floorId,
    line: wall.line,
    thickness: wall.thickness,
    justification: wall.justification,
    ...(wall.classification === undefined ? {} : { classification: wall.classification }),
    ...(wall.constructionLabel === undefined ? {} : { constructionLabel: wall.constructionLabel }),
    baseElevation: wall.baseElevation,
    height: wall.height,
  }))
  ctx.draft.existingModel.walls.push(...created)

  const junctionIds = spent.slice(walls.length)
  let next = 0
  for (const [key, group] of groups) {
    const existing = ctx.draft.existingModel.wallJunctions.find((junction) => junction.id === key)
    if (existing !== undefined) {
      for (const member of group.members) {
        if (!existing.ends.some((other) => other.wallId === member.wallId && other.end === member.end)) {
          existing.ends.push(member)
        }
      }
      continue
    }
    const id = junctionIds[next]
    next += 1
    if (id === undefined) refuse('missing-ids', 'ids', 'wall.createChain spent more junction IDs than it carried.')
    if (group.members.length < 2 && group.host === undefined) {
      refuse('invalid-wall', 'existingModel.walls', 'A junction has to join two ends, or attach to a wall.')
    }
    ctx.draft.existingModel.wallJunctions.push({
      id,
      floorId,
      ends: group.members,
      ...(group.host === undefined ? {} : { host: { ...group.host } }),
    })
  }
}

// --- Moving ------------------------------------------------------------------

/** Move one Wall's end to an exact point, leaving the rest of its line alone. */
const moveEnd = (project: Project, member: WallJunctionEnd, at: { x: number; y: number }): void => {
  const wall = project.existingModel.walls.find((candidate) => candidate.id === member.wallId)
  if (wall === undefined) return
  wall.line = withEnd(wall.line, member.end, at)
}

/**
 * Drag a Junction: every member end moves together (#64 §10). A hosted Junction has only one
 * way to move — along its host — so the drag is read as where along the host it should now sit,
 * and every member follows to that point.
 */
const dragJunction: Handler<'wall.dragJunction'> = (ctx) => {
  const { junctionId, delta } = ctx.intent.payload
  const junction = requireJunction(ctx.project, junctionId)
  if (junction.host === undefined) {
    for (const member of junction.ends) {
      const wall = requireWall(ctx.project, member.wallId)
      moveEnd(ctx.draft, member, pt(endOf(wall.line, member.end).x + delta.x, endOf(wall.line, member.end).y + delta.y))
    }
    return
  }
  const host = requireWall(ctx.project, junction.host.wallId)
  const length = refLength(host.line)
  const here = refPointAt(host.line, junction.host.at)
  const moved = refParamAt(host.line, pt(here.x + delta.x, here.y + delta.y))
  const clamped = Math.min(length - TOLERANCE_MM, Math.max(TOLERANCE_MM, moved))
  const point = refPointAt(host.line, clamped)
  requireJunction(ctx.draft, junctionId).host = { wallId: host.id, at: clamped }
  for (const member of junction.ends) moveEnd(ctx.draft, member, point)
}

/** Drag one free end. An end that joins another Wall moves by dragging its Junction. */
const dragEndpoint: Handler<'wall.dragEndpoint'> = (ctx) => {
  const { wallId, end, to } = ctx.intent.payload
  const wall = editWall(ctx.draft, wallId)
  if (junctionOf(ctx.project, wallId, end) !== undefined) {
    refuse(
      'invalid-wall',
      wallPath(wallId),
      `The ${end === 'start' ? 'start' : 'end'} of ${wall.ref} joins another wall — move that junction instead.`,
    )
  }
  wall.line = withEnd(wall.line, end, to)
}

/**
 * Drag a whole Wall: it moves, the Junctions it belongs to move with it, and the other members
 * of those Junctions stretch to stay joined (#64 §10). An end hosted on another Wall cannot
 * leave that Wall, so that end follows the host instead of the drag, and the Wall turns a little
 * as a result.
 */
const dragBody: Handler<'wall.dragBody'> = (ctx) => {
  const { wallId, delta } = ctx.intent.payload
  const wall = editWall(ctx.draft, wallId)
  const moved = translateLine(wall.line, delta)
  const mine = ctx.project.existingModel.wallJunctions.filter((junction) =>
    junction.ends.some((member) => member.wallId === wallId),
  )
  let line = moved
  for (const junction of mine) {
    const member = junction.ends.find((candidate) => candidate.wallId === wallId)!
    let point = endOf(moved, member.end)
    if (junction.host !== undefined && junction.host.wallId !== wallId) {
      const host = requireWall(ctx.project, junction.host.wallId)
      const length = refLength(host.line)
      const at = Math.min(length - TOLERANCE_MM, Math.max(TOLERANCE_MM, refParamAt(host.line, point)))
      point = refPointAt(host.line, at)
      ctx.draft.existingModel.wallJunctions.find((candidate) => candidate.id === junction.id)!.host = {
        wallId: host.id,
        at,
      }
    }
    line = withEnd(line, member.end, point)
    for (const other of junction.ends) if (other.wallId !== wallId) moveEnd(ctx.draft, other, point)
  }
  wall.line = line
}

/** The same reference line run the other way: the same shape, the opposite direction. */
const flip = (line: WallRefLine): WallRefLine => ({ ...line, start: line.end, end: line.start })

/** The length along the reference line, one end held where it is. */
const setLength: Handler<'wall.setLength'> = (ctx) => {
  const { wallId, length, keepFixed } = ctx.intent.payload
  const wall = editWall(ctx.draft, wallId)
  if (!(length >= TOLERANCE_MM)) refuse('invalid-wall', wallPath(wallId), 'A wall has to be at least 0.01 mm long.')
  if (wall.line.kind === 'line') {
    const from = keepFixed === 'start' ? wall.line.start : wall.line.end
    const toward = keepFixed === 'start' ? wall.line.end : wall.line.start
    const d = { x: toward.x - from.x, y: toward.y - from.y }
    const l = Math.hypot(d.x, d.y) || 1
    wall.line = withEnd(wall.line, keepFixed === 'start' ? 'end' : 'start', pt(from.x + (d.x * length) / l, from.y + (d.y * length) / l))
    return
  }
  const oriented = keepFixed === 'start' ? wall.line : flip(wall.line)
  const arc = circleOf(oriented)
  if (arc === null) refuse('invalid-wall', wallPath(wallId), 'That curve is not a circular arc.')
  const signed = arc.t1 >= arc.t0 ? 1 : -1
  const grown = arcWithSweep(oriented, (signed * length) / arc.radius)
  wall.line = keepFixed === 'start' ? grown : flip(grown)
}

/** The direction of the reference line, turned about its start (#64 §10). */
const setDirection: Handler<'wall.setDirection'> = (ctx) => {
  const { wallId, directionDeg } = ctx.intent.payload
  const wall = editWall(ctx.draft, wallId)
  wall.line = rotateLine(wall.line, normaliseDeg(directionDeg - refTangentDeg(wall.line, 'start')))
}

/** The radius and sweep of a curved Wall: the radius scales about the centre, the sweep runs
 * from the same start along the same tangent. */
const setArc: Handler<'wall.setArc'> = (ctx) => {
  const { wallId, radius, sweepDeg } = ctx.intent.payload
  const wall = editWall(ctx.draft, wallId)
  const curve = arcLineOf(wall, wallId)
  if (radius === undefined && sweepDeg === undefined) {
    refuse('invalid-wall', wallPath(wallId), 'Give a radius, a sweep, or both.')
  }
  const arc = circleOf(curve)
  if (arc === null) refuse('invalid-wall', wallPath(wallId), 'That curve is not a circular arc.')
  let line: WallRefLine = curve
  if (radius !== undefined) {
    if (!(radius > 0)) refuse('invalid-wall', wallPath(wallId), 'A radius has to be more than 0 mm.')
    const scale = (at: { x: number; y: number }): { x: number; y: number } =>
      pt(arc.center.x + ((at.x - arc.center.x) * radius) / arc.radius, arc.center.y + ((at.y - arc.center.y) * radius) / arc.radius)
    line = { kind: 'arc', start: scale(curve.start), through: scale(curve.through), end: scale(curve.end) }
  }
  if (sweepDeg !== undefined) {
    if (!(Math.abs(sweepDeg) > 0)) refuse('invalid-wall', wallPath(wallId), 'A sweep of 0° describes no wall.')
    const signed = arc.t1 >= arc.t0 ? 1 : -1
    line = arcWithSweep(line, signed * Math.abs(sweepDeg) * DEG)
  }
  wall.line = line
}

const setThickness: Handler<'wall.setThickness'> = (ctx) => {
  const { wallId, thickness } = ctx.intent.payload
  const wall = editWall(ctx.draft, wallId)
  if (!(thickness > 0)) refuse('invalid-wall', wallPath(wallId), 'A wall has to be more than 0 mm thick.')
  wall.thickness = thickness
}

/** `Offset wall by … mm`: the reference line moves perpendicular, to the chosen side (#64 §10).
 * The side is read in the reference line's own direction, and a curve offsets concentrically —
 * the same normal `derive` offsets the faces by, so the line can reach a face. */
const offsetWall: Handler<'wall.offset'> = (ctx) => {
  const { wallId, distance: amount, side } = ctx.intent.payload
  const wall = editWall(ctx.draft, wallId)
  const along = side === 'left' ? amount : -amount
  const next = offsetRefLine(wall.line, along)
  if (wall.line.kind === 'arc' && next.kind === 'line') {
    refuse('invalid-wall', wallPath(wallId), 'That would turn the curve inside out.')
  }
  wall.line = next
}

/**
 * Split at a point: the start-side piece keeps the ID and the `ref`, the end-side piece gets a
 * pre-allocated ID and the next `ref`, and a run-through Junction joins them so the two read as
 * one band with a seam (#64 §10). Hosted Junctions move to the piece they lie on. A split point
 * within 0.01 mm of a hosted Junction is blocked, because the host's `at` would land out of
 * range of the piece it ends up on.
 */
const splitWall: Handler<'wall.split'> = (ctx) => {
  const { wallId, at } = ctx.intent.payload
  const wall = editWall(ctx.draft, wallId)
  const length = refLength(wall.line)
  if (!(at > 0 && at < length)) {
    refuse('invalid-wall', wallPath(wallId), 'That point is not along the middle of this wall.')
  }
  for (const junction of ctx.project.existingModel.wallJunctions) {
    if (junction.host !== undefined && junction.host.wallId === wallId && Math.abs(junction.host.at - at) <= TOLERANCE_MM) {
      refuse(
        'split-blocked',
        junctionPath(junction.id),
        'Another wall attaches to this one exactly there. Move the attachment first.',
      )
    }
  }
  const [newId, junctionId] = spendIds(ctx.intent.ids, 2, 'wall.split')
  // Each Opening goes to the piece it lies on, its `start` measured from the new seam
  // (#65 §7). One that straddles the seam blocks the split outright: the two pieces would
  // each be left holding part of a hole that neither of them has.
  for (const opening of ctx.draft.existingModel.openings) {
    if (opening.hostWallId !== wallId) continue
    const end = openingEnd(wall.line, opening.start, opening.width)
    if (opening.start < at - TOLERANCE_MM && end > at + TOLERANCE_MM) {
      refuse('split-blocked', wallPath(wallId), `The split point is inside ${opening.label}.`)
    }
    if (opening.start >= at) {
      opening.hostWallId = newId
      opening.start -= at
    }
  }
  const cut = refPointAt(wall.line, at)
  const arc = wall.line.kind === 'arc' ? { throughStart: refPointAt(wall.line, at / 2), throughEnd: refPointAt(wall.line, (at + length) / 2) } : null
  const startLine: WallRefLine = { ...wall.line, end: cut, ...(arc === null ? {} : { through: arc.throughStart }) }
  const endLine: WallRefLine = { ...wall.line, start: cut, ...(arc === null ? {} : { through: arc.throughEnd }) }

  const kept = wall
  kept.line = startLine
  ctx.draft.existingModel.walls.push({
    ...kept,
    id: newId,
    ref: nextWallRef(ctx.project),
    line: endLine,
  })

  for (const junction of ctx.draft.existingModel.wallJunctions) {
    if (junction.host !== undefined && junction.host.wallId === wallId && junction.host.at > at) {
      junction.host = { wallId: newId, at: junction.host.at - at }
    }
    // The far end of the original Wall is now the far end of the new one.
    junction.ends = junction.ends.map((member) =>
      member.wallId === wallId && member.end === 'end' ? { wallId: newId, end: 'end' } : member,
    )
  }
  ctx.draft.existingModel.wallJunctions.push({ id: junctionId, floorId: wall.floorId, ends: [{ wallId, end: 'end' }, { wallId: newId, end: 'start' }] })
}

/** What stops two Walls becoming one, in the homeowner's words; `null` when they match (#64 §10). */
const mismatchOf = (first: Wall, second: Wall): string | null => {
  if (first.thickness !== second.thickness) {
    return `These walls have different thicknesses (${first.thickness} mm and ${second.thickness} mm).`
  }
  if (first.justification !== second.justification) {
    return `These walls sit differently in their thickness (${first.justification} and ${second.justification}).`
  }
  if (first.classification !== second.classification) return 'These walls are different kinds of wall.'
  if (first.constructionLabel !== second.constructionLabel) return 'These walls are built differently.'
  if (first.baseElevation !== second.baseElevation || first.height !== second.height) {
    return 'These walls are not the same height.'
  }
  return null
}

/** The two Walls' shared axis, or `null` when they are not one straight run. */
const mergedLine = (first: Wall, second: Wall): WallRefLine | null => {
  if (first.line.kind === 'line' && second.line.kind === 'line') {
    const d = { x: first.line.end.x - first.line.start.x, y: first.line.end.y - first.line.start.y }
    const l = Math.hypot(d.x, d.y) || 1
    const axis = pt(d.x / l, d.y / l)
    const normal = pt(-axis.y, axis.x)
    const points = [first.line.start, first.line.end, second.line.start, second.line.end]
    const offLine = points.map((p) => Math.abs((p.x - first.line.start.x) * normal.x + (p.y - first.line.start.y) * normal.y))
    if (Math.max(...offLine) > TOLERANCE_MM) return null
    const params = points.map((p) => (p.x - first.line.start.x) * axis.x + (p.y - first.line.start.y) * axis.y)
    const lo = Math.min(...params)
    const hi = Math.max(...params)
    const at = (s: number): { x: number; y: number } =>
      pt(first.line.start.x + axis.x * s, first.line.start.y + axis.y * s)
    return { kind: 'line', start: at(lo), end: at(hi) }
  }
  if (first.line.kind !== 'arc' || second.line.kind !== 'arc') return null
  const a = arcFromThrough(first.line.start, first.line.through, first.line.end)
  const b = arcFromThrough(second.line.start, second.line.through, second.line.end)
  if (a === null || b === null) return null
  if (distance(a.center, b.center) > TOLERANCE_MM || Math.abs(a.radius - b.radius) > TOLERANCE_MM) return null
  const unwrapped = (t: number): number => {
    let value = t
    while (value - a.t0 > Math.PI) value -= 2 * Math.PI
    while (value - a.t0 < -Math.PI) value += 2 * Math.PI
    return value
  }
  const angles = [a.t0, a.t1, unwrapped(b.t0), unwrapped(b.t1)]
  const lo = Math.min(...angles)
  const hi = Math.max(...angles)
  const at = (t: number): { x: number; y: number } => pt(a.center.x + a.radius * Math.cos(t), a.center.y + a.radius * Math.sin(t))
  const forward = a.t1 >= a.t0
  return {
    kind: 'arc',
    start: at(forward ? lo : hi),
    through: at((lo + hi) / 2),
    end: at(forward ? hi : lo),
  }
}

/**
 * Merge two Walls joined by a two-end Junction (#64 §10): the first keeps its ID and its `ref`,
 * the other's Junctions move onto it, and hosted Junctions are rehosted at the same point on the
 * longer line. Anything that would make the result ambiguous is refused with a message naming
 * what differs.
 */
const mergeWalls: Handler<'wall.merge'> = (ctx) => {
  const [firstId, secondId] = ctx.intent.payload.wallIds
  const first = requireWall(ctx.project, firstId)
  const second = requireWall(ctx.project, secondId)
  // Merging takes one of the two out of the drawing, so a Room standing on either of them has
  // to be moved off first (#67 §12).
  for (const wall of [first, second]) {
    if (faceRefsOn(ctx.project, wall.id).length > 0) refuseReferencedWall(ctx.project, wall)
  }
  const shared = ctx.project.existingModel.wallJunctions.find(
    (junction) =>
      junction.host === undefined &&
      junction.ends.length === 2 &&
      junction.ends.some((member) => member.wallId === firstId) &&
      junction.ends.some((member) => member.wallId === secondId),
  )
  if (shared === undefined) {
    refuse('merge-mismatch', wallPath(secondId), 'These walls do not meet at a junction of their own.')
  }
  const mismatch = mismatchOf(first, second)
  if (mismatch !== null) refuse('merge-mismatch', wallPath(secondId), mismatch)
  const line = mergedLine(first, second)
  if (line === null) refuse('merge-mismatch', wallPath(secondId), 'These walls are not one straight run.')

  const joinedFirst = shared.ends.find((member) => member.wallId === firstId)!.end
  const joinedSecond = shared.ends.find((member) => member.wallId === secondId)!.end
  const farFirst: WallEnd = joinedFirst === 'start' ? 'end' : 'start'
  const kept = ctx.draft.existingModel.walls.find((candidate) => candidate.id === firstId)!
  kept.line = line
  for (const junction of ctx.draft.existingModel.wallJunctions) {
    if (junction.id === shared.id) continue
    if (junction.host !== undefined && junction.host.wallId === secondId) {
      junction.host = { wallId: firstId, at: refParamAt(line, refPointAt(second.line, junction.host.at)) }
    }
    // The far end of the second Wall is now the far end of the first.
    junction.ends = junction.ends.map((member) =>
      member.wallId === secondId && member.end !== joinedSecond ? { wallId: firstId, end: farFirst } : member,
    )
  }
  // Both pieces' Openings move to the Wall that survives. Both are moved, not just the
  // second: the merged line starts at whichever piece reaches further back, so the survivor's
  // own Openings shift by the same amount the other's do.
  rehostOpenings(ctx.draft.existingModel.openings, first, firstId, line)
  rehostOpenings(ctx.draft.existingModel.openings, second, firstId, line)
  ctx.draft.existingModel.wallJunctions = ctx.draft.existingModel.wallJunctions.filter((junction) => junction.id !== shared.id)
  ctx.draft.existingModel.walls = ctx.draft.existingModel.walls.filter((wall) => wall.id !== secondId)
}

/** Both pieces' Openings, read at the same point of the longer line (#65 §7). */
const rehostOpenings = (
  openings: Project['existingModel']['openings'],
  from: Wall,
  onto: EntityId,
  line: WallRefLine,
): void => {
  for (const opening of openings) {
    if (opening.hostWallId !== from.id) continue
    opening.start = refParamAt(line, refPointAt(from.line, opening.start))
    opening.hostWallId = onto
  }
}

/**
 * Delete a Wall: its Junctions lose that end, a Junction left with one member and no host is
 * removed, and the Junctions hosted on it go with it — their branch ends become free ends, which
 * is what the homeowner sees as a wall that no longer meets anything (#64 §10).
 *
 * Its Openings go too, but never quietly (#65 §8). An Opening is an absence in one Wall, so a
 * Wall that has any cannot be deleted on its own: the review lists them, the homeowner agrees,
 * and the agreement is re-checked here against the Project as it is now. An answer that no
 * longer matches — an Opening added or removed since the dialog was shown — is refused, because
 * deleting this Wall would then take something the homeowner never saw.
 */
const deleteWall: Handler<'wall.delete'> = (ctx) => {
  const { wallId, openings: agreed } = ctx.intent.payload
  const host = requireWall(ctx.project, wallId)
  // A Room standing on this Wall comes first (#67 §12): detaching a Room is the homeowner's
  // decision, and it is asked before the question of what the delete costs in Openings.
  if (faceRefsOn(ctx.project, wallId).length > 0) refuseReferencedWall(ctx.project, host)
  const hosted = ctx.project.existingModel.openings.filter((opening) => opening.hostWallId === wallId)
  if (hosted.length > 0) {
    if (agreed === undefined) {
      refuse(
        'has-dependants',
        wallPath(wallId),
        `${host.ref} has ${count(hosted.length)} in it. Deleting the wall deletes them too — nothing here does that for you.`,
      )
    }
    const now = hosted.map((opening) => opening.id).sort()
    const given = [...agreed].sort()
    if (now.length !== given.length || now.some((id, index) => id !== given[index])) {
      refuse(
        'dependency-changed',
        wallPath(wallId),
        `${host.ref} does not have the same openings as when you asked. Check the list again.`,
      )
    }
    ctx.draft.existingModel.openings = ctx.draft.existingModel.openings.filter(
      (opening) => opening.hostWallId !== wallId,
    )
  }
  ctx.draft.existingModel.walls = ctx.draft.existingModel.walls.filter((wall) => wall.id !== wallId)
  ctx.draft.existingModel.wallJunctions = ctx.draft.existingModel.wallJunctions
    .filter((junction) => junction.host === undefined || junction.host.wallId !== wallId)
    .map((junction) => {
      const ends = junction.ends.filter((member) => member.wallId !== wallId)
      return ends.length === junction.ends.length ? junction : { ...junction, ends }
    })
    .filter((junction) => junction.ends.length >= 2 || junction.host !== undefined)
}

/** `1 opening` / `3 openings` — the count the refusal gives. */
const count = (n: number): string => `${n} ${n === 1 ? 'opening' : 'openings'}`

/**
 * The review a delete of a Wall with Openings has to be answered before it runs (#65 §8).
 * Nothing is thrown here: a Wall that is not there has nothing to list, and the Intent is
 * refused by the handler with the usual message.
 */
const deleteWallReview = (project: Project, wallId: EntityId): DependencyReview | null => {
  const wall = project.existingModel.walls.find((candidate) => candidate.id === wallId)
  if (wall === undefined) return null
  const openings = openingDependencies(project, wallId)
  if (openings.length === 0) return null
  return {
    kind: 'delete-wall',
    wallId,
    wallRef: wall.ref,
    openings,
    message: `Delete ${wall.ref} and its ${count(openings.length)}?`,
  }
}

const planLocator = (floorId: EntityId | null): Locator => ({
  floorId,
  viewId: null,
  view: 'plan',
  itemDesignIds: [],
  placedItemIds: [],
})

const wallFloor = (project: Project, wallId: EntityId): EntityId | null =>
  project.existingModel.walls.find((wall) => wall.id === wallId)?.floorId ?? null

const junctionFloor = (project: Project, junctionId: EntityId): EntityId | null =>
  project.existingModel.wallJunctions.find((junction) => junction.id === junctionId)?.floorId ?? null

type WallHandlers = { [T in WallIntent['type']]: IntentHandler<T> }

/**
 * The Wall edits a Project's Openings have to survive (#65 §7): the edit runs, then every
 * Opening is measured against the Wall it is cut into as that Wall now is. One that no longer
 * fits refuses the whole edit with its own sentence, so a drag that would swallow a window is
 * refused outright — and the tool's red proposal state reads the same rejection the commit
 * would have got.
 *
 * `wall.createChain` is not wrapped: a Wall drawn this instant has nothing cut into it yet.
 * `wall.delete` is not wrapped either, because its Openings are a review, not a fit failure.
 *
 * Between the two sits #67 §12: a Room Edge referenced to one of the Walls this edit moved
 * follows the face it was riding, and the edit is refused when the face turned into something
 * the Edge cannot lie on or when following it would push a Room into another.
 */
const withOpeningsChecked = <T extends WallIntent['type']>(run: Handler<T>): Handler<T> => (ctx) => {
  run(ctx)
  followWallFaces(ctx.project, ctx.draft)
  requireOpeningsFit(ctx.draft)
}

export const WALL_HANDLERS: WallHandlers = {
  'wall.createChain': { run: createChain, locate: (_project, intent) => planLocator(intent.payload.floorId) },
  'wall.dragJunction': { run: withOpeningsChecked(dragJunction), locate: (project, intent) => planLocator(junctionFloor(project, intent.payload.junctionId)) },
  'wall.dragEndpoint': { run: withOpeningsChecked(dragEndpoint), locate: (project, intent) => planLocator(wallFloor(project, intent.payload.wallId)) },
  'wall.dragBody': { run: withOpeningsChecked(dragBody), locate: (project, intent) => planLocator(wallFloor(project, intent.payload.wallId)) },
  'wall.setLength': { run: withOpeningsChecked(setLength), locate: (project, intent) => planLocator(wallFloor(project, intent.payload.wallId)) },
  'wall.setDirection': { run: withOpeningsChecked(setDirection), locate: (project, intent) => planLocator(wallFloor(project, intent.payload.wallId)) },
  'wall.setArc': { run: withOpeningsChecked(setArc), locate: (project, intent) => planLocator(wallFloor(project, intent.payload.wallId)) },
  'wall.setThickness': { run: withOpeningsChecked(setThickness), locate: (project, intent) => planLocator(wallFloor(project, intent.payload.wallId)) },
  'wall.offset': { run: withOpeningsChecked(offsetWall), locate: (project, intent) => planLocator(wallFloor(project, intent.payload.wallId)) },
  'wall.split': { run: withOpeningsChecked(splitWall), locate: (project, intent) => planLocator(wallFloor(project, intent.payload.wallId)) },
  'wall.merge': { run: withOpeningsChecked(mergeWalls), locate: (project, intent) => planLocator(wallFloor(project, intent.payload.wallIds[0])) },
  'wall.delete': {
    run: deleteWall,
    locate: (project, intent) => planLocator(wallFloor(project, intent.payload.wallId)),
    review: (project, intent) => deleteWallReview(project, intent.payload.wallId),
  },
}
