/**
 * The Project family (#47 criteria 3–5): `createProject` and `project.rename`.
 *
 * These two are the whole of what a Project itself can hold in v1 — a name and a set of
 * Floors — so the interesting part is what `createProject` must reproduce: the Project the
 * legacy "New Project" button made, in domain vocabulary.
 */
import { describe, expect, it } from 'vitest'
import { validateProject } from '../../domain'
import { canonicalJson } from '../../lib'
import { applyIntent } from '../apply'
import { createProject } from '../create'
import { LEGACY_DEFAULT_SETTINGS } from '../defaults'
import { NOW, deepFreeze, expectDeterministic, expectRejection, expectRoundTrip, idSource, intent, newProject } from '../testing'

describe('createProject', () => {
  it('makes the Project "New Project" made, in domain vocabulary', () => {
    const ids = idSource('create')(6)
    const [projectId, floorId, viewId, itemDesignId, placedItemId, rootNodeId] = ids
    const project = createProject({ ids, now: NOW, name: 'Kitchen' })

    expect(validateProject(project).ok, JSON.stringify(validateProject(project))).toBe(true)
    expect(project).toMatchObject({
      id: projectId,
      meta: { name: 'Kitchen' },
      floors: [{ id: floorId, name: 'Floor 1', planImage: null }],
      // A Floor and the one Plan View that shows it are one decision (#56).
      views: [{ id: viewId, kind: 'plan', floorId, name: 'Floor 1', isDefault: true, showPlanImage: true }],
      itemDesigns: [
        {
          id: itemDesignId,
          kind: 'cabinet',
          name: 'Unit 1',
          construction: { settings: LEGACY_DEFAULT_SETTINGS, root: { id: rootNodeId, elementType: 'void' } },
        },
      ],
    })
    // Legacy `x = 0, y = 0` is the unit's top-left corner; the placement holds its centre.
    expect(project.existingModel.placedItems).toEqual([
      {
        id: placedItemId,
        itemDesignId,
        floorId,
        translation: { x: 300, y: 250 },
        rotationDeg: 0,
        baseElevation: 0,
      },
    ])
  })

  it('spends exactly the six IDs it is given, in the order it states', () => {
    const ids = idSource('create')
    const spent = [...ids(6)]
    const project = createProject({ ids: spent, now: NOW, name: 'A' })
    expect(project.views[0]!.id).toBe(spent[2])
    expect(canonicalJson(project.existingModel.placedItems[0]!.id)).toBe(JSON.stringify(spent[4]))
    expect(() => createProject({ ids: ids(5), now: NOW, name: 'A' })).toThrowError(/spends 6 pre-allocated IDs/)
  })
})

describe('project.rename', () => {
  it('renames the Project and touches nothing else', () => {
    const project = newProject('Kitchen')
    const result = expectRoundTrip(project, intent('project.rename', { name: 'Galley' }))

    expect(result.project.meta.name).toBe('Galley')
    expect(canonicalJson({ ...result.project, meta: project.meta })).toBe(canonicalJson(project))
    expect(result.affected).toEqual({ floorId: null, viewId: null, view: 'cabinet', itemDesignIds: [], placedItemIds: [] })
    expect(result.patches).toEqual([{ op: 'replace', path: ['meta', 'name'], value: 'Galley' }])
  })

  it('refuses to record a rename that renames nothing', () => {
    const project = newProject('Galley')
    expectRejection(project, intent('project.rename', { name: 'Galley' }), 'no-change')
  })

  it('refuses a name that is only whitespace, as an invalid Project', () => {
    const project = deepFreeze(newProject())
    expectRejection(project, intent('project.rename', { name: '   ' }), 'invalid-project')
  })

  it('is deterministic', () => {
    expectDeterministic(newProject(), intent('project.rename', { name: 'Galley' }))
  })
})

describe('project.setPreferences', () => {
  it('writes the display preferences and touches nothing else', () => {
    const project = newProject('Kitchen')
    const result = expectRoundTrip(project, intent('project.setPreferences', { displayUnit: 'cm', displayPrecision: 1 }))

    expect(result.project.preferences).toEqual({ displayUnit: 'cm', displayPrecision: 1, defaultWallHeight: 2600 })
    expect(canonicalJson({ ...result.project, preferences: project.preferences })).toBe(canonicalJson(project))
    // Undo lands on the first Floor's Plan View, where the dialog was opened from (#55).
    expect(result.affected).toEqual({
      floorId: project.floors[0]!.id,
      viewId: null, view: 'plan',
      itemDesignIds: [],
      placedItemIds: [],
    })
    expect(result.patches).toEqual([
      { op: 'replace', path: ['preferences', 'displayUnit'], value: 'cm' },
      { op: 'replace', path: ['preferences', 'displayPrecision'], value: 1 },
    ])
  })

  it('refuses to record a change that changes nothing', () => {
    expectRejection(newProject(), intent('project.setPreferences', { displayUnit: 'mm', displayPrecision: 0 }), 'no-change')
  })

  it('refuses a precision outside 0–4, as an invalid Project', () => {
    const project = deepFreeze(newProject())
    expectRejection(project, intent('project.setPreferences', { displayUnit: 'mm', displayPrecision: 5 }), 'invalid-project')
  })

  it('is deterministic', () => {
    expectDeterministic(newProject(), intent('project.setPreferences', { displayUnit: 'm', displayPrecision: 3 }))
  })
})

describe('an Intent the catalogue does not know', () => {
  it('is refused rather than crashing', () => {
    const project = deepFreeze(newProject())
    const invented = { ...intent('project.rename', { name: 'X' }), type: 'project.melt' } as never
    const result = applyIntent(project, invented)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('unknown-target')
    expect(result.problems[0]!.message).toContain('project.melt')
  })
})
