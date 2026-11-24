/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { migrateProject, validateProject } from './index'
import roomsFixture from '../../fixtures/domain/v7/rooms.json?raw'

// The renovation rejects of #69 §4, one test per row of the issue's list, plus the two rules that
// exist only because a Design Option is a delta rather than a copy: `ref` is unique per model, so
// two Options may each label a new Wall `W-2′`, while entity IDs stay unique project-wide.
//
// The base is the v7 rooms fixture rather than a hand-written Project, because the interesting
// rejects are about references between collections — an Opening on a Wall, a Room Edge on a Wall
// face, a Junction between two Wall ends — and the fixture already holds a real one of each.
//
// These tests are not conditional on the Project carrying Options: the validator's renovation
// rules are inert in a Project with no Design Options, so the same code must reach the same verdict
// either way.

type Rec = Record<string, unknown>

function base(): Rec {
  const envelope = JSON.parse(roomsFixture) as { domainSchemaVersion: number; project: Rec }
  // The chain now runs to v8, which invents three Drawing Layer IDs, so the fixture needs a real
  // allocator rather than the empty one these loaders used while the chain stopped at v7.
  let issued = 0
  const result = migrateProject(envelope.project, envelope.domainSchemaVersion, (count) =>
    Array.from({ length: count }, () => `fixture-layer-${(issued += 1)}`),
  )
  if (!result.ok) throw new Error(`The rooms fixture no longer migrates: ${result.error.message}`)
  return structuredClone(result.project) as unknown as Rec
}

function collection(value: Rec, key: string): Rec[] {
  return (value.existingModel as Rec)[key] as Rec[]
}

function problemsOf(value: unknown): { path: string; code: string }[] {
  const result = validateProject(value)
  return result.ok ? [] : result.problems.map(({ path, code }) => ({ path, code }))
}

/** The exact `{path, code}` pairs, in the order the validator reported them. */
function expectProblems(value: unknown, expected: { path: string; code: string }[]): void {
  expect(problemsOf(value)).toEqual(expected)
}

/** The five collections of a proposed model, empty. */
function proposed(over: Rec = {}): Rec {
  return { walls: [], wallJunctions: [], openings: [], rooms: [], beams: [], placedItems: [], ...over }
}

function optionOf(over: Rec = {}): Rec {
  return { id: 'option-a', name: 'Option A', proposed: proposed(), demolishedIds: [], ...over }
}

function withOptions(value: Rec, ...options: Rec[]): Rec {
  value.designOptions = options
  return value
}

/** A proposed Wall standing on `floor-0`, 3 m along y = −500, which touches nothing Existing. */
function wallOf(id: string, over: Rec = {}): Rec {
  return {
    id,
    ref: `W-${id.slice(-1)}`,
    floorId: 'floor-0',
    line: { kind: 'line', start: { x: 2000, y: -500 }, end: { x: 5000, y: -500 } },
    thickness: 100,
    justification: 'centre',
    baseElevation: 0,
    height: 2600,
    predecessorIds: [],
    ...over,
  }
}

/** A 900 door at the same station the fixture's own Door 1 uses, so it fits any Wall here. */
function openingOf(id: string, hostWallId: string, over: Rec = {}): Rec {
  return {
    id,
    floorId: 'floor-0',
    hostWallId,
    kind: 'door',
    label: `Door ${id.slice(-1)}`,
    start: 1200,
    width: 900,
    sill: 0,
    head: 2100,
    swing: 'left',
    hingeSide: 'start',
    predecessorIds: [],
    ...over,
  }
}

function junctionOf(id: string, ends: Rec[], over: Rec = {}): Rec {
  return { id, floorId: 'floor-0', ends, predecessorIds: [], ...over }
}

/** A Room the size of the fixture's Living, which is what makes an overlap easy to see. */
function roomOf(id: string, name: string, over: Rec = {}): Rec {
  return {
    id,
    floorId: 'floor-0',
    name,
    outline: {
      kind: 'preset',
      preset: { kind: 'rectangle', width: 4000, depth: 2000 },
      centre: { x: 2000, y: -1050 },
      orientationDeg: 0,
      segmentIds: [`edge-${id}-1`, `edge-${id}-2`, `edge-${id}-3`, `edge-${id}-4`],
    },
    wallFaceRefs: [],
    predecessorIds: [],
    ...over,
  }
}

