/**
 * Where new content goes (#71 §2, criteria 2), under `VITE_FF_RENOVATION=true`.
 *
 * The rule is a lookup and one refusal, and both are easy to get subtly wrong in opposite
 * directions: a creation tool that files by layer *ID* would strand new Walls the moment a person
 * renames `Structure`, while one that recreated a missing default layer would undo their deletion.
 * And the read-only case has to refuse rather than redirect — silently filing new work on a layer
 * the person can see but not edit is the failure this criterion exists to prevent.
 *
 * Every case checks the record that was actually written, not a helper's answer, because the field
 * is written by the same spread that builds the record.
 */
import { describe, expect, it } from 'vitest'
import layersFixture from '../../../fixtures/domain/v7/rooms.json?raw'
import type { DrawingLayer, LayerSetting, PlanView, Project } from '../../domain'
import type { ClosedPath } from '../../geometry'
import { pt } from '../../geometry'
import { canonicalJson } from '../../lib'
import { applyIntent, previewIntent, type Intent } from '../index'
import { expectRoundTrip, intent } from '../testing'

const base = (JSON.parse(layersFixture) as { project: Project }).project

const STRUCTURE = 'layer-structure'
const SERVICES = 'layer-services'
const FURNITURE = 'layer-furniture'
const FLOOR = 'floor-0'
const VIEW = 'view-0'

const LAYERS: DrawingLayer[] = [
  { id: STRUCTURE, name: 'Structure', color: '#b9b9c2' },
  { id: SERVICES, name: 'Services', color: '#5fb3ff' },
  { id: FURNITURE, name: 'Furniture', color: '#e3a857' },
]

/** The three default layers, in the Project order a new Project gives them. */
function layered(views: PlanView[] = base.views): Project {
  return { ...base, drawingLayers: LAYERS.map((layer) => ({ ...layer })), views: views.map((view) => ({ ...view })) }
}

/** This view's own say about one layer, on top of whatever it already says. */
function withSetting(project: Project, viewId: string, key: string, setting: Partial<LayerSetting>): Project {
  const views = project.views.map((view) =>
    view.id === viewId
      ? { ...view, layerSettings: { ...view.layerSettings, [key]: { visible: true, selectable: true, editable: true, ...setting } } }
      : view,
  )
  return { ...project, views }
}

function withActive(project: Project, viewId: string, layerId: string | null): Project {
  return { ...project, views: project.views.map((view) => (view.id === viewId ? { ...view, activeLayerId: layerId } : view)) }
}

const rect = (left: number, top: number, right: number, bottom: number): ClosedPath => ({
  start: pt(left, top),
  segments: [
    { kind: 'line', to: pt(right, top) },
    { kind: 'line', to: pt(right, bottom) },
    { kind: 'line', to: pt(left, bottom) },
    { kind: 'line', to: pt(left, top) },
  ],
})

/** One free-standing Wall segment, away from everything the fixture draws. */
const chain = (viewId: string | null = VIEW): Intent =>
  intent(
    'wall.createChain',
    {
      floorId: FLOOR,
      walls: [{ line: { kind: 'line', start: pt(9000, 9000), end: pt(12000, 9000) }, thickness: 100, justification: 'centre', baseElevation: 0, height: 2400 }],
      starts: [{ kind: 'free' }],
      ends: [{ kind: 'free' }],
      target: { designOptionId: null, ...(viewId === null ? {} : { viewId }) },
    },
    ['new-wall'],
  )

const room = (viewId: string | null = VIEW): Intent =>
  intent('room.create', { floorId: FLOOR, outline: { kind: 'path', path: rect(30000, 30000, 34000, 32000) }, name: 'Store', target: { designOptionId: null, viewId } }, [
    'new-room',
    'new-room-e1',
    'new-room-e2',
    'new-room-e3',
    'new-room-e4',
  ])

