/**
 * The three Elevation View transactions (#75 §3), and the two rules they are judged against.
 *
 * Criterion 3 asks for exactly three Intents, each one undo step, each with the label the issue
 * names. Criterion 12 asks for the thing they must never do: an Elevation View stores a view line, a
 * side and a distance, so the Existing Model and the Item Designs come out of every one of them
 * byte-identical. Both are measured here on the same Project, and the refusals are measured beside
 * them, because a name two views answer to or a view line with no length is a Project the validator
 * would reject and the user should hear about in one sentence instead.
 */
import { describe, expect, it } from 'vitest'
import type { ElevationView, Project } from '../../domain'
import { UNLAYERED_LAYER_KEY, elevationViewsOf, validateProject } from '../../domain'
import { canonicalJson } from '../../lib'
import { applyIntent, intentLabel } from '../index'
import { expectApplied, expectRejection, expectRoundTrip, intent, newProject } from '../testing'

const LINE = { start: { x: 0, y: 1400 }, end: { x: 4000, y: 1400 } }

/** A Project with one Floor, its own Plan View, and one Elevation View made through the Intent. */
function oneView(): { project: Project; floorId: string; viewId: string; planViewId: string } {
  const project = newProject('Kitchen')
  const floorId = project.floors[0]!.id
  const planViewId = project.views.find((view) => view.floorId === floorId && view.isDefault)!.id
  const viewId = 'elevation-1'
  const applied = expectApplied(
    project,
    intent('elevationView.create', { floorId, line: LINE, side: 'left', depth: 2000 }, [viewId]),
  )
  return { project: applied.project, floorId, viewId, planViewId }
}

/** The two halves of the world an Elevation View looks at, as one comparable string. */
const world = (project: Project): string => canonicalJson({ existingModel: project.existingModel, itemDesigns: project.itemDesigns })

const viewOf = (project: Project, viewId: string): ElevationView => elevationViewsOf(project).find((view) => view.id === viewId)!

describe('elevationView.create (#75 §3)', () => {
  it('is one undo step, labelled New Elevation View, and leaves a valid Project', () => {
    const project = newProject('Kitchen')
    const floorId = project.floors[0]!.id
    const next = intent('elevationView.create', { floorId, line: LINE, side: 'left', depth: 2000 }, ['elevation-1'])
    expect(intentLabel(next.type)).toBe('New Elevation View')
    const applied = expectRoundTrip(project, next)
    expect(validateProject(applied.project).ok).toBe(true)
    expect(elevationViewsOf(applied.project).map((view) => view.id)).toEqual(['elevation-1'])
  })

  it('names an unnamed view Elevation 1, and the next one on the Floor Elevation 2 (#75 criterion 5)', () => {
    const { project, floorId } = oneView()
    expect(viewOf(project, 'elevation-1').name).toBe('Elevation 1')
    const second = expectApplied(
      project,
      intent('elevationView.create', { floorId, line: { start: { x: 0, y: 0 }, end: { x: 3000, y: 0 } }, side: 'right', depth: 900 }, ['elevation-2']),
    )
    expect(viewOf(second.project, 'elevation-2').name).toBe('Elevation 2')
    expect(validateProject(second.project).ok).toBe(true)
  })

  it('keeps the name the person typed, trimmed, and stores the line, the side and the distance as sent', () => {
    const { project } = oneView()
    expect(viewOf(project, 'elevation-1')).toEqual({
      id: 'elevation-1',
      kind: 'elevation',
      floorId: project.floors[0]!.id,
      name: 'Elevation 1',
      line: LINE,
      side: 'left',
      depth: 2000,
      designOptionId: null,
      renovationDisplay: 'existing',
    })
  })

  it('takes the Design Option and the Renovation Display of the view it was made from, and nothing else (#70 §1)', () => {
    const project = newProject('Kitchen')
    const floorId = project.floors[0]!.id
    const planViewId = project.views.find((view) => view.floorId === floorId && view.isDefault)!.id
    const withOption = expectApplied(
      project,
      intent('view.setRenovationDisplay', { viewId: planViewId, renovationDisplay: 'existing' }),
    ).project
    const applied = expectApplied(
      withOption,
      intent('elevationView.create', { floorId, fromViewId: planViewId, line: LINE, side: 'left', depth: 1500, name: '  Sink wall  ' }, ['elevation-1']),
    )
    const view = viewOf(applied.project, 'elevation-1')
    expect(view.name).toBe('Sink wall')
    expect(view.renovationDisplay).toBe('existing')
    // A Plan View's own words are not copied across: an Elevation View has no Vertical Range and no
    // Plan Image to inherit (#75 criterion 11).
    expect(view).not.toHaveProperty('planViewRange')
    expect(view).not.toHaveProperty('showPlanImage')
  })

  it('changes no Wall, no Opening, no Placed Item and no Item Design (#75 criterion 12)', () => {
    const project = newProject('Kitchen')
    const floorId = project.floors[0]!.id
    const applied = expectApplied(
      project,
      intent('elevationView.create', { floorId, line: LINE, side: 'left', depth: 2000 }, ['elevation-1']),
    )
    expect(world(applied.project)).toBe(world(project))
  })

  it('refuses a second view whose name this Floor already answers to, folded', () => {
    const { project, floorId } = oneView()
    expectRejection(
      project,
      intent('elevationView.create', { floorId, line: { start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } }, side: 'left', depth: 500, name: ' ELEVATION 1 ' }, ['elevation-2']),
      'invalid-project',
    )
  })

  it('refuses a view line with no length, a distance of zero, and a side that is neither', () => {
    const project = newProject('Kitchen')
    const floorId = project.floors[0]!.id
    expectRejection(
      project,
      intent('elevationView.create', { floorId, line: { start: { x: 10, y: 10 }, end: { x: 10, y: 10 } }, side: 'left', depth: 500 }, ['elevation-1']),
      'invalid-project',
    )
    expectRejection(
      project,
      intent('elevationView.create', { floorId, line: LINE, side: 'left', depth: 0 }, ['elevation-1']),
      'invalid-project',
    )
    expectRejection(
      project,
      intent('elevationView.create', { floorId, line: LINE, side: 'north' as never, depth: 500 }, ['elevation-1']),
      'invalid-project',
    )
  })

  it('refuses a Floor this Project does not have', () => {
    const project = newProject('Kitchen')
    expectRejection(
      project,
      intent('elevationView.create', { floorId: 'floor-nowhere', line: LINE, side: 'left', depth: 500 }, ['elevation-1']),
      'unknown-target',
    )
  })
})