describe('the renovation rejects of strict import (#69 §4)', () => {
  it('accepts the fixture with no Design Options at all', () => {
    expect(problemsOf(base())).toEqual([])
  })

  it('accepts a Project whose Design Option proposes and demolishes nothing', () => {
    expectProblems(withOptions(base(), optionOf()), [])
  })

  it('refuses an Existing Model Wall that carries predecessorIds', () => {
    const value = base()
    collection(value, 'walls')[0].predecessorIds = ['wall-2']
    expectProblems(value, [{ path: 'existingModel.walls[0].predecessorIds', code: 'unknown-field' }])
  })

  it('refuses an Existing Model Opening that carries predecessorIds', () => {
    const value = base()
    collection(value, 'openings')[0].predecessorIds = ['wall-1']
    expectProblems(value, [{ path: 'existingModel.openings[0].predecessorIds', code: 'unknown-field' }])
  })

  it('refuses a proposed Wall with no predecessorIds field', () => {
    const wall = wallOf('wall-9')
    delete wall.predecessorIds
    const value = withOptions(base(), optionOf({ proposed: proposed({ walls: [wall] }) }))
    expectProblems(value, [{ path: 'designOptions[0].proposed.walls[0].predecessorIds', code: 'missing-field' }])
  })

  it('accepts a proposed Wall whose predecessor list is empty', () => {
    expectProblems(withOptions(base(), optionOf({ proposed: proposed({ walls: [wallOf('wall-9')] }) })), [])
  })

  it('refuses a successor whose predecessor names nothing', () => {
    const value = withOptions(
      base(),
      optionOf({ proposed: proposed({ walls: [wallOf('wall-9', { predecessorIds: ['wall-99'] })] }) }),
    )
    expectProblems(value, [{ path: 'designOptions[0].proposed.walls[0].predecessorIds[0]', code: 'dangling-reference' }])
  })

  it('refuses a successor in one Option whose predecessor is proposed work of another', () => {
    const value = withOptions(
      base(),
      optionOf({
        demolishedIds: ['wall-2'],
        proposed: proposed({ walls: [wallOf('wall-9', { ref: 'W-9', predecessorIds: ['wall-2'] })] }),
      }),
      optionOf({
        id: 'option-b',
        name: 'Option B',
        proposed: proposed({ walls: [wallOf('wall-10', { ref: 'W-10', predecessorIds: ['wall-9'] })] }),
      }),
    )
    expectProblems(value, [{ path: 'designOptions[1].proposed.walls[0].predecessorIds[0]', code: 'dangling-reference' }])
  })

  it('refuses a successor whose predecessor is not demolished in its own Option', () => {
    const value = withOptions(
      base(),
      optionOf({ proposed: proposed({ walls: [wallOf('wall-9', { predecessorIds: ['wall-1'] })] }) }),
    )
    expectProblems(value, [{ path: 'designOptions[0].proposed.walls[0].predecessorIds[0]', code: 'dangling-reference' }])
  })

  it('refuses a successor whose predecessor is proposed work of the same Option', () => {
    const value = withOptions(
      base(),
      optionOf({
        demolishedIds: ['wall-2'],
        proposed: proposed({
          walls: [wallOf('wall-9', { ref: 'W-9' }), wallOf('wall-10', { ref: 'W-10', predecessorIds: ['wall-9'] })],
        }),
      }),
    )
    expectProblems(value, [{ path: 'designOptions[0].proposed.walls[1].predecessorIds[0]', code: 'dangling-reference' }])
  })

  it('refuses an Existing Opening hosted on a Wall a Design Option proposes', () => {
    const value = base()
    withOptions(value, optionOf({ proposed: proposed({ walls: [wallOf('wall-9')] }) }))
    collection(value, 'openings')[0].hostWallId = 'wall-9'
    expectProblems(value, [{ path: 'existingModel.openings[0].hostWallId', code: 'dangling-reference' }])
  })

  it('refuses an Option Junction joining a Wall that the Option demolishes', () => {
    const value = withOptions(
      base(),
      optionOf({
        demolishedIds: ['wall-2'],
        proposed: proposed({
          walls: [wallOf('wall-9', { predecessorIds: ['wall-2'] })],
          wallJunctions: [junctionOf('junction-9', [{ wallId: 'wall-2', end: 'start' }, { wallId: 'wall-9', end: 'start' }])],
        }),
      }),
    )
    expectProblems(value, [{ path: 'designOptions[0].proposed.wallJunctions[0].ends[0].wallId', code: 'dangling-reference' }])
  })

  it('refuses an Option Junction that joins no Wall of its own', () => {
    const value = base()
    // The two Existing Walls have to share an end for the Junction to be otherwise well-formed,
    // so that the one problem reported is the one under test.
    collection(value, 'walls')[1].line = { kind: 'line', start: { x: 4000, y: 0 }, end: { x: 4000, y: 500 } }
    withOptions(
      value,
      optionOf({
        proposed: proposed({
          wallJunctions: [junctionOf('junction-9', [{ wallId: 'wall-1', end: 'end' }, { wallId: 'wall-2', end: 'start' }])],
        }),
      }),
    )
    expectProblems(value, [{ path: 'designOptions[0].proposed.wallJunctions[0].ends', code: 'dangling-reference' }])
  })

  it('refuses a demolition record naming a proposed entity', () => {
    const value = withOptions(
      base(),
      optionOf({ demolishedIds: ['wall-9'], proposed: proposed({ walls: [wallOf('wall-9')] }) }),
    )
    expectProblems(value, [{ path: 'designOptions[0].demolishedIds[0]', code: 'dangling-reference' }])
  })

  it('refuses a demolition record naming nothing', () => {
    const value = withOptions(base(), optionOf({ demolishedIds: ['wall-99'] }))
    expectProblems(value, [{ path: 'designOptions[0].demolishedIds[0]', code: 'dangling-reference' }])
  })

  it('refuses demolition records that are not sorted', () => {
    const value = withOptions(base(), optionOf({ demolishedIds: ['wall-2', 'wall-1'] }))
    expectProblems(value, [{ path: 'designOptions[0].demolishedIds', code: 'bad-format' }])
  })

  it('refuses the same demolition record twice in one Option', () => {
    const value = withOptions(base(), optionOf({ demolishedIds: ['wall-2', 'wall-2'] }))
    expectProblems(value, [{ path: 'designOptions[0].demolishedIds[1]', code: 'duplicate-id' }])
  })

  it('refuses two Options with the same name', () => {
    const value = withOptions(base(), optionOf(), optionOf({ id: 'option-b' }))
    expectProblems(value, [{ path: 'designOptions[1].name', code: 'duplicate-name' }])
  })

  it('refuses a Design Option ID that another entity already uses', () => {
    const value = withOptions(base(), optionOf({ id: 'wall-2' }))
    expectProblems(value, [{ path: 'designOptions[0].id', code: 'duplicate-id' }])
  })

  it('refuses an entity ID two Options both propose', () => {
    const value = withOptions(
      base(),
      optionOf({
        demolishedIds: ['wall-2'],
        proposed: proposed({ walls: [wallOf('wall-9', { ref: 'W-9', predecessorIds: ['wall-2'] })] }),
      }),
      optionOf({
        id: 'option-b',
        name: 'Option B',
        demolishedIds: ['wall-2'],
        proposed: proposed({ walls: [wallOf('wall-9', { ref: 'W-9', predecessorIds: ['wall-2'] })] }),
      }),
    )
    expectProblems(value, [{ path: 'designOptions[1].proposed.walls[0].id', code: 'duplicate-id' }])
  })

  it('accepts two Options each proposing a Wall labelled W-2′, because ref is unique per model', () => {
    const value = withOptions(
      base(),
      optionOf({
        demolishedIds: ['wall-2'],
        proposed: proposed({ walls: [wallOf('wall-9', { ref: 'W-2′', predecessorIds: ['wall-2'] })] }),
      }),
      optionOf({
        id: 'option-b',
        name: 'Option B',
        demolishedIds: ['wall-2'],
        proposed: proposed({ walls: [wallOf('wall-10', { ref: 'W-2′', predecessorIds: ['wall-2'] })] }),
      }),
    )
    expect(problemsOf(value)).toEqual([])
  })

  it('refuses a proposed Wall whose ref an Existing Wall already uses', () => {
    const value = withOptions(base(), optionOf({ proposed: proposed({ walls: [wallOf('wall-9', { ref: 'W-1' })] }) }))
    expectProblems(value, [{ path: 'designOptions[0].proposed.walls[0].ref', code: 'duplicate-name' }])
  })

  it('accepts a replace: the demolition, the successor and the Junction that holds it up', () => {
    const value = withOptions(
      base(),
      optionOf({
        demolishedIds: ['wall-2'],
        proposed: proposed({
          walls: [
            wallOf('wall-2s', { ref: 'W-2′', predecessorIds: ['wall-2'], line: { kind: 'line', start: { x: 2000, y: -500 }, end: { x: 2000, y: 500 } } }),
            wallOf('wall-9', { ref: 'W-9' }),
          ],
          wallJunctions: [
            junctionOf('junction-9', [{ wallId: 'wall-2s', end: 'start' }, { wallId: 'wall-9', end: 'start' }]),
          ],
        }),
      }),
    )
    expect(problemsOf(value)).toEqual([])
  })

  it('refuses a proposed Opening hosted on a Wall another Option proposes', () => {
    const value = withOptions(
      base(),
      optionOf({ proposed: proposed({ walls: [wallOf('wall-9', { ref: 'W-9' })] }) }),
      optionOf({
        id: 'option-b',
        name: 'Option B',
        proposed: proposed({ openings: [openingOf('opening-9', 'wall-9')] }),
      }),
    )
    expectProblems(value, [{ path: 'designOptions[1].proposed.openings[0].hostWallId', code: 'dangling-reference' }])
  })

  it('refuses a proposed Opening hosted on a Wall this Option demolishes', () => {
    const value = withOptions(
      base(),
      optionOf({
        demolishedIds: ['wall-2'],
        proposed: proposed({ openings: [openingOf('opening-9', 'wall-2')] }),
      }),
    )
    expectProblems(value, [{ path: 'designOptions[0].proposed.openings[0].hostWallId', code: 'dangling-reference' }])
  })

  it('accepts a proposed Opening hosted on a Wall this Option keeps', () => {
    const value = withOptions(
      base(),
      optionOf({ proposed: proposed({ openings: [openingOf('opening-9', 'wall-2', { start: 50, width: 400 })] }) }),
    )
    expect(problemsOf(value)).toEqual([])
  })

  it('refuses a proposed Room that overlaps one the Option leaves standing', () => {
    const value = withOptions(
      base(),
      optionOf({ proposed: proposed({ rooms: [roomOf('room-9', 'Lounge')] }) }),
    )
    expectProblems(value, [{ path: 'designOptions[0].proposed.rooms[0].outline', code: 'out-of-range' }])
  })

  it('accepts a proposed Room that overlaps one the Option demolishes', () => {
    const value = withOptions(
      base(),
      optionOf({
        demolishedIds: ['room-1'],
        proposed: proposed({ rooms: [roomOf('room-9', 'Lounge', { predecessorIds: ['room-1'] })] }),
      }),
    )
    expect(problemsOf(value)).toEqual([])
  })

  it('accepts the end state of a demolition review: the Wall and everything on it', () => {
    const value = withOptions(
      base(),
      optionOf({
        demolishedIds: ['opening-1', 'room-1', 'room-2', 'wall-1'],
        proposed: proposed({ walls: [wallOf('wall-9', { predecessorIds: ['wall-1'] })] }),
      }),
    )
    // The validator refuses the seven states of #69 §4 and no others. "A Wall is demolished while
    // something still stands on it" is deliberately not one of them: the dependency review of #69
    // §5 writes the Openings' and Rooms' demolition records in the same Edit Transaction, so the
    // state never reaches disk, and refusing it here would also refuse the transaction's own
    // preview. What the Option *does* have to survive is its own work: `wall-9` above is hosted on
    // nothing, so it reads cleanly, while an Option that proposed an Opening on `wall-1` would be
    // refused the same way an Option that proposes an Opening on a Wall it demolishes is.
    expect(problemsOf(value)).toEqual([])
  })
})

