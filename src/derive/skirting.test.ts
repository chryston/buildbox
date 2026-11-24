/**
 * `deriveSkirting` (#78 §1, §2): the body, the gaps and the two lengths a stored range becomes.
 *
 * The fixture's host `W-1` runs from (600, 600) to (9600, 600), 200 mm thick and centred, so its
 * `left` face lies at y = 500 and its `right` face at y = 700. Every measurement below is taken
 * against those two lines, which is the issue's contract: the exposed face is the host face stood
 * off by `thickness`, and nothing about it is stored.
 */
import { describe, expect, it } from 'vitest'
import skirtingFixture from '../../fixtures/domain/v13/skirting.json?raw'
import type { Opening, Project, Skirting, WallJunction, WallRefLine } from '../domain'
import { canonicalJson } from '../lib'
import { effectiveModel } from './effectiveModel'
import { deriveSkirting, skirtingSnapSources } from './skirting'

const FLOOR = 'seed-001'
const HOST = 'seed-wall-002'

const record = JSON.parse(skirtingFixture) as { project: Project }

/** The fixture with its Design Options taken away: one Floor, one Wall, one Skirting, nothing proposed. */
function base(): Project {
  const project = structuredClone(record.project)
  project.designOptions = []
  project.existingModel.skirting = [project.existingModel.skirting![0]!]
  return project
}

const skirtingOfOne = (project: Project): Skirting => project.existingModel.skirting![0]!

const only = (project: Project) => {
  const derived = deriveSkirting(project, FLOOR)
  const row = derived.skirting[0]!
  return { derived, row }
}

function withOpenings(project: Project, openings: readonly Opening[]): Project {
  project.existingModel.openings = [...project.existingModel.openings, ...openings]
  return project
}

const opening = (over: Partial<Opening> = {}): Opening => ({
  id: 'opening-gap-1',
  floorId: FLOOR,
  hostWallId: HOST,
  kind: 'window',
  label: 'Window 90',
  start: 3000,
  width: 900,
  sill: 0,
  head: 2100,
  ...over,
})

