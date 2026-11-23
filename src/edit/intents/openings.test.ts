/**
 * The Opening Intents (#65 §5, §6): place, move along the host, resize, flip, rename, delete.
 *
 * Every refusal here is asserted by its sentence as well as its code, because the sentence is
 * the acceptance criterion: one plain line that names the Opening and the Wall, no coordinates,
 * and nothing said about a Wall the homeowner did not touch. The numbers are the issue's own —
 * a 900 door at 2 100 on a free 3 000 mm Wall commits, and at 2 101 it does not.
 */
import { describe, expect, it } from 'vitest'
import type { Opening, Project, Wall, WallRefLine } from '../../domain'
import { pt } from '../../geometry'
import type { Intent, PayloadOf } from '../intents'
import {
  deepFreeze,
  expectApplied,
  expectDeterministic,
  expectRejection,
  expectRoundTrip,
  idSource,
  intent,
  layerNamed,
  newProject,
} from '../testing'

const line = (x1: number, y1: number, x2: number, y2: number): WallRefLine => ({
  kind: 'line',
  start: pt(x1, y1),
  end: pt(x2, y2),
})

const source = idSource('opening')
const floorIdOf = (project: Project): string => project.floors[0]!.id

/** One free-ended Wall, drawn by the Wall tool rather than written by hand. */
function host(length = 3000, thickness = 100): { project: Project; wall: Wall } {
  const project = newProject()
  const ids = source(1)
  const applied = expectApplied(
    project,
    intent(
      'wall.createChain',
      {
        floorId: floorIdOf(project),
        walls: [{ line: line(0, 0, length, 0), thickness, justification: 'centre', baseElevation: 0, height: 2600 }],
        starts: [{ kind: 'free' }],
        ends: [{ kind: 'free' }],
      },
      ids,
    ),
  )
  return { project: applied.project, wall: applied.project.existingModel.walls[0]! }
}

/** A 900 × 2 100 hinged door, the pack's bedroom entry resolved into the payload. */
function door(hostWall: Wall, start: number, over: Partial<Opening> = {}): PayloadOf<'opening.create'> {
  return {
    floorId: hostWall.floorId,
    hostWallId: hostWall.id,
    kind: 'door',
    label: 'Door 1',
    start,
    width: 900,
    sill: 0,
    head: 2100,
    swing: 'left',
    hingeSide: 'start',
    ...over,
  }
}

/** Place an Opening and hand back the Project that resulted. */
function place(project: Project, payload: PayloadOf<'opening.create'>): Project {
  return expectApplied(project, intent('opening.create', payload, source(1))).project
}

const openingsOf = (project: Project): Opening[] => project.existingModel.openings
const only = (project: Project): Opening => openingsOf(project)[0]!
const messageOf = (project: Project, next: Intent): string => {
  const rejection = expectRejection(project, next, 'opening-blocked')
  return rejection.problems[0]!.message
}