describe('acknowledgements per Design Option (#69 §4)', () => {
  it('accepts an acknowledgement of the Existing Model', () => {
    expectProblems(withOptions(base(), optionOf()), [])
  })

  it('accepts an acknowledgement that names a Design Option of this Project', () => {
    const value = withOptions(base(), optionOf())
    ;(value.warningAcknowledgements as Rec[])[0].designOptionId = 'option-a'
    expect(problemsOf(value)).toEqual([])
  })

  it('refuses an acknowledgement that names no Design Option field at all', () => {
    const value = base()
    delete (value.warningAcknowledgements as Rec[])[0].designOptionId
    expectProblems(value, [{ path: 'warningAcknowledgements[0].designOptionId', code: 'missing-field' }])
  })

  it('refuses an acknowledgement naming a Design Option this Project does not have', () => {
    const value = withOptions(base(), optionOf())
    ;(value.warningAcknowledgements as Rec[])[0].designOptionId = 'option-9'
    expectProblems(value, [{ path: 'warningAcknowledgements[0].designOptionId', code: 'dangling-reference' }])
  })

  it('refuses an acknowledgement naming a Design Option by an empty ID', () => {
    const value = withOptions(base(), optionOf())
    ;(value.warningAcknowledgements as Rec[])[0].designOptionId = ''
    expectProblems(value, [{ path: 'warningAcknowledgements[0].designOptionId', code: 'bad-id' }])
  })

  it('keeps one warning open in the other Option: the key is per Option', () => {
    const value = withOptions(base(), optionOf())
    const acks = value.warningAcknowledgements as Rec[]
    acks.push({ ...acks[0], id: 'acknowledgement-2', designOptionId: 'option-a' })
    expect(problemsOf(value)).toEqual([])
  })

  it('refuses two acknowledgements of one warning in the same Option', () => {
    const value = withOptions(base(), optionOf())
    const acks = value.warningAcknowledgements as Rec[]
    acks.push({ ...acks[0], id: 'acknowledgement-2' })
    expectProblems(value, [{ path: 'warningAcknowledgements[1]', code: 'duplicate-id' }])
  })
})