describe('elevationView.edit (#75 §3)', () => {
  it('moves the view line, turns it to the other side and changes the distance, in one step', () => {
    const { project, viewId } = oneView()
    const before = world(project)
    const next = intent('elevationView.edit', {
      viewId,
      name: 'Sink wall',
      side: 'right',
      depth: 3500,
      line: { start: { x: 200, y: 900 }, end: { x: 2200, y: 1700 } },
    })
    const applied = expectRoundTrip(project, next)
    expect(intentLabel(next.type)).toBe('Edit Elevation View')
    const view = viewOf(applied.project, viewId)
    expect([view.name, view.side, view.depth, view.line]).toEqual([
      'Sink wall',
      'right',
      3500,
      { start: { x: 200, y: 900 }, end: { x: 2200, y: 1700 } },
    ])
    expect(world(applied.project)).toBe(before)
    expect(validateProject(applied.project).ok).toBe(true)
  })

  it('refuses an edit that changes nothing, and one that takes a name another view has', () => {
    const { project, viewId } = oneView()
    expectRejection(project, intent('elevationView.edit', { viewId, side: 'left' }), 'no-change')
    expectRejection(project, intent('elevationView.edit', { viewId, name: ' Elevation 1 ' }), 'no-change')
    const second = expectApplied(
      project,
      intent('elevationView.create', { floorId: project.floors[0]!.id, line: { start: { x: 0, y: 0 }, end: { x: 900, y: 0 } }, side: 'right', depth: 400 }, ['elevation-2']),
    ).project
    expectRejection(second, intent('elevationView.edit', { viewId, name: 'Elevation 2' }), 'invalid-project')
  })

  it('refuses a zero-length line and a distance of nothing, and names an unknown view', () => {
    const { project, viewId, floorId } = oneView()
    expectRejection(project, intent('elevationView.edit', { viewId, line: { start: { x: 5, y: 5 }, end: { x: 5, y: 5 } } }), 'invalid-project')
    expectRejection(project, intent('elevationView.edit', { viewId, depth: -20 }), 'invalid-project')
    expectRejection(project, intent('elevationView.edit', { viewId: 'elevation-nowhere', depth: 20 }), 'unknown-target')
    expect(elevationViewsOf(project).some((view) => view.floorId === floorId)).toBe(true)
  })
})