const opening = (viewId: string | null = VIEW): Intent =>
  intent('opening.create', { floorId: FLOOR, hostWallId: 'wall-1', kind: 'window', label: 'Window 1', start: 2500, width: 900, sill: 900, head: 2100, target: { designOptionId: null, viewId } }, [
    'new-opening',
  ])

const placed = (viewId: string | null = VIEW): Intent =>
  intent('plan.placeDesign', { floorId: FLOOR, itemDesignId: 'design-2', target: { designOptionId: null, viewId } }, ['new-placed'])

/** The record a creation Intent wrote, whatever kind of record it was. */
function created(project: Project, id: string): { drawingLayerId?: string | null } {
  const model = project.existingModel
  const found = [
    ...model.walls,
    ...model.openings,
    ...model.rooms,
    ...model.placedItems,
  ].find((record) => record.id === id)
  if (found === undefined) throw new Error(`no record ${id} was written`)
  return found
}

function filed(project: Project, next: Intent, id: string): string | null | undefined {
  const result = applyIntent(project, next)
  if (!result.ok) throw new Error(`the creation was refused: ${result.code}`)
  return created(result.project, id).drawingLayerId
}

describe('the subtype default (#71 §2)', () => {
  it('files a new Wall, Opening and Room on Structure', () => {
    const project = layered()
    expect(filed(project, chain(), 'new-wall')).toBe(STRUCTURE)
    expect(filed(project, opening(), 'new-opening')).toBe(STRUCTURE)
    expect(filed(project, room(), 'new-room')).toBe(STRUCTURE)
  })

  it('files a new Placed Item on Furniture', () => {
    expect(filed(layered(), placed(), 'new-placed')).toBe(FURNITURE)
  })

  it('matches the name case-insensitively, the way every other name rule does', () => {
    const project = layered()
    const renamed = { ...project, drawingLayers: project.drawingLayers?.map((layer) => (layer.id === STRUCTURE ? { ...layer, name: 'structure' } : layer)) }
    expect(filed(renamed, chain(), 'new-wall')).toBe(STRUCTURE)
  })

  it('takes the front-most layer when two carry the default name', () => {
    const project = layered()
    const twin = { ...project, drawingLayers: [...(project.drawingLayers ?? []), { id: 'layer-twin', name: 'Structure', color: '#123456' }] }
    expect(filed(twin, chain(), 'new-wall')).toBe('layer-twin')
  })

  it('leaves the record Unlayered when there is no default and no active layer, and recreates nothing', () => {
    const project = layered()
    const stripped = { ...project, drawingLayers: project.drawingLayers?.filter((layer) => layer.name !== 'Structure') }
    const result = applyIntent(stripped, chain())
    if (!result.ok) throw new Error(`the creation was refused: ${result.code}`)
    // Absent and `null` read the same; omitting it keeps a Project with no layers byte-identical.
    expect('drawingLayerId' in created(result.project, 'new-wall')).toBe(false)
    expect(canonicalJson(result.project.drawingLayers)).toBe(canonicalJson(stripped.drawingLayers))
  })

  it('falls back to the view’s active layer once the default layer is renamed away', () => {
    // Criterion 2's own story: `Structure` becomes `Fabric`, and a new Wall follows the active layer.
    const renamed = { ...layered(), drawingLayers: LAYERS.map((layer) => (layer.id === STRUCTURE ? { ...layer, name: 'Fabric' } : layer)) }
    expect(filed(withActive(renamed, VIEW, SERVICES), chain(), 'new-wall')).toBe(SERVICES)
    expect(filed(withActive(renamed, VIEW, FURNITURE), opening(), 'new-opening')).toBe(FURNITURE)
  })

  it('still files content when no saved view is in play', () => {
    // A Project-level surface has no per-view setting to consult, so the Project's layer decides.
    const project = withSetting(layered(), VIEW, STRUCTURE, { editable: false })
    expect(filed(project, chain(null), 'new-wall')).toBe(STRUCTURE)
    expect(filed(project, placed(null), 'new-placed')).toBe(FURNITURE)
  })

  it('files the new record and undoes it byte-identically', () => {
    const project = layered()
    const next = expectRoundTrip(project, placed())
    expect(created(next.project, 'new-placed').drawingLayerId).toBe(FURNITURE)
  })
})