// --- One Wall end, one Junction, across the effective model (#69 §4) ---------

/** A Wall this Option drew from (4000, 0) straight down, so its start is at the fixture's corner. */
function wallDown(id: string): Rec {
  return wallOf(id, { line: { kind: 'line', start: { x: 4000, y: 0 }, end: { x: 4000, y: -3000 } } })
}

/**
 * The survey's own corner: W-2's start moved onto W-1's end at (4000, 0) and a Junction joining the
 * two. The v7 rooms fixture carries no Junction at all, and the rule under test only says anything
 * about a Project that already has one.
 */
function withCorner(value: Rec): Rec {
  const wall2 = collection(value, 'walls').find((wall) => wall.id === 'wall-2')!
  wall2.line = { kind: 'line', start: { x: 4000, y: 0 }, end: { x: 4000, y: 3000 } }
  collection(value, 'wallJunctions').push({
    id: 'junction-1',
    floorId: 'floor-0',
    ends: [
      { wallId: 'wall-1', end: 'end' },
      { wallId: 'wall-2', end: 'start' },
    ],
  })
  return value
}

/** A Junction of the Option at that same end of W-1, holding W-1 and the Wall this Option drew. */
function cornerAgain(): Rec {
  return junctionOf('junction-2', [
    { wallId: 'wall-1', end: 'end' },
    { wallId: 'wall-3', end: 'start' },
  ])
}

