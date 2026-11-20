/**
 * The scope sentence and the Cut List's starting states (#62 criterion 7, criterion 13).
 *
 * The summary next to the Export button is the last thing a person reads before a file leaves the
 * building, so it is generated from the scope they selected and not from what the writer happened
 * to emit — and it is four controls in a fixed order, so a Project with one Floor reads
 * differently from one where every Floor is in scope. These are the exact words, because "close"
 * in a summary is a different export.
 */
import { describe, expect, test } from 'vitest'
import { basicProject, referenceProject } from '../derive/testing'
import { quantities } from '../derive'
import type { Project } from '../domain'
import { defaultCutListStates, describeScope } from './scope'
import type { QuantityScope } from '../derive'

/** Every Floor, the Existing Model alone, every Renovation State, every layer. */
function scopeFor(project: Project, over: Partial<QuantityScope> = {}): QuantityScope {
  return {
    floorIds: project.floors.map((floor) => floor.id),
    designOptionIds: 'existing-only',
    renovationStates: ['existing', 'demolition', 'proposed'],
    drawingLayers: 'all',
    ...over,
  }
}

describe('describeScope', () => {
  test('names every Floor when the scope covers them all (#62 criterion 13)', () => {
    const project = referenceProject()
    expect(describeScope(scopeFor(project), project)).toBe(
      'All Floors · Existing only · Existing, Demolition, Proposed · all layers incl. Unlayered',
    )
  })

  test('names the one Floor when the scope is one Floor (#62 criterion 13)', () => {
    const project = basicProject()
    const one = scopeFor(project, {
      floorIds: [project.floors[0]!.id],
      renovationStates: ['existing'],
    })
    expect(describeScope(one, project)).toBe('Floor 1 · Existing only · Existing · all layers incl. Unlayered')
  })

  test('lists the Floors it names when that is not all of them', () => {
    const project = referenceProject()
    const two = scopeFor(project, { floorIds: project.floors.slice(0, 2).map((floor) => floor.id) })
    const names = project.floors.slice(0, 2).map((floor) => floor.name).join(', ')
    expect(describeScope(two, project)).toContain(names)
    expect(describeScope(two, project)).not.toContain('All Floors')
  })

  test('says which layers once they are narrowed, and whether Unlayered came along', () => {
    const project = basicProject()
    const narrowed = scopeFor(project, { drawingLayers: { layerIds: ['layer-a'], includeUnlayered: true } })
    expect(describeScope(narrowed, project)).toMatch(/selected layers incl\. Unlayered$/)
    expect(describeScope(scopeFor(project, { drawingLayers: { layerIds: ['layer-a'], includeUnlayered: false } }), project))
      .toMatch(/selected layers$/)
  })

  test('ignores a Floor the Project does not have', () => {
    const project = basicProject()
    const scope = scopeFor(project, { floorIds: [project.floors[0]!.id, 'floor-gone'] })
    expect(describeScope(scope, project)).toBe('Floor 1 · Existing only · Existing, Demolition, Proposed · all layers incl. Unlayered')
  })

  test('changes its words when the scope narrows, and the rows narrow with it (#62 criterion 13)', () => {
    const project = referenceProject()
    const all = scopeFor(project)
    const cabinet = quantities(project, 1, all).cuts[0]!.itemDesignId
    const one = scopeFor(project, { itemDesignId: cabinet })
    // The Item Detail narrowing is not one of the four controls, so the sentence is the same and
    // only the rows narrow (export contract §7).
    expect(describeScope(one, project)).toBe(describeScope(all, project))
    expect(quantities(project, 1, one).cuts.length).toBeLessThan(quantities(project, 1, all).cuts.length)
    expect(quantities(project, 1, one).cuts.every((row) => row.itemDesignId === cabinet)).toBe(true)
    // A Floor narrowed to one of several is the case the sentence exists to catch.
    const oneFloor = scopeFor(project, { floorIds: [project.floors[0]!.id] })
    expect(describeScope(oneFloor, project)).not.toBe(describeScope(all, project))
    expect(quantities(project, 1, oneFloor).items.length).toBeLessThan(quantities(project, 1, all).items.length)
  })
})

describe('defaultCutListStates', () => {
  test('starts on the Existing Model while there is no Design Option (#62 criterion 7)', () => {
    expect(defaultCutListStates({ designOptionIds: 'existing-only' })).toEqual(['existing'])
    expect(defaultCutListStates({ designOptionIds: [] })).toEqual(['existing'])
  })

  test('starts on the Proposed Model once an option is in scope (#62 criterion 7)', () => {
    expect(defaultCutListStates({ designOptionIds: ['option-1'] })).toEqual(['proposed'])
    expect(defaultCutListStates({ designOptionIds: ['option-1', 'option-2'] })).toEqual(['proposed'])
  })
})