describe('creating into a read-only layer (#71 §2)', () => {
  const notice = (name: string): string => `${name} is read-only in this view. Make it editable or choose another active layer.`

  it('refuses the whole creation and changes nothing', () => {
    const project = withSetting(layered(), VIEW, STRUCTURE, { editable: false })
    const rejection = previewIntent(project, chain())
    expect(rejection.rejection?.code).toBe('layer-blocked')
    expect(rejection.rejection?.problems[0]?.message).toBe(notice('Structure'))
    // Nothing was committed: a refusal carries no patches at all, and the Project the draft was made
    // from is untouched — the work is thrown away, never written back.
    const before = canonicalJson(project)
    expect(applyIntent(project, chain()).ok).toBe(false)
    expect(canonicalJson(project)).toBe(before)
    expect(applyIntent(project, chain()).ok).toBe(false)
  })

  it('refuses each kind of content by the layer it would have landed on', () => {
    const cases: [Intent, string, string][] = [
      [chain(), STRUCTURE, 'Structure'],
      [opening(), STRUCTURE, 'Structure'],
      [room(), STRUCTURE, 'Structure'],
      [placed(), FURNITURE, 'Furniture'],
    ]
    for (const [next, key, name] of cases) {
      const project = withSetting(layered(), VIEW, key, { editable: false })
      const rejection = previewIntent(project, next).rejection
      expect(rejection?.code, name).toBe('layer-blocked')
      expect(rejection?.problems[0]?.message, name).toBe(notice(name))
    }
  })

  it('refuses when the read-only layer is the active fallback rather than the named default', () => {
    // No `Structure` layer at all, so the Wall would land on the view's active layer — which this
    // view has made read-only. Redirecting it somewhere else would be the silent move §2 forbids.
    const project: Project = {
      ...layered(),
      drawingLayers: [{ id: SERVICES, name: 'Services', color: '#5fb3ff' }],
      views: base.views.map((view) =>
        view.id === VIEW
          ? { ...view, activeLayerId: SERVICES, layerSettings: { [SERVICES]: { visible: true, selectable: true, editable: false } } }
          : view,
      ),
    }
    expect(previewIntent(project, chain()).rejection?.problems[0]?.message).toBe(notice('Services'))
    expect(applyIntent(project, chain()).ok).toBe(false)
  })

  it('refuses a Placed Item whose Furniture layer is read-only here', () => {
    const project = withSetting(layered(), VIEW, FURNITURE, { editable: false })
    expect(previewIntent(project, placed()).rejection?.code).toBe('layer-blocked')
    // …in this view only: the other saved view says nothing, so it still places.
    expect(filed(project, placed('view-1'), 'new-placed')).toBe(FURNITURE)
  })

  it('refuses before any of a multi-segment chain is drawn', () => {
    const project = withSetting(layered(), VIEW, STRUCTURE, { editable: false })
    const two = intent(
      'wall.createChain',
      {
        floorId: FLOOR,
        walls: [
          { line: { kind: 'line', start: pt(9000, 9000), end: pt(12000, 9000) }, thickness: 100, justification: 'centre', baseElevation: 0, height: 2400 },
          { line: { kind: 'line', start: pt(12000, 9000), end: pt(12000, 11000) }, thickness: 100, justification: 'centre', baseElevation: 0, height: 2400 },
        ],
        starts: [{ kind: 'free' }, { kind: 'segment', index: 0, end: 'end' }],
        ends: [{ kind: 'segment', index: 1, end: 'start' }, { kind: 'free' }],
        target: { designOptionId: null, viewId: VIEW },
      },
      ['wall-a', 'wall-b', 'junction-a'],
    )
    expect(previewIntent(project, two).rejection?.code).toBe('layer-blocked')
    expect(applyIntent(project, two).ok).toBe(false)
  })
})
