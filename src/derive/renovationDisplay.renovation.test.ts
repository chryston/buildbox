/**
 * The Renovation Display funnel (#70 §4, criteria 7–9).
 *
 * One Option over one Floor, read four ways. The Floor holds two Walls, one Opening, two Rooms and
 * three Placed Items; the Option knocks out `wall-2` and `place-0` and proposes `prop-wall` plus
 * `prop-item`. Every assertion below is about which of those nine things a Display draws and what
 * State it draws them as — the model is never copied, so a Display cannot invent or lose an entity.
 */
import { describe, expect, it } from 'vitest'
import roomsFixture from '../../fixtures/domain/v7/rooms.json?raw'
import type { DesignOption, PlacedItem, Project, RenovationDisplay, Wall } from '../domain'
import { UNLAYERED_LAYER_KEY } from '../domain'
import { effectiveModel, entityLayerKeys } from './index'
import { displayCounts, displayModel, displayStates } from './index'
import { domainFixture } from './testing'

const envelope = JSON.parse(roomsFixture) as { project: Project }

const wall = (id: string): Wall => ({ ...envelope.project.existingModel.walls[0]!, id })
const item = (id: string): PlacedItem => ({ ...envelope.project.existingModel.placedItems[0]!, id })

/** The Option the scene needs: two demolition records, one proposed Wall, one proposed Item. */
const option: DesignOption = {
  id: 'option-a',
  name: 'Option A · Open kitchen',
  demolishedIds: ['wall-2', 'place-0'],
  proposed: {
    walls: [wall('prop-wall')],
    wallJunctions: [],
    openings: [],
    rooms: [],
    beams: [],
    placedItems: [item('prop-item')],
  },
}

function project(withOption: boolean): Project {
  return { ...envelope.project, designOptions: withOption ? [option] : [] }
}

/** `wall-1=existing wall-2=demolition` — the shape of one collection, in paint order. */
function shape(rows: readonly { entity: { id: string }; renovationState: string }[]): string[] {
  return rows.map((row) => `${row.entity.id}=${row.renovationState}`)
}

const displays: RenovationDisplay[] = ['existing', 'demolition', 'proposed', 'combined']

function wallsOf(display: RenovationDisplay, withOption = true): string[] {
  return shape(displayModel(effectiveModel(project(withOption), 'floor-0', withOption ? 'option-a' : null), display).walls)
}

describe('the four Displays over one Option (#70 criteria 7, 8)', () => {
  it('Existing draws the Existing Model as it is today, including what the Option knocks out', () => {
    // `wall-2` is demolished by the Option and still drawn as Existing: this Display answers
    // "what is there today", and the Option's opinion about it belongs to the other three.
    expect(wallsOf('existing')).toEqual(['wall-1=existing', 'wall-2=existing'])
    const drawn = displayModel(effectiveModel(project(true), 'floor-0', 'option-a'), 'existing')
    expect(shape(drawn.placedItems)).toEqual(['place-0=existing', 'place-1=existing', 'place-3=existing'])
    expect(drawn.openings).toHaveLength(1)
    expect(drawn.rooms).toHaveLength(2)
    // Nothing Proposed is on this Display, in any State.
    expect(drawn.walls.some((row) => row.entity.id === 'prop-wall')).toBe(false)
    expect(drawn.placedItems.some((row) => row.entity.id === 'prop-item')).toBe(false)
  })

  it('Demolition keeps the Existing Model and strikes out only what this Option removes', () => {
    expect(wallsOf('demolition')).toEqual(['wall-1=existing', 'wall-2=demolition'])
    const drawn = displayModel(effectiveModel(project(true), 'floor-0', 'option-a'), 'demolition')
    expect(shape(drawn.placedItems)).toEqual(['place-1=existing', 'place-3=existing', 'place-0=demolition'])
    expect(drawn.walls.some((row) => row.entity.id === 'prop-wall')).toBe(false)
  })

  it('Proposed shows what would stand: the Existing Model minus the demolition, plus the Option', () => {
    expect(wallsOf('proposed')).toEqual(['wall-1=existing', 'prop-wall=proposed'])
    const drawn = displayModel(effectiveModel(project(true), 'floor-0', 'option-a'), 'proposed')
    expect(shape(drawn.placedItems)).toEqual(['place-1=existing', 'place-3=existing', 'prop-item=proposed'])
    // The two things being removed are not on this Display at all — not struck out, absent.
    expect(drawn.walls.some((row) => row.entity.id === 'wall-2')).toBe(false)
    expect(drawn.placedItems.some((row) => row.entity.id === 'place-0')).toBe(false)
  })

  it('Combined shows all three States, painted Existing then Demolition then Proposed', () => {
    expect(wallsOf('combined')).toEqual(['wall-1=existing', 'wall-2=demolition', 'prop-wall=proposed'])
    const drawn = displayModel(effectiveModel(project(true), 'floor-0', 'option-a'), 'combined')
    expect(shape(drawn.placedItems)).toEqual([
      'place-1=existing',
      'place-3=existing',
      'place-0=demolition',
      'prop-item=proposed',
    ])
  })

  it('counts what each Display draws, which is what the strip shows (#70 §5)', () => {
    const model = effectiveModel(project(true), 'floor-0', 'option-a')
    expect(displayCounts(model, 'existing')).toEqual({ walls: 2, wallJunctions: 0, openings: 1, rooms: 2, placedItems: 3, beams: 0, skirting: 0, services: 0 })
    expect(displayCounts(model, 'demolition')).toEqual({ walls: 2, wallJunctions: 0, openings: 1, rooms: 2, placedItems: 3, beams: 0, skirting: 0, services: 0 })
    expect(displayCounts(model, 'proposed')).toEqual({ walls: 2, wallJunctions: 0, openings: 1, rooms: 2, placedItems: 3, beams: 0, skirting: 0, services: 0 })
    expect(displayCounts(model, 'combined')).toEqual({ walls: 3, wallJunctions: 0, openings: 1, rooms: 2, placedItems: 4, beams: 0, skirting: 0, services: 0 })
  })
})