describe('opening.create', () => {
  it('cuts the Opening into the Wall it names, and spends one ID', () => {
    const { project, wall } = host()
    const applied = expectRoundTrip(deepFreeze(project), intent('opening.create', door(wall, 1000), source(1)))
    expect(openingsOf(applied.project)).toHaveLength(1)
    expect(only(applied.project)).toEqual({
      id: applied.project.existingModel.openings[0]!.id,
      floorId: wall.floorId,
      hostWallId: wall.id,
      kind: 'door',
      label: 'Door 1',
      start: 1000,
      width: 900,
      sill: 0,
      head: 2100,
      swing: 'left',
      hingeSide: 'start',
      // An Opening is Structure content, and the Project's `Structure` layer is where new Walls and
      // Openings are created (#71 §2).
      drawingLayerId: layerNamed(applied.project, 'Structure'),
    })
    // The Wall is untouched: an Opening is an absence, not an edit of the host.
    expect(applied.project.existingModel.walls).toEqual(project.existingModel.walls)
  })

  it('numbers each kind on its own, the way the inspector shows them', () => {
    const { project, wall } = host(6000)
    const withDoor = place(project, door(wall, 500))
    const withWindow = place(withDoor, {
      floorId: wall.floorId,
      hostWallId: wall.id,
      kind: 'window',
      label: 'Window 1',
      start: 2000,
      width: 1200,
      sill: 1050,
      head: 2300,
    })
    const withSecond = place(withWindow, door(wall, 4000, { label: 'Door 2' }))
    expect(openingsOf(withSecond).map((opening) => opening.label)).toEqual(['Door 1', 'Window 1', 'Door 2'])
  })

  it('takes the removed section at full height, sill on the Floor Datum', () => {
    const { project, wall } = host(4000)
    const placed = place(project, {
      floorId: wall.floorId,
      hostWallId: wall.id,
      kind: 'removed_section',
      label: 'Removed section 1',
      start: 1550,
      width: 900,
      sill: 0,
      head: 2600,
    })
    expect(only(placed).head).toBe(2600)
    expect(only(placed).swing).toBeUndefined()
  })

  it('refuses a door that would run past the end, in the words the tool shows', () => {
    const { project, wall } = host()
    const next = intent('opening.create', door(wall, 2101), source(1))
    expect(messageOf(project, next)).toBe('Door 1 would run past the end of W-1. Move or narrow it first.')
    expect(project.existingModel.openings).toEqual([])
  })

  it('lets a door end exactly on the free end of the host', () => {
    const { project, wall } = host()
    const placed = place(project, door(wall, 2100))
    expect(only(placed).start).toBe(2100)
  })

  it('refuses a door that would cross the join it is centred on, naming the branch', () => {
    const { project, wall } = host()
    const branch = expectApplied(
      project,
      intent(
        'wall.createChain',
        {
          floorId: floorIdOf(project),
          walls: [{ line: line(1500, 900, 1500, 2400), thickness: 100, justification: 'centre', baseElevation: 0, height: 2600 }],
          starts: [{ kind: 'host', wallId: wall.id }],
          ends: [{ kind: 'free' }],
        },
        source(2),
      ),
    ).project
    const branchRef = branch.existingModel.walls[1]!.ref
    const next = intent('opening.create', door(wall, 1050), source(1))
    expect(messageOf(branch, next)).toBe(`Door 1 would cross the join with ${branchRef}.`)
  })

  it('refuses a Wall shorter than the Opening at all', () => {
    const { project, wall } = host(2000)
    const next = intent('opening.create', door(wall, 100, { width: 2500 }), source(1))
    expect(messageOf(project, next)).toBe('This wall is shorter than a 2500 mm door.')
  })

  it('refuses a width of nothing, and a top below its bottom', () => {
    const { project, wall } = host()
    expectRejection(project, intent('opening.create', door(wall, 100, { width: 0 }), source(1)), 'invalid-opening')
    expectRejection(project, intent('opening.create', door(wall, 100, { head: 0 }), source(1)), 'invalid-opening')
  })

  it('refuses a window that says which way it opens', () => {
    const { project, wall } = host()
    const next = intent(
      'opening.create',
      { ...door(wall, 100), kind: 'window', sill: 1050, head: 2300 },
      source(1),
    )
    expectRejection(project, next, 'invalid-opening')
  })

  it('refuses a sliding door that still names a jamb', () => {
    const { project, wall } = host()
    expectRejection(
      project,
      intent('opening.create', door(wall, 100, { swing: 'sliding' }), source(1)),
      'invalid-opening',
    )
  })

  it('refuses a Wall that is not there, or is on another Floor', () => {
    const { project, wall } = host()
    expectRejection(project, intent('opening.create', door({ ...wall, id: 'wall-missing' }, 100), source(1)), 'unknown-target')
    const other = expectApplied(
      project,
      intent('floor.create', { name: 'Floor 2' }, source(2)),
    ).project
    expectRejection(other, intent('opening.create', door(wall, 100, { floorId: 'floor-other' }), source(1)), 'unknown-target')
  })

  it('is deterministic: the same Intent twice gives the same Project', () => {
    const { project, wall } = host()
    expectDeterministic(deepFreeze(project), intent('opening.create', door(wall, 1000), source(1)))
  })
})