describe('deriveSkirting (#78 §1 criterion 1, §4)', () => {
  it('stands the body off the host face by exactly its thickness', () => {
    const { row } = only(base())
    expect(row.innerOffset).toBe(-100)
    expect(row.outerOffset).toBe(-115)
    expect(row.runs).toHaveLength(1)
    // The band starts on the tidied face at y = 500 and its exposed face lies 15 mm further out.
    const outline = row.runs[0]!.outline
    expect(outline.start).toEqual({ x: 600, y: 500 })
    const ys = [outline.start, ...outline.segments.map((segment) => segment.to)].map((at) => at.y)
    expect(Math.min(...ys)).toBeCloseTo(485, 6)
    expect(Math.max(...ys)).toBeCloseTo(500, 6)
  })

  it('publishes `top` as bottom + height and never stores it', () => {
    const project = base()
    project.existingModel.skirting = [{ ...skirtingOfOne(project), bottom: -25, height: 100 }]
    const { row } = only(project)
    expect(row.bottom).toBe(-25)
    expect(row.top).toBe(75)
    // The record holds no polygon, no gap list and no top: those are answered from the host.
    expect(canonicalJson(skirtingOfOne(project))).not.toContain('gaps')
    expect(canonicalJson(skirtingOfOne(project))).not.toContain('"top"')
  })

  it('measures gross as end − start and net as what is left, so net never exceeds gross', () => {
    const { row } = only(base())
    expect(row.grossLength).toBe(9000)
    expect(row.netLength).toBeLessThanOrEqual(row.grossLength)
    expect(row.netLength).toBeCloseTo(row.runs.reduce((total, run) => total + (run.to - run.from), 0), 9)
  })

  it('opens a gap over an Opening on the same host that overlaps its height', () => {
    const clean = only(base()).row.netLength
    const { row } = only(withOpenings(base(), [opening()]))
    expect(row.grossLength).toBe(9000)
    expect(row.netLength).toBeCloseTo(clean - 900, 6)
    expect(row.runs).toHaveLength(2)
    expect(row.gaps.filter((gap) => gap.reason === 'opening')).toEqual([{ from: 3000, to: 3900, reason: 'opening' }])
  })

  it('leaves the Skirting whole where an Opening only touches its top', () => {
    const clean = only(base()).row.netLength
    // A sill exactly at the Skirting's top is touching, not overlapping (#78 §2).
    const { row } = only(withOpenings(base(), [opening({ sill: 100 })]))
    expect(row.netLength).toBeCloseTo(clean, 6)
    expect(row.gaps.filter((gap) => gap.reason === 'opening')).toEqual([])
    const below = only(withOpenings(base(), [opening({ sill: 99.999 })]))
    expect(below.row.netLength).toBeCloseTo(clean - 900, 6)
  })

  it('ignores an Opening cut into another Wall', () => {
    const clean = only(base()).row.netLength
    const other = base()
    const foreign = other.existingModel.walls.find((wall) => wall.id !== HOST)
    if (foreign === undefined) return
    const { row } = only(withOpenings(other, [opening({ hostWallId: foreign.id })]))
    expect(row.netLength).toBeCloseTo(clean, 6)
  })

  it('gaps where a joined Wall butts into the skirted face, and only that face', () => {
    // A new branch butts into the host at `at` 6000, running away on the host's LEFT side. The
    // fixture already has W-5 butting into the same Wall at `at` 3400 on its RIGHT side, which makes
    // the two faces say different things about the same Wall — which is the point of the criterion.
    const project = base()
    project.existingModel.walls = [
      ...project.existingModel.walls,
      {
        id: 'wall-branch-1',
        ref: 'W-90',
        floorId: FLOOR,
        line: { kind: 'line', start: { x: 6600, y: 600 }, end: { x: 6600, y: -1000 } },
        thickness: 100,
        justification: 'centre',
        baseElevation: 0,
        height: 2600,
      },
    ]
    const junction: WallJunction = {
      id: 'junction-branch-1',
      floorId: FLOOR,
      ends: [{ wallId: 'wall-branch-1', end: 'start' }],
      host: { wallId: HOST, at: 6000 },
    }
    project.existingModel.wallJunctions = [...project.existingModel.wallJunctions, junction]
    const clean = only(base()).row.netLength
    const left = only(project).row
    const leftJunctions = left.gaps.filter((gap) => gap.reason === 'junction')
    expect(leftJunctions).toHaveLength(1)
    expect(leftJunctions[0]!.from).toBeCloseTo(5950, 6)
    expect(leftJunctions[0]!.to).toBeCloseTo(6050, 6)
    expect(left.netLength).toBeCloseTo(clean - 100, 6)

    // The same Wall on the far face: W-5's range is taken out there and this branch's is not, because
    // a branch covers the face it butts against and no other.
    const flipped = structuredClone(project)
    flipped.existingModel.skirting = [{ ...skirtingOfOne(flipped), side: 'right' }]
    const rightJunctions = only(flipped).row.gaps.filter((gap) => gap.reason === 'junction')
    expect(rightJunctions).toHaveLength(1)
    expect(rightJunctions[0]!.from).toBeCloseTo(3325, 6)
    expect(rightJunctions[0]!.to).toBeCloseTo(3475, 6)
  })

  it('clips to the tidied face at a corner, and says so as a corner gap', () => {
    // A Wall whose stored end lies inside the join: the face clean-up leaves is what is skirted.
    const project = base()
    project.existingModel.walls = [
      ...project.existingModel.walls.filter((wall) => wall.id !== HOST),
      {
        ...project.existingModel.walls.find((wall) => wall.id === HOST)!,
        line: { kind: 'line', start: { x: 600, y: 600 }, end: { x: 9600, y: 600 } },
      },
    ]
    const whole = only(project).row
    expect(whole.gaps.filter((gap) => gap.reason === 'corner')).toEqual([])
    // A range that runs past the host's own end is clipped to it: the clip is derived, not refused.
    const past = structuredClone(project)
    past.existingModel.skirting = [{ ...skirtingOfOne(past), end: 12000 }]
    const clipped = only(past).row
    expect(clipped.grossLength).toBe(12000)
    expect(clipped.netLength).toBeCloseTo(9000, 6)
    expect(clipped.gaps.filter((gap) => gap.reason === 'corner')).toEqual([{ from: 9000, to: 12000, reason: 'corner' }])
  })

  it('is pure: the same Project gives the same answer twice over', () => {
    const project = withOpenings(base(), [opening()])
    expect(canonicalJson(deriveSkirting(project, FLOOR).skirting)).toBe(canonicalJson(deriveSkirting(project, FLOOR).skirting))
  })

  it('draws a gap for a proposed Opening in Proposed and none in Existing (#78 §2)', () => {
    const project = base()
    const surveyed = structuredClone(opening({ id: 'opening-gap-2', start: 5000 }))
    project.existingModel.openings = [surveyed]
    // The Option demolishes that window and proposes one through the same wall further along.
    project.designOptions = [
      {
        id: 'option-x',
        name: 'Option X',
        demolishedIds: ['opening-gap-2'],
        proposed: {
          walls: [],
          wallJunctions: [],
          openings: [{ ...surveyed, id: 'opening-gap-3', start: 1000, predecessorIds: ['opening-gap-2'] }],
          rooms: [],
          placedItems: [],
        },
      },
    ]
    const existing = deriveSkirting(project, FLOOR, 'option-x', 'existing').skirting[0]!
    const proposed = deriveSkirting(project, FLOOR, 'option-x', 'proposed').skirting[0]!
    expect(existing.gaps.filter((gap) => gap.reason === 'opening').map((gap) => [gap.from, gap.to])).toEqual([[5000, 5900]])
    expect(proposed.gaps.filter((gap) => gap.reason === 'opening').map((gap) => [gap.from, gap.to])).toEqual([[1000, 1900]])
  })

  it('skips a Skirting whose host Wall this Option took down', () => {
    const project = base()
    project.designOptions = [
      {
        id: 'option-y',
        name: 'Option Y',
        demolishedIds: [HOST],
        proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [] },
      },
    ]
    expect(deriveSkirting(project, FLOOR, 'option-y').skirting).toEqual([])
  })
})