describe('one Wall end, one Junction — read across the effective model (#69 §4)', () => {
  it('refuses an Option Junction re-joining an end the Existing Model has joined', () => {
    const value = withOptions(
      withCorner(base()),
      optionOf({ proposed: proposed({ walls: [wallDown('wall-3')], wallJunctions: [cornerAgain()] }) }),
    )
    // Two Junctions would disagree about where that end is, and the tidy faces are derived from
    // whichever one the reader reached first.
    expectProblems(value, [{ path: 'designOptions[0].proposed.wallJunctions[0].ends[0]', code: 'duplicate-member' }])
  })

  it('allows it once the Option demolishes the Wall the other Junction held', () => {
    const value = withOptions(
      withCorner(base()),
      optionOf({
        demolishedIds: ['wall-2'],
        proposed: proposed({ walls: [wallDown('wall-3')], wallJunctions: [cornerAgain()] }),
      }),
    )
    // W-2 is down, its Junction went with it, and the end of W-1 it held is free again: this is the
    // knock-through that takes a wall out of a corner and joins the stub to something new.
    expect(problemsOf(value)).toEqual([])
  })
})

/**
 * The saved-view settings of #70 §1, checked strictly.
 *
 * The rule that shapes all of these: the Design Option and the Renovation Display are checked
 * **independently**. A view with no Option and a Demolition Display is a thing the user can be
 * looking at — the Option was deleted from under them, and §6 draws that on the canvas — so it is
 * valid persisted state. What is refused is a view that names an Option this Project does not have,
 * and a Display outside the four.
 */