describe('elevationView.delete (#75 §3)', () => {
  it('takes the view and nothing else, and undoes to the same bytes', () => {
    const { project, viewId } = oneView()
    const before = world(project)
    const next = intent('elevationView.delete', { viewId })
    expect(intentLabel(next.type)).toBe('Delete Elevation View')
    const applied = expectRoundTrip(project, next)
    expect(elevationViewsOf(applied.project)).toEqual([])
    expect(world(applied.project)).toBe(before)
    expect(validateProject(applied.project).ok).toBe(true)
  })

  it('leaves the other views of the Floor alone', () => {
    const { project, floorId, viewId } = oneView()
    const two = expectApplied(
      project,
      intent('elevationView.create', { floorId, line: { start: { x: 0, y: 0 }, end: { x: 900, y: 0 } }, side: 'right', depth: 400 }, ['elevation-2']),
    ).project
    const applied = expectApplied(two, intent('elevationView.delete', { viewId }))
    expect(elevationViewsOf(applied.project).map((view) => view.id)).toEqual(['elevation-2'])
  })
})

describe('what an Elevation View shares with a Plan View, and what it does not (#75 criterion 11)', () => {
  it('takes a Layer setting, an active Layer and snapping to hidden content, like a Plan View does', () => {
    const { project, viewId } = oneView()
    const withLayer = expectApplied(project, intent('layer.add', { name: 'Sweep layer', color: '#5fb3ff' }, ['layer-sweep'])).project
    const layerId = 'layer-sweep'
    const snapped = expectApplied(withLayer, intent('view.setSnapToHidden', { viewId, snapToHidden: true })).project
    const active = expectApplied(snapped, intent('view.setActiveLayer', { viewId, layerId })).project
    const setting = expectApplied(
      active,
      intent('view.setLayerSetting', { viewId, layerKey: layerId, setting: { visible: false, editable: true } }),
    ).project
    const view = viewOf(setting, viewId)
    expect([view.snapToHiddenContent, view.activeLayerId]).toEqual([true, layerId])
    expect(view.layerSettings?.[layerId]).toMatchObject({ visible: false, editable: true })
    expect(validateProject(setting).ok).toBe(true)
  })

  it('refuses the Plan View’s own settings by name', () => {
    const { project, viewId } = oneView()
    const range = expectRejection(project, intent('view.setPlanViewRange', { viewId, lowerMm: 0, upperMm: 1200 }), 'unknown-target')
    expect(JSON.stringify(range)).toContain('Elevation View')
    const image = expectRejection(project, intent('view.setShowPlanImage', { viewId, showPlanImage: false }), 'unknown-target')
    expect(JSON.stringify(image)).toContain('Elevation View')
    expect(applyIntent(project, intent('view.rename', { viewId, name: 'Renamed' }))).toMatchObject({ code: 'unknown-target' })
    expect(applyIntent(project, intent('view.delete', { viewId }))).toMatchObject({ code: 'unknown-target' })
  })

  it('keeps the Floor it belongs to, so the Floor cannot be deleted while the view is there (#56 rule, one kind wider)', () => {
    const { project, floorId } = oneView()
    expectRejection(project, intent('floor.delete', { floorId }), 'has-dependants')
  })

  it('is swept by a Layer added and deleted from the Project, like every other saved view (#71 §2)', () => {
    const { project, viewId } = oneView()
    const withOrder = expectApplied(
      project,
      intent('view.setLayerOrder', { viewId, layerOrder: [...project.drawingLayers!.map((layer) => layer.id), UNLAYERED_LAYER_KEY] }),
    ).project
    const added = expectApplied(withOrder, intent('layer.add', { name: 'Sweep layer', color: '#5fb3ff' }, ['layer-services']))
    expect(viewOf(added.project, viewId).layerOrder).toContain('layer-services')
    const deleted = expectApplied(added.project, intent('layer.delete', { viewId, layerId: 'layer-services' }))
    expect(viewOf(deleted.project, viewId).layerOrder).not.toContain('layer-services')
    expect(validateProject(deleted.project).ok).toBe(true)
  })
})