describe('opening.setStart and opening.setWidth', () => {
  /** A host with one door already in it. */
  function withDoor(start = 1000): { project: Project; wall: Wall; opening: Opening } {
    const { project, wall } = host(6000)
    const placed = place(project, door(wall, start))
    return { project: placed, wall, opening: only(placed) }
  }

  it('moves along the host and nothing else', () => {
    const { project, opening } = withDoor()
    const applied = expectRoundTrip(project, intent('opening.setStart', { openingId: opening.id, start: 1400 }))
    expect(only(applied.project).start).toBe(1400)
    expect(only(applied.project).width).toBe(900)
  })

  it('refuses a move that would run past the end, and writes nothing', () => {
    const { project, wall, opening } = withDoor()
    const next = intent('opening.setStart', { openingId: opening.id, start: 5200 })
    expect(messageOf(project, next)).toBe('Door 1 would run past the end of W-1. Move or narrow it first.')
    expect(project.existingModel.openings).toEqual(openingsOf(project))
    expect(wall.id).toBe(opening.hostWallId)
  })

  it('refuses a move across the join next door', () => {
    const { project, wall } = host(6000)
    const branch = expectApplied(
      project,
      intent(
        'wall.createChain',
        {
          floorId: floorIdOf(project),
          walls: [{ line: line(3000, 900, 3000, 2400), thickness: 100, justification: 'centre', baseElevation: 0, height: 2600 }],
          starts: [{ kind: 'host', wallId: wall.id }],
          ends: [{ kind: 'free' }],
        },
        source(2),
      ),
    ).project
    const placed = place(branch, door(wall, 1000))
    const opening = only(placed)
    const rejection = expectRejection(
      placed,
      intent('opening.setStart', { openingId: opening.id, start: 2500 }),
      'opening-blocked',
    )
    expect(rejection.problems[0]!.message).toBe('Door 1 would cross the join with W-2.')
  })

  it('resizes from the near jamb when only a width is given', () => {
    const { project, opening } = withDoor()
    const applied = expectRoundTrip(project, intent('opening.setWidth', { openingId: opening.id, width: 1200 }))
    expect(only(applied.project).width).toBe(1200)
    expect(only(applied.project).start).toBe(1000)
  })

  it('moves both jambs together when the drag was symmetric', () => {
    const { project, opening } = withDoor()
    const applied = expectRoundTrip(
      project,
      intent('opening.setWidth', { openingId: opening.id, width: 1400, start: 750 }),
    )
    expect(only(applied.project)).toMatchObject({ start: 750, width: 1400 })
  })

  it('refuses a width the host has no room for, naming the Opening', () => {
    const { project, opening } = withDoor(5000)
    const next = intent('opening.setWidth', { openingId: opening.id, width: 1200 })
    expect(messageOf(project, next)).toBe('Door 1 would run past the end of W-1. Move or narrow it first.')
  })

  it('refuses a width of nothing', () => {
    const { project, opening } = withDoor()
    expectRejection(project, intent('opening.setWidth', { openingId: opening.id, width: 0 }), 'invalid-opening')
  })

  it('refuses an Opening that is not there', () => {
    const { project } = withDoor()
    expectRejection(project, intent('opening.setStart', { openingId: 'opening-missing', start: 100 }), 'unknown-target')
  })
})

describe('the flips, the name and the delete', () => {
  /** A host with one hinged door, one sliding door and one window. */
  function three(): { project: Project; hinged: Opening; sliding: Opening; window: Opening } {
    const { project, wall } = host(9000)
    const first = place(project, door(wall, 500))
    const second = place(first, door(wall, 3000, { label: 'Door 2', swing: 'sliding', hingeSide: undefined }))
    const third = place(second, {
      floorId: wall.floorId,
      hostWallId: wall.id,
      kind: 'window',
      label: 'Window 1',
      start: 6000,
      width: 1200,
      sill: 1050,
      head: 2300,
    })
    return { project: third, hinged: openingsOf(third)[0]!, sliding: openingsOf(third)[1]!, window: openingsOf(third)[2]! }
  }

  it('hangs the leaf on the other jamb', () => {
    const { project, hinged } = three()
    const applied = expectRoundTrip(project, intent('opening.flipHinge', { openingId: hinged.id }))
    expect(only(applied.project).hingeSide).toBe('end')
    expect(only(applied.project).start).toBe(hinged.start)
  })

  it('opens toward the other face of the host', () => {
    const { project, hinged } = three()
    const applied = expectRoundTrip(project, intent('opening.flipSwing', { openingId: hinged.id }))
    expect(only(applied.project).swing).toBe('right')
  })

  it('refuses to flip a window, which has no side to flip', () => {
    const { project, window } = three()
    const rejection = expectRejection(project, intent('opening.flipHinge', { openingId: window.id }), 'invalid-opening')
    expect(rejection.problems[0]!.message).toBe('Only a door opens, so only a door has a side to flip.')
    expectRejection(project, intent('opening.flipSwing', { openingId: window.id }), 'invalid-opening')
  })

  it('refuses to flip a sliding door, which has neither', () => {
    const { project, sliding } = three()
    expectRejection(project, intent('opening.flipHinge', { openingId: sliding.id }), 'invalid-opening')
    expectRejection(project, intent('opening.flipSwing', { openingId: sliding.id }), 'invalid-opening')
  })

  it('renames, trimmed', () => {
    const { project, hinged } = three()
    const applied = expectRoundTrip(project, intent('opening.rename', { openingId: hinged.id, label: '  Kitchen door  ' }))
    expect(only(applied.project).label).toBe('Kitchen door')
  })

  it('deletes one Opening and leaves the Wall and its other Openings', () => {
    const { project, hinged } = three()
    const applied = expectRoundTrip(project, intent('opening.delete', { openingId: hinged.id }))
    expect(openingsOf(applied.project).map((opening) => opening.label)).toEqual(['Door 2', 'Window 1'])
    expect(applied.project.existingModel.walls).toEqual(project.existingModel.walls)
  })
})
