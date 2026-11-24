/**
 * The heights a vertical drag is offered (#75 §5, criteria 19–21).
 *
 * The scene is the committed Elevation View fixture: one Floor whose Vertical Extent ends at 2 600
 * with no lower end, four Walls and a window on `Structure`, five Placements on `Furniture` — one of
 * them a `Sump box` that stands below the Floor Datum — and two Elevation Views of that Floor. The
 * candidate list is read off that scene, so every number below is a number the fixture stores rather
 * than one this file invented.
 *
 * Three rules are what the criteria actually ask for. The Floor's own heights are always there and
 * always the strongest; what the view will not draw is not a snap target unless the view says `Snap
 * to hidden content`, which is the same rule the plan canvas answers with (#71 criterion 12); and the
 * preset pack's heights come with the pack's own names, because a guide line that says `Kitchen
 * window sill` teaches something one that says `1 050` does not.
 */
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import type { ElevationView, Project } from '../domain'
import { getPresetPack, viewRenovationDisplay } from '../domain'
import type { VerticalSnapCandidate, VerticalSnapKind } from '../geometry'
import { verticalSnap, verticalTolerance } from '../geometry'
import { displayModel, effectiveModel, verticalSnapCandidates } from './index'
import { domainFixture, elevationScene } from './testing'

const RUNS = { numRuns: 1000 }

const project = elevationScene()
const kitchen = (): ElevationView => {
  const view = (project.elevationViews ?? []).find((view) => view.id === 'el-004')
  if (view === undefined) throw new Error('the fixture lost its Elevation View')
  return view
}

const kinds = (found: readonly VerticalSnapCandidate[]): Set<VerticalSnapKind> => new Set(found.map((candidate) => candidate.kind))
const labelled = (found: readonly VerticalSnapCandidate[], label: string): VerticalSnapCandidate[] => found.filter((candidate) => candidate.label === label)
/** The shipped pack's own name, which every mounting label carries (#75 criterion 25). */
const PACK = getPresetPack('hdb-bto-typical').name
const fromPack = (name: string): string => `${name} (${PACK})`
const entityIds = (found: readonly VerticalSnapCandidate[]): Set<string> => new Set(found.filter((candidate) => candidate.kind === 'entity').map((candidate) => candidate.id))

/** The same view with its own settings changed — the way an Intent would, without importing `edit`. */
const withSettings = (view: ElevationView, next: Partial<ElevationView>): ElevationView => ({ ...view, ...next })