/**
 * The exposed faces the plan snaps to (#78 §7): the line a cabinet face meets is the Skirting's outer
 * face, `thickness` beyond the host Wall's face — never the Wall's own line, which is 15 mm short of
 * where the finish ends up.
 */
describe('skirtingSnapSources (#78 §7)', () => {
  const linesOf = (project: Project): Map<string, WallRefLine> =>
    new Map(effectiveModel(project, FLOOR, null).standingWalls.map((wall) => [wall.id, wall.line]))

  it('offers the exposed face, thickness beyond the host face, for the whole run', () => {
    const project = base()
    const sources = skirtingSnapSources(deriveSkirting(project, FLOOR).skirting, linesOf(project))
    expect(sources).toHaveLength(1)
    expect(sources[0]!.id).toBe(skirtingOfOne(project).id)
    // `W-1`'s reference line is y = 600, half its 200 mm of body is 100, and the strip adds 15.
    const face = sources[0]!.faces[0]!
    expect([face.from.y, face.to.y]).toEqual([485, 485])
    expect([face.from.x, face.to.x]).toEqual([600, 9600])
    expect(sources[0]!.corners).toHaveLength(2)
  })

  it('offers two faces where a door breaks the strip, and none in the doorway', () => {
    const project = withOpenings(base(), [opening({ kind: 'door', start: 4000, width: 900 })])
    const sources = skirtingSnapSources(deriveSkirting(project, FLOOR).skirting, linesOf(project))
    expect(sources).toHaveLength(2)
    const spans = sources
      .map((source) => source.faces[0]!)
      .map((face) => [Math.min(face.from.x, face.to.x), Math.max(face.from.x, face.to.x)])
      .sort((a, b) => a[0] - b[0])
    // The doorway is exactly where there is no Skirting to snap a cabinet face against.
    expect(spans).toEqual([[600, 4600], [5500, 9600]])
  })

  it('offers nothing for a strip whose Wall is not in what is being shown', () => {
    const project = base()
    expect(skirtingSnapSources(deriveSkirting(project, FLOOR).skirting, new Map())).toEqual([])
  })
})