describe('the saved-view settings of strict import (#70 §1)', () => {
  function views(value: Rec): Rec[] {
    return value.views as Rec[]
  }

  it('accepts a view that carries neither field, which is every view written before #70', () => {
    expect(problemsOf(base())).toEqual([])
  })

  it('accepts a view that looks at the Existing Model through no Option on any Display', () => {
    for (const display of ['existing', 'demolition', 'proposed', 'combined']) {
      const value = base()
      views(value)[1] = { ...views(value)[1]!, designOptionId: null, renovationDisplay: display }
      expect(problemsOf(value)).toEqual([])
    }
  })

  it('accepts a view that names a Design Option of this Project', () => {
    const value = withOptions(base(), optionOf())
    views(value)[1] = { ...views(value)[1]!, designOptionId: 'option-a', renovationDisplay: 'combined' }
    expect(problemsOf(value)).toEqual([])
  })

  it('refuses a view naming a Design Option this Project does not have', () => {
    const value = withOptions(base(), optionOf())
    views(value)[1] = { ...views(value)[1]!, designOptionId: 'option-gone' }
    expectProblems(value, [{ path: 'views[1].designOptionId', code: 'dangling-reference' }])
  })

  it('refuses a Design Option reference even when the Project has no Options at all', () => {
    const value = base()
    views(value)[0] = { ...views(value)[0]!, designOptionId: 'option-a' }
    expectProblems(value, [{ path: 'views[0].designOptionId', code: 'dangling-reference' }])
  })

  it('refuses a Display outside the four, and says which four', () => {
    const value = base()
    views(value)[1] = { ...views(value)[1]!, renovationDisplay: 'phase-2' }
    const result = validateProject(value)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: 'views[1].renovationDisplay', code: 'not-one-of' },
    ])
    expect(result.problems[0]!.message).toContain('existing, demolition, proposed, combined')
  })

  it('refuses a Display that is not a word at all', () => {
    const value = base()
    views(value)[0] = { ...views(value)[0]!, renovationDisplay: 2 }
    expectProblems(value, [{ path: 'views[0].renovationDisplay', code: 'wrong-type' }])
  })

  it('refuses a Design Option that is neither an ID nor null', () => {
    const value = withOptions(base(), optionOf())
    views(value)[0] = { ...views(value)[0]!, designOptionId: 7 }
    expectProblems(value, [{ path: 'views[0].designOptionId', code: 'wrong-type' }])
  })

  it('reports both halves of one bad view, because neither explains the other', () => {
    const value = withOptions(base(), optionOf())
    views(value)[0] = { ...views(value)[0]!, designOptionId: 'option-gone', renovationDisplay: 'phase-2' }
    expectProblems(value, [
      { path: 'views[0].designOptionId', code: 'dangling-reference' },
      { path: 'views[0].renovationDisplay', code: 'not-one-of' },
    ])
  })

  it('refuses a field this build does not know, so a typo is never read as a Display', () => {
    const value = base()
    views(value)[0] = { ...views(value)[0]!, renovationDispaly: 'combined' }
    expectProblems(value, [{ path: 'views[0].renovationDispaly', code: 'unknown-field' }])
  })
})