describe('verticalSnapCandidates (#75 criteria 19–21)', () => {
  it('offers the Floor Datum and the one end of this Floor’s Vertical Extent', () => {
    const found = verticalSnapCandidates({ project, view: kitchen() })
    expect(labelled(found, 'Floor Datum')).toEqual([{ id: 'floor-datum', mm: 0, kind: 'datum', label: 'Floor Datum' }])
    expect(labelled(found, 'Upper limit').map((candidate) => candidate.mm)).toEqual([2600])
    expect(labelled(found, 'Lower limit')).toEqual([])
  })

  it('offers both ends of every Wall, Opening and Placement the Floor displays', () => {
    const found = verticalSnapCandidates({ project, view: kitchen() })
    expect(labelled(found, 'Base of W-1').map((candidate) => candidate.mm)).toEqual([0])
    expect(labelled(found, 'Top of W-1').map((candidate) => candidate.mm)).toEqual([2600])
    expect(labelled(found, 'Sill of Window 1').map((candidate) => candidate.mm)).toEqual([900])
    expect(labelled(found, 'Head of Window 1').map((candidate) => candidate.mm)).toEqual([2100])
    expect(labelled(found, 'Top of Wall cabinet').map((candidate) => candidate.mm)).toEqual([2200])
    expect(labelled(found, 'Base of Wall cabinet').map((candidate) => candidate.mm)).toEqual([1500])
    // A Placement below the Datum is offered below the Datum: the view draws it, so the drag can stop on it.
    expect(labelled(found, 'Base of Sump box').map((candidate) => candidate.mm)).toEqual([-150])
    expect(labelled(found, 'Top of Sump box').map((candidate) => candidate.mm)).toEqual([-50])
    expect(entityIds(found)).toEqual(new Set(['pr-017', 'pr-018', 'pr-019', 'pr-020', 'pr-021', 'pr-005', 'pr-011', 'pr-014', 'pr-016', 'el-002']))
  })

  it('offers the preset pack’s heights under the pack’s own names (#75 criterion 25)', () => {
    const found = verticalSnapCandidates({ project, view: kitchen() })
    const mounting = found.filter((candidate) => candidate.kind === 'mounting')
    expect(mounting.length).toBeGreaterThan(10)
    // Every one of them says which pack the number came from, so two packs cannot offer the same
    // word at two heights and leave the user guessing.
    expect(mounting.every((candidate) => candidate.label.endsWith(` (${PACK})`))).toBe(true)
    expect(labelled(mounting, fromPack('Ceiling height')).map((candidate) => candidate.mm)).toEqual([2600])
    // An alternative is the same thing at another size, so it is a height of its own.
    expect(labelled(mounting, fromPack('Clear height to slab')).map((candidate) => candidate.mm)).toEqual([2625])
    expect(labelled(mounting, fromPack('Under a false ceiling')).map((candidate) => candidate.mm)).toEqual([2400])
    const sills = mounting.filter((candidate) => candidate.label.includes(' sill ('))
    expect(sills.length).toBeGreaterThan(0)
    expect(sills.every((candidate) => candidate.mm > 0 && candidate.mm < 2600)).toBe(true)
    expect(mounting.every((candidate) => candidate.label.trim().length > 0)).toBe(true)
    expect(new Set(mounting.map((candidate) => candidate.id)).size).toBe(mounting.length)
  })

  it('names a Placement the way the rest of the product names it (#75 criteria 21, 23)', () => {
    const found = verticalSnapCandidates({ project, view: kitchen() })
    // Two of one Design on the Floor: the guide tells them apart, because the tables and the
    // Warnings List already do.
    expect(labelled(found, 'Top of Base cabinet #1').map((candidate) => candidate.mm)).toEqual([860])
    expect(labelled(found, 'Top of Base cabinet #2').map((candidate) => candidate.mm)).toEqual([860])
    expect(labelled(found, 'Base of Base cabinet')).toEqual([])
    // Renaming the Design renames both, which is what makes a shared prefix land the cycle.
    const renamed = {
      ...project,
      itemDesigns: project.itemDesigns.map((design) => (design.id === 'pr-004' ? { ...design, name: 'Tall unit' } : design)),
    }
    const labels = verticalSnapCandidates({ project: renamed, view: kitchen() }).map((candidate) => candidate.label)
    expect(labels).toContain('Top of Tall unit #1')
    expect(labels).toContain('Top of Tall unit #2')
  })

  it('leaves out the kinds the panel’s rows have switched off', () => {
    const all = verticalSnapCandidates({ project, view: kitchen() })
    expect(kinds(all)).toEqual(new Set(['datum', 'limit', 'entity', 'mounting']))
    const noEntities = verticalSnapCandidates({
      project,
      view: kitchen(),
      enabled: new Set<VerticalSnapKind>(['datum', 'limit', 'mounting']),
    })
    expect(kinds(noEntities)).toEqual(new Set(['datum', 'limit', 'mounting']))
    const onlyFloor = verticalSnapCandidates({ project, view: kitchen(), enabled: new Set<VerticalSnapKind>(['datum', 'limit']) })
    expect(onlyFloor.map((candidate) => candidate.label)).toEqual(['Floor Datum', 'Upper limit'])
  })

  it('refuses a hidden layer’s content, and takes it back for Snap to hidden content (#71 criterion 12)', () => {
    const hidden = withSettings(kitchen(), { layerSettings: { 'pr-009': { visible: false, selectable: false, editable: false } } })
    const found = verticalSnapCandidates({ project, view: hidden })
    expect(entityIds(found)).toEqual(new Set(['pr-017', 'pr-018', 'pr-019', 'pr-020', 'pr-021']))
    expect(labelled(found, 'Base of Sump box')).toEqual([])
    // The Floor’s own heights and the pack’s heights belong to no layer, so hiding one keeps them.
    expect(labelled(found, 'Floor Datum')).toHaveLength(1)
    expect(labelled(found, fromPack('Ceiling height'))).toHaveLength(1)

    const snapping = withSettings(hidden, { snapToHiddenContent: true })
    expect(entityIds(verticalSnapCandidates({ project, view: snapping }))).toEqual(entityIds(verticalSnapCandidates({ project, view: kitchen() })))
  })

  it('answers a layer the view hid but left selectable as unpickable content', () => {
    const unselectable = withSettings(kitchen(), { layerSettings: { 'pr-007': { visible: true, selectable: false, editable: true } } })
    expect(entityIds(verticalSnapCandidates({ project, view: unselectable }))).toEqual(new Set(['pr-005', 'pr-011', 'pr-014', 'pr-016', 'el-002']))
  })

  it('reads the Renovation Display the view carries', () => {
    const view = kitchen()
    const found = verticalSnapCandidates({ project, view })
    const rows = displayModel(effectiveModel(project, view.floorId, view.designOptionId ?? null), viewRenovationDisplay(view))
    expect(entityIds(found)).toEqual(new Set([...rows.walls, ...rows.openings, ...rows.placedItems].map((row) => row.entity.id)))
    // A Display that shows nothing extra cannot invent an edge, and the Datum is never a Display row.
    const combined = verticalSnapCandidates({ project, view: withSettings(view, { renovationDisplay: 'combined' }) })
    expect(combined.filter((candidate) => candidate.kind === 'entity').map((candidate) => candidate.mm).sort((a, b) => a - b)).toEqual(
      found.filter((candidate) => candidate.kind === 'entity').map((candidate) => candidate.mm).sort((a, b) => a - b),
    )
  })

  it('names the entity it offers, so the thing being dragged can be left out', () => {
    const found = verticalSnapCandidates({ project, view: kitchen() })
    const wallCabinet = 'pr-011'
    expect(verticalSnap(found, 1490, 20)?.candidate.label).toBe('Base of Wall cabinet')
    expect(verticalSnap(found, 1490, 20, wallCabinet)).toBeNull()
    // The same drag, one millimetre further, reaches the window’s sill instead — 900 is out of reach,
    // so nothing is taken: an edge never jumps to a height it was not near.
    expect(verticalSnap(found, 1000, 20, wallCabinet)).toBeNull()
    expect(verticalSnap(found, 905, 20, wallCabinet)?.candidate.label).toBe('Sill of Window 1')
  })

  it('takes the Floor Datum over an entity edge at the same height', () => {
    const found = verticalSnapCandidates({ project, view: kitchen() })
    // 0 is the Datum, the base of four Walls and two Placements at once.
    expect(verticalSnap(found, 6, 12)?.candidate.kind).toBe('datum')
    expect(verticalSnap(found, 2596, 12)?.candidate.kind).toBe('limit')
    expect(verticalSnap(found, 2604, 12)?.candidate.kind).toBe('limit')
  })

  it('converts the acquisition radius the same way the plan canvas does', () => {
    expect(verticalTolerance(1)).toBe(12)
    expect(verticalTolerance(0.2)).toBe(60)
    expect(verticalTolerance(0)).toBe(0)
    const found = verticalSnapCandidates({ project, view: kitchen() })
    expect(verticalSnap(found, 2640, verticalTolerance(0.2))?.candidate.mm).toBe(2600)
    expect(verticalSnap(found, 2640, verticalTolerance(1))).toBeNull()
  })
})

