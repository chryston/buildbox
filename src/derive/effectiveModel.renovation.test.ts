import { describe, expect, it } from 'vitest'
import { designOptionName, effectiveModel } from './index'
import type { DesignOption, EntityId, Opening, PlacedItem, Project, Room, Wall, WallJunction } from '../domain'
import roomsFixture from '../../fixtures/domain/v7/rooms.json?raw'

// The effective model of #69 §5: this file runs in the
// `renovation` project (`npm run test:renovation`) and nowhere else, because a build without the
// flag cannot read an Option at all. The flag-off half is the whole existing derive suite, which
// derives the Existing Model byte-identically with `optionId` of `null`.

const envelope = JSON.parse(roomsFixture) as { project: Project }

/** The funnel reads `id` and `floorId` and nothing else, so a delta is written as those two. */
const entity = <T>(id: EntityId, floorId: EntityId): T => ({ id, floorId }) as T

function withOption(project: Project, option: DesignOption): Project {
  return { ...project, designOptions: [option] }
}

/** `Knock out W-2, put a new Wall and a new Room in their place.` */
const delta: DesignOption = {
  id: 'option-a',
  name: 'Open plan',
  demolishedIds: ['wall-2', 'room-1', 'place-0'],
  proposed: {
    walls: [entity<Wall>('wall-9', 'floor-0')],
    wallJunctions: [],
    openings: [entity<Opening>('opening-9', 'floor-0')],
    rooms: [entity<Room>('room-9', 'floor-0')],
    placedItems: [entity<PlacedItem>('place-9', 'floor-0')],
  },
}

const junctionOption: DesignOption = {
  ...delta,
  id: 'option-b',
  name: 'Keep the study',
  demolishedIds: [],
  proposed: { ...delta.proposed, wallJunctions: [{ ...entity<WallJunction>('junction-9', 'floor-0'), ends: [] }] },
}

describe('effectiveModel — the three Renovation States (#69 §5)', () => {
  it('is the Existing Model alone under no Option', () => {
    const project = envelope.project
    const model = effectiveModel(project, 'floor-0', null)
    const stored = project.existingModel.walls.filter((wall) => wall.floorId === 'floor-0')
    expect(model.optionId).toBe(null)
    expect(model.walls.map((row) => row.entity.id)).toEqual(stored.map((wall) => wall.id))
    expect(model.walls.every((row) => row.renovationState === 'existing')).toBe(true)
    expect(model.standingWalls).toEqual(stored)
    expect(model.standingPlacedItems).toEqual(project.existingModel.placedItems.filter((item) => item.floorId === 'floor-0'))
  })

  it('names every entity Existing, Demolition or Proposed', () => {
    const model = effectiveModel(withOption(envelope.project, delta), 'floor-0', 'option-a')
    expect(model.optionId).toBe('option-a')
    const stateOf = new Map(model.walls.map((row) => [row.entity.id, row.renovationState]))
    expect(stateOf.get('wall-1')).toBe('existing')
    expect(stateOf.get('wall-2')).toBe('demolition')
    expect(stateOf.get('wall-9')).toBe('proposed')
    expect(new Map(model.rooms.map((row) => [row.entity.id, row.renovationState])).get('room-1')).toBe('demolition')
    expect(new Map(model.openings.map((row) => [row.entity.id, row.renovationState])).get('opening-9')).toBe('proposed')
  })

  it('keeps Existing order, then the Option’s own work', () => {
    const model = effectiveModel(withOption(envelope.project, delta), 'floor-0', 'option-a')
    expect(model.walls.map((row) => row.entity.id)).toEqual(['wall-1', 'wall-2', 'wall-9'])
    expect(model.rooms.map((row) => row.entity.id)).toEqual(['room-1', 'room-2', 'room-9'])
  })

  it('leaves only what stands for every measurement to run on', () => {
    const project = withOption(envelope.project, delta)
    const model = effectiveModel(project, 'floor-0', 'option-a')
    expect(model.standingWalls.map((wall) => wall.id)).toEqual(['wall-1', 'wall-9'])
    expect(model.standingRooms.map((room) => room.id)).toEqual(['room-2', 'room-9'])
    expect(model.standingOpenings.map((opening) => opening.id)).toEqual(['opening-1', 'opening-9'])
    expect(model.standingPlacedItems.map((item) => item.id)).toEqual(
      project.existingModel.placedItems
        .filter((item) => item.floorId === 'floor-0' && item.id !== 'place-0')
        .map((item) => item.id)
        .concat('place-9'),
    )
  })

  it('reads one Floor at a time, or every Floor at once', () => {
    const project = envelope.project
    const onFloor1 = effectiveModel(project, 'floor-1', null)
    expect(onFloor1.walls).toEqual([])
    expect(onFloor1.rooms.map((row) => row.entity.id)).toEqual(['room-3'])
    const everywhere = effectiveModel(project, null, null)
    expect(everywhere.walls.length).toBe(project.existingModel.walls.length)
    expect(everywhere.rooms.length).toBe(project.existingModel.rooms.length)
  })

  it('answers an Option the Project does not have with the Existing Model', () => {
    const project = envelope.project
    const model = effectiveModel(project, 'floor-0', 'option-missing')
    expect(model.optionId).toBe(null)
    expect(model.walls.every((row) => row.renovationState === 'existing')).toBe(true)
  })

  it('leaves another Option’s demolition alone', () => {
    const project = withOption(envelope.project, junctionOption)
    const model = effectiveModel(project, 'floor-0', 'option-b')
    expect(model.walls.every((row) => row.renovationState !== 'demolition')).toBe(true)
    expect(model.wallJunctions.map((row) => [row.entity.id, row.renovationState])).toEqual([['junction-9', 'proposed']])
  })

  it('takes a Junction down with the Wall it stood on', () => {
    const joined: Project = {
      ...envelope.project,
      existingModel: {
        ...envelope.project.existingModel,
        wallJunctions: [
          { id: 'junction-kept', floorId: 'floor-0', ends: [{ wallId: 'wall-0', end: 'start' }, { wallId: 'wall-1', end: 'start' }] },
          { id: 'junction-down', floorId: 'floor-0', ends: [{ wallId: 'wall-2', end: 'end' }, { wallId: 'wall-1', end: 'end' }] },
        ],
      },
    }
    const model = effectiveModel(withOption(joined, delta), 'floor-0', 'option-a')
    // `wall-2` is gone, so the claim that its end met another Wall means nothing any more.
    expect(model.standingWallJunctions.map((junction) => junction.id)).toEqual(['junction-kept'])
    expect(model.standingWalls.some((wall) => wall.id === 'wall-2')).toBe(false)
  })
})

describe('designOptionName — the Design Option column (#69 §5)', () => {
  it('is the Option’s name, and empty for the Existing Model', () => {
    const project = withOption(envelope.project, delta)
    expect(designOptionName(project, 'option-a')).toBe('Open plan')
    expect(designOptionName(project, null)).toBe('')
    expect(designOptionName(project, 'option-missing')).toBe('')
  })
})