describe('a Display with no Design Option (#70 criterion 9)', () => {
  it('draws the Existing Model as Existing on all four Displays, with nothing from any Option', () => {
    for (const display of displays) {
      const drawn = displayModel(effectiveModel(project(true), 'floor-0', null), display)
      expect(shape(drawn.walls)).toEqual(['wall-1=existing', 'wall-2=existing'])
      expect(shape(drawn.placedItems)).toEqual(['place-0=existing', 'place-1=existing', 'place-3=existing'])
      expect(drawn.optionId).toBe(null)
      expect(displayCounts(effectiveModel(project(true), 'floor-0', null), display)).toEqual(
        displayCounts(effectiveModel(project(false), 'floor-0', null), 'existing'),
      )
    }
  })

  it('is the same rows the Existing Display draws with an Option open, minus the Option’s own', () => {
    // The rule is one table, not a special case: with no Option there is nothing tagged Demolition
    // or Proposed, so every Display collapses to the Existing Model.
    const bare = effectiveModel(project(true), 'floor-0', null)
    const rows = new Set(displays.map((display) => shape(displayModel(bare, display).walls).join(' ')))
    expect([...rows]).toEqual(['wall-1=existing wall-2=existing'])
  })
})

describe('a Display never reorders what the model holds', () => {
  it('keeps Existing-Model order inside each State, on every Display', () => {
    const model = effectiveModel(project(true), 'floor-0', 'option-a')
    for (const display of displays) {
      const drawn = displayModel(model, display).placedItems
      const states = drawn.map((row) => row.renovationState)
      expect(states).toEqual([...states].sort((a, b) => ['existing', 'demolition', 'proposed'].indexOf(a) - ['existing', 'demolition', 'proposed'].indexOf(b)))
      const existing = drawn.filter((row) => row.renovationState === 'existing').map((row) => row.entity.id)
      expect(existing).toEqual([...existing].sort())
    }
  })
})

/**
 * A Skirting in the Display's own two lists (#78 §5, §7): the map that says what is painted and in
 * which State, and the map that files each entity on its Drawing Layer. A strip left out of either is
 * a strip the canvas cannot paint, cannot hide, and cannot offer to the cycle.
 */
describe('a Skirting in the Display’s lists (#78 §5, §7)', () => {
  const SKIRTING = domainFixture('v13/skirting.json')
  const FLOOR = 'seed-001'
  const STRIP = 'skirting-1'

  it('carries its record’s Renovation State into the list the canvas paints from', () => {
    const states = displayStates(displayModel(effectiveModel(SKIRTING, FLOOR, null), 'existing'))
    expect(states.get(STRIP)).toBe('existing')
    // A strip an Option took down is still drawn, in the demolition overlay, so it is still in the
    // list — with the State that says so, which is what paints the hatching on it.
    const demolished: Project = {
      ...SKIRTING,
      designOptions: [{
        id: 'option-a',
        name: 'Option A',
        demolishedIds: [STRIP],
        proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], beams: [], skirting: [], placedItems: [] },
      }],
    }
    expect(displayStates(displayModel(effectiveModel(demolished, FLOOR, 'option-a'), 'combined')).get(STRIP)).toBe(
      'demolition',
    )
  })

  it('is filed on its own Drawing Layer, and on the unlayered key when it has none', () => {
    expect(entityLayerKeys(SKIRTING, FLOOR, null).get(STRIP)).toBe(UNLAYERED_LAYER_KEY)
    const filed: Project = {
      ...SKIRTING,
      existingModel: {
        ...SKIRTING.existingModel,
        skirting: SKIRTING.existingModel.skirting!.map((each) => (each.id === STRIP ? { ...each, drawingLayerId: 'layer-finishes' } : each)),
      },
    }
    expect(entityLayerKeys(filed, FLOOR, null).get(STRIP)).toBe('layer-finishes')
  })
})