describe('the candidate list holds its shape (#75 criteria 19–21)', () => {
  it('offers a finite height with a name for every candidate', () => {
    for (const view of project.elevationViews ?? []) {
      const found = verticalSnapCandidates({ project, view })
      expect(found.length).toBeGreaterThan(10)
      for (const candidate of found) {
        expect(Number.isFinite(candidate.mm)).toBe(true)
        expect(candidate.label.length).toBeGreaterThan(0)
        expect(candidate.id.length).toBeGreaterThan(0)
      }
    }
  })

  it('never resolves a snap outside the tolerance, to the dragged entity, or over a stronger one', () => {
    const found = verticalSnapCandidates({ project, view: kitchen() })
    const rank: Record<VerticalSnapKind, number> = { datum: 0, limit: 0, entity: 1, mounting: 2 }
    fc.assert(
      fc.property(
        fc.integer({ min: -400, max: 3200 }),
        fc.constantFrom(0.2, 0.5, 1, 4),
        fc.constantFrom<string | null>(null, 'pr-011', 'pr-017', 'pr-021'),
        (mm, zoom, exclude) => {
          const tolerance = verticalTolerance(zoom)
          const snap = verticalSnap(found, mm, tolerance, exclude)
          if (snap === null) return true
          expect(Math.abs(snap.mm - mm)).toBeLessThanOrEqual(tolerance)
          expect(snap.candidate.id).not.toBe(exclude)
          expect(snap.mm).toBe(snap.candidate.mm)
          expect(snap.delta).toBe(snap.mm - mm)
          // Nothing else in reach ranks better: precedence first, then nearness.
          for (const candidate of found) {
            if (candidate.id === exclude || Math.abs(candidate.mm - mm) > tolerance) continue
            const betterRank = rank[candidate.kind] < rank[snap.candidate.kind]
            const nearer = rank[candidate.kind] === rank[snap.candidate.kind] && Math.abs(candidate.mm - mm) < Math.abs(snap.mm - mm)
            expect(betterRank || nearer).toBe(false)
          }
          return true
        },
      ),
      RUNS,
    )
  })

  it('answers the same list twice, and one the view has not been touched since', () => {
    const first = verticalSnapCandidates({ project, view: kitchen() })
    const again = verticalSnapCandidates({ project, view: kitchen() })
    expect(JSON.stringify(first)).toBe(JSON.stringify(again))
    const untouched: Project = elevationScene()
    expect(verticalSnapCandidates({ project: untouched, view: kitchen() })).toEqual(first)
  })
})

/**
 * A Skirting's two ends in the vertical snap list (#78 §7): the strip owns its height, so the words
 * are the two its inspector prints — a Bottom and a Top, never a Sill or an Underside borrowed from
 * the thing next to it.
 */
describe('a Skirting’s two ends (#78 §7)', () => {
  const SKIRTING = domainFixture('v13/skirting.json')
  const kitchenSide: ElevationView = {
    id: 'el-skirting',
    name: 'Kitchen side elevation',
    kind: 'elevation',
    floorId: 'seed-001',
    designOptionId: null,
    line: { start: { x: 600, y: 600 }, end: { x: 9600, y: 600 } },
    side: 'left',
    depth: 1000,
    renovationDisplay: 'existing',
  }

  it('is offered at its own Bottom and Top', () => {
    const found = verticalSnapCandidates({ project: SKIRTING, view: kitchenSide })
    expect(labelled(found, 'Bottom of Skirting SK-1').map((candidate) => [candidate.mm, candidate.kind])).toEqual([[0, 'entity']])
    expect(labelled(found, 'Top of Skirting SK-1').map((candidate) => candidate.mm)).toEqual([100])
    // The words belong to the record: no other element's vocabulary is borrowed for it.
    expect(labelled(found, 'Underside of Skirting SK-1')).toEqual([])
    expect(labelled(found, 'Sill of Skirting SK-1')).toEqual([])
  })
})
