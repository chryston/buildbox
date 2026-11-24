/**
 * The Service Intents (#79 §1, §3, §4): what one stores, what moves it, what the numbers do.
 *
 * The shape of the record is the acceptance criterion, so it is asserted as a key list rather than
 * field by field: a Run holds a straight centreline, a section, one size pair and **one** elevation,
 * and nothing else — no Bottom, no Top, no faces, no outline, no host, no slope. A Riser holds a plan
 * point, a Diameter, a bottom and a height, and no section at all. The refusals are asserted by their
 * sentence as well as their code, because the sentence is what the homeowner reads.
 *
 * The numbers are the issue's own: a `W Ø50` Run centred at 2200 stands at 2175–2225, so typing a
 * `Bottom` of 2100 moves the centreline to 2125 and leaves the Diameter alone (§ criterion 12), and a
 * Riser given a new `Top` keeps the Bottom it had and restates only its Height (§ criterion 13).
 */
import { describe, expect, it } from 'vitest'
import type { Project, Service } from '../../domain'
import { designOptionsOf, drawingLayersOf, serviceBottom, serviceTop, servicesOf } from '../../domain'
import { pt } from '../../geometry'
import { applyPatches } from '../apply'
import type { PayloadOf } from '../intents'
import { expectApplied, expectRejection, expectRoundTrip, idSource, intent, newProject } from '../testing'

const source = idSource('service')
const floorIdOf = (project: Project): string => project.floors[0]!.id

/** The payload the Service tool sends for a round water Run at 2200, 3 000 mm long. */
function runPayload(project: Project, over: Partial<PayloadOf<'service.create'>> = {}): PayloadOf<'service.create'> {
  return {
    floorId: floorIdOf(project),
    shape: 'run',
    kind: 'water',
    line: { start: pt(600, 1200), end: pt(3600, 1200) },
    section: 'round',
    centrelineElevation: 2200,
    outsideDiameter: 50,
    ...over,
  }
}

/** The payload the Service tool sends for a drain Riser from the Datum to 2600. */
function riserPayload(project: Project, over: Partial<PayloadOf<'service.create'>> = {}): PayloadOf<'service.create'> {
  return {
    floorId: floorIdOf(project),
    shape: 'riser',
    kind: 'drain',
    point: pt(3400, 2200),
    outsideDiameter: 100,
    bottomElevation: 0,
    height: 2600,
    ...over,
  }
}

/** One Project with one round water Run, and the Run itself. */
function oneRun(over: Partial<PayloadOf<'service.create'>> = {}): { project: Project; run: Service } {
  const project = newProject()
  const drawn = expectRoundTrip(project, intent('service.create', runPayload(project, over), source(1))).project
  return { project: drawn, run: servicesOf(drawn.existingModel)[0]! }
}

/** One Project with one drain Riser, and the Riser itself. */
function oneRiser(over: Partial<PayloadOf<'service.create'>> = {}): { project: Project; riser: Service } {
  const project = newProject()
  const drawn = expectRoundTrip(project, intent('service.create', riserPayload(project, over), source(1))).project
  return { project: drawn, riser: servicesOf(drawn.existingModel)[0]! }
}

const keysOf = (service: Service): string[] => Object.keys(service).sort()

describe('a Service Run record (#79 §1, §3)', () => {
  it('stores the centreline and one size, and neither the Bottom nor the Top', () => {
    const { run } = oneRun()
    expect(keysOf(run)).toStrictEqual([
      'centrelineElevation',
      'drawingLayerId',
      'floorId',
      'id',
      'kind',
      'line',
      'outsideDiameter',
      'section',
      'shape',
    ])
    expect(run).toMatchObject({ shape: 'run', kind: 'water', section: 'round', centrelineElevation: 2200, outsideDiameter: 50 })
    // The two numbers the plan and the Elevation View show are read off this one, never stored.
    expect(serviceBottom(run)).toBe(2175)
    expect(serviceTop(run)).toBe(2225)
  })

  it('stores a Width and a Depth for a rectangular section, and no Diameter', () => {
    const { run } = oneRun({ section: 'rectangular', outsideDiameter: undefined, width: 80, depth: 60 })
    expect(keysOf(run)).toStrictEqual(['centrelineElevation', 'depth', 'drawingLayerId', 'floorId', 'id', 'kind', 'line', 'section', 'shape', 'width'])
    expect(serviceBottom(run)).toBe(2170)
    expect(serviceTop(run)).toBe(2230)
  })

  it('keeps a label the person typed and omits one nobody typed, because Kind is never the name (#79 §Naming)', () => {
    const { run } = oneRun({ label: 'Condensate' })
    expect(run).toMatchObject({ label: 'Condensate' })
    expect('label' in oneRun().run).toBe(false)
  })

  it('refuses a centreline that joins two identical points', () => {
    const project = newProject()
    const rejection = expectRejection(
      project,
      intent('service.create', runPayload(project, { line: { start: pt(600, 1200), end: pt(600, 1200) } }), source(1)),
      'invalid-service',
    )
    expect(rejection.problems[0]!.message).toContain('two different points')
  })

  it('refuses a size of zero or less, by the name of the box it came from', () => {
    const project = newProject()
    expectRejection(project, intent('service.create', runPayload(project, { outsideDiameter: 0 }), source(1)), 'invalid-service')
    expectRejection(
      project,
      intent('service.create', runPayload(project, { section: 'rectangular', outsideDiameter: undefined, width: 80, depth: -5 }), source(1)),
      'invalid-service',
    )
  })

  it('refuses a round Run that was sent a Width, and a rectangular one that was sent a Diameter', () => {
    const project = newProject()
    expectRejection(
      project,
      intent('service.create', runPayload(project, { width: 80, depth: 60 }), source(1)),
      'invalid-service',
    )
    const rectangular = expectApplied(
      project,
      intent('service.create', runPayload(project, { section: 'rectangular', outsideDiameter: undefined, width: 80, depth: 60 }), source(2)),
    ).project
    expect(servicesOf(rectangular.existingModel)[0]).toMatchObject({ section: 'rectangular', width: 80 })
  })

  it('refuses a Run that was sent a Riser’s point, bottom or height', () => {
    const project = newProject()
    expectRejection(project, intent('service.create', runPayload(project, { point: pt(10, 10) }), source(1)), 'invalid-service')
    expectRejection(project, intent('service.create', runPayload(project, { bottomElevation: 0 }), source(1)), 'invalid-service')
  })

  it('accepts a centreline below the Floor Datum, because that is a thing a person documents (#79 criterion 26)', () => {
    const { run } = oneRun({ centrelineElevation: -100 })
    expect(run).toMatchObject({ centrelineElevation: -100 })
    expect(serviceBottom(run)).toBe(-125)
  })
})

describe('a Service Riser record (#79 §1, §3)', () => {
  it('stores a point, a Diameter, a bottom and a height, and no section or centreline', () => {
    const { riser } = oneRiser()
    expect(keysOf(riser)).toStrictEqual(['bottomElevation', 'drawingLayerId', 'floorId', 'height', 'id', 'kind', 'outsideDiameter', 'point', 'shape'])
    expect(riser).toMatchObject({ shape: 'riser', kind: 'drain', outsideDiameter: 100, bottomElevation: 0, height: 2600 })
    expect(serviceBottom(riser)).toBe(0)
    expect(serviceTop(riser)).toBe(2600)
  })

  it('refuses a Riser that was sent a Run’s line, section or centreline', () => {
    const project = newProject()
    expectRejection(project, intent('service.create', riserPayload(project, { line: { start: pt(0, 0), end: pt(100, 0) } } as PayloadOf<'service.create'>), source(1)), 'invalid-service')
    expectRejection(project, intent('service.create', riserPayload(project, { section: 'round' }), source(1)), 'invalid-service')
    expectRejection(project, intent('service.create', riserPayload(project, { centrelineElevation: 2000 }), source(1)), 'invalid-service')
  })

  it('refuses a Riser of no height and a Riser with no Diameter', () => {
    const project = newProject()
    expectRejection(project, intent('service.create', riserPayload(project, { height: 0 }), source(1)), 'invalid-service')
    expectRejection(project, intent('service.create', riserPayload(project, { outsideDiameter: undefined }), source(1)), 'invalid-service')
  })
})

describe('moving a Service (#79 §4)', () => {
  it('moves one end of the centreline and leaves the other, the size and the elevation alone', () => {
    const { project, run } = oneRun()
    const moved = expectRoundTrip(project, intent('service.dragEndpoint', { serviceId: run.id, end: 'end', to: pt(4000, 1500) })).project
    expect(servicesOf(moved.existingModel)[0]).toMatchObject({
      line: { start: pt(600, 1200), end: pt(4000, 1500) },
      centrelineElevation: 2200,
      outsideDiameter: 50,
    })
  })

  it('refuses to move the end of a Riser, which has none', () => {
    const { project, riser } = oneRiser()
    const rejection = expectRejection(project, intent('service.dragEndpoint', { serviceId: riser.id, end: 'end', to: pt(1, 1) }), 'invalid-service')
    expect(rejection.problems[0]!.message).toContain('one vertical line at one point')
  })

  it('moves a whole Run by the delta and a whole Riser by the delta of its point', () => {
    const runCase = oneRun()
    const movedRun = expectRoundTrip(runCase.project, intent('service.dragBody', { serviceId: runCase.run.id, delta: pt(50, -20) })).project
    expect(servicesOf(movedRun.existingModel)[0]).toMatchObject({
      line: { start: pt(650, 1180), end: pt(3650, 1180) },
      centrelineElevation: 2200,
    })
    const riserCase = oneRiser()
    const movedRiser = expectRoundTrip(riserCase.project, intent('service.dragBody', { serviceId: riserCase.riser.id, delta: pt(50, -20) })).project
    expect(servicesOf(movedRiser.existingModel)[0]).toMatchObject({ point: pt(3450, 2180), bottomElevation: 0, height: 2600 })
  })

  it('keeps the direction when the Length box moves one end along the line', () => {
    const { project, run } = oneRun()
    const longer = expectRoundTrip(project, intent('service.setLength', { serviceId: run.id, length: 6000, keepFixed: 'start' })).project
    expect(servicesOf(longer.existingModel)[0]).toMatchObject({ line: { start: pt(600, 1200), end: pt(6600, 1200) } })
    const shorter = expectApplied(project, intent('service.setLength', { serviceId: run.id, length: 1500, keepFixed: 'end' })).project
    expect(servicesOf(shorter.existingModel)[0]).toMatchObject({ line: { start: pt(2100, 1200), end: pt(3600, 1200) } })
  })

  it('refuses a Length of nothing, and a Length on a Riser', () => {
    const { project, run } = oneRun()
    expectRejection(project, intent('service.setLength', { serviceId: run.id, length: 0, keepFixed: 'start' }), 'invalid-service')
    const riserCase = oneRiser()
    expectRejection(riserCase.project, intent('service.setLength', { serviceId: riserCase.riser.id, length: 100, keepFixed: 'start' }), 'invalid-service')
  })
})

describe('the Kind, the section and the size (#79 §4)', () => {
  it('changes the Kind and nothing else, because the Kind is never the name', () => {
    const { project, run } = oneRun({ label: 'Condensate' })
    const changed = expectRoundTrip(project, intent('service.setKind', { serviceId: run.id, kind: 'air_con' })).project
    expect(servicesOf(changed.existingModel)[0]).toMatchObject({ kind: 'air_con', label: 'Condensate', outsideDiameter: 50 })
  })

  it('restarts the size at the placeholders when the section changes, and keeps the centreline', () => {
    const { project, run } = oneRun()
    const switched = expectRoundTrip(project, intent('service.setSection', { serviceId: run.id, section: 'rectangular' })).project
    expect(servicesOf(switched.existingModel)[0]).toMatchObject({
      section: 'rectangular',
      width: 80,
      depth: 60,
      centrelineElevation: 2200,
    })
    expect('outsideDiameter' in servicesOf(switched.existingModel)[0]!).toBe(false)
    const back = expectApplied(switched, intent('service.setSection', { serviceId: run.id, section: 'round' })).project
    const round = servicesOf(back.existingModel)[0]!
    expect(round).toMatchObject({ section: 'round', outsideDiameter: 50, centrelineElevation: 2200 })
    expect('width' in round && 'depth' in round).toBe(false)
  })

  it('refuses a section on a Riser, a Diameter on a rectangular Run, and a Width on a round one', () => {
    const riserCase = oneRiser()
    expectRejection(riserCase.project, intent('service.setSection', { serviceId: riserCase.riser.id, section: 'rectangular' }), 'invalid-service')
    const rectangular = oneRun({ section: 'rectangular', outsideDiameter: undefined, width: 80, depth: 60 })
    expectRejection(rectangular.project, intent('service.setOutsideDiameter', { serviceId: rectangular.run.id, outsideDiameter: 50 }), 'invalid-service')
    const round = oneRun()
    expectRejection(round.project, intent('service.setWidth', { serviceId: round.run.id, width: 80 }), 'invalid-service')
    expectRejection(round.project, intent('service.setDepth', { serviceId: round.run.id, depth: 60 }), 'invalid-service')
  })

  it('takes a Diameter on a round Run and on a Riser, and a Width and a Depth on a rectangular one', () => {
    const round = oneRun()
    expect(servicesOf(expectApplied(round.project, intent('service.setOutsideDiameter', { serviceId: round.run.id, outsideDiameter: 100 })).project.existingModel)[0]).toMatchObject({ outsideDiameter: 100 })
    const riserCase = oneRiser()
    expect(servicesOf(expectApplied(riserCase.project, intent('service.setOutsideDiameter', { serviceId: riserCase.riser.id, outsideDiameter: 150 })).project.existingModel)[0]).toMatchObject({ outsideDiameter: 150 })
    const rectangular = oneRun({ section: 'rectangular', outsideDiameter: undefined, width: 80, depth: 60 })
    const widened = expectRoundTrip(rectangular.project, intent('service.setWidth', { serviceId: rectangular.run.id, width: 150 })).project
    expect(servicesOf(widened.existingModel)[0]).toMatchObject({ width: 150, depth: 60 })
  })

  it('refuses a size of zero from any of the three boxes', () => {
    const rectangular = oneRun({ section: 'rectangular', outsideDiameter: undefined, width: 80, depth: 60 })
    expectRejection(rectangular.project, intent('service.setWidth', { serviceId: rectangular.run.id, width: 0 }), 'invalid-service')
    expectRejection(rectangular.project, intent('service.setDepth', { serviceId: rectangular.run.id, depth: 0 }), 'invalid-service')
  })
})

describe('the vertical boxes of a Service (#79 §4)', () => {
  it('reads Bottom and Top back into the one centreline a Run stores', () => {
    const { project, run } = oneRun()
    // `W Ø50` at 2200 stands 2175–2225; a `Bottom` of 2100 moves the centreline to 2125.
    const lowered = expectRoundTrip(project, intent('service.setVerticalExtent', { serviceId: run.id, field: 'bottom', value: 2100 })).project
    expect(servicesOf(lowered.existingModel)[0]).toMatchObject({ centrelineElevation: 2125, outsideDiameter: 50 })
    const raised = expectApplied(project, intent('service.setVerticalExtent', { serviceId: run.id, field: 'top', value: 2300 })).project
    expect(servicesOf(raised.existingModel)[0]).toMatchObject({ centrelineElevation: 2275 })
    const centred = expectApplied(project, intent('service.setVerticalExtent', { serviceId: run.id, field: 'centre', value: 2000 })).project
    expect(servicesOf(centred.existingModel)[0]).toMatchObject({ centrelineElevation: 2000 })
  })

  it('follows the Depth when the section is rectangular, because that is the vertical side', () => {
    const { project, run } = oneRun({ section: 'rectangular', outsideDiameter: undefined, width: 80, depth: 60 })
    const lowered = expectApplied(project, intent('service.setVerticalExtent', { serviceId: run.id, field: 'bottom', value: 2000 })).project
    expect(servicesOf(lowered.existingModel)[0]).toMatchObject({ centrelineElevation: 2030 })
  })

  it('refuses a Height on a Run, whose vertical size is its section', () => {
    const { project, run } = oneRun()
    const rejection = expectRejection(project, intent('service.setVerticalExtent', { serviceId: run.id, field: 'height', value: 100 }), 'invalid-service')
    expect(rejection.problems[0]!.message).toContain('vertical size is its section')
  })

  it('keeps the Height when a Riser’s Bottom moves, and the Bottom when its Top moves', () => {
    const { project, riser } = oneRiser()
    const lifted = expectRoundTrip(project, intent('service.setVerticalExtent', { serviceId: riser.id, field: 'bottom', value: 100 })).project
    expect(servicesOf(lifted.existingModel)[0]).toMatchObject({ bottomElevation: 100, height: 2600 })
    expect(serviceTop(servicesOf(lifted.existingModel)[0]!)).toBe(2700)
    const shortened = expectApplied(project, intent('service.setVerticalExtent', { serviceId: riser.id, field: 'top', value: 1000 })).project
    expect(servicesOf(shortened.existingModel)[0]).toMatchObject({ bottomElevation: 0, height: 1000 })
    const stretched = expectApplied(project, intent('service.setVerticalExtent', { serviceId: riser.id, field: 'height', value: 3000 })).project
    expect(servicesOf(stretched.existingModel)[0]).toMatchObject({ bottomElevation: 0, height: 3000 })
  })

  it('refuses a Riser whose Top is at or below its Bottom, and a centre it does not store', () => {
    const { project, riser } = oneRiser()
    expectRejection(project, intent('service.setVerticalExtent', { serviceId: riser.id, field: 'top', value: 0 }), 'invalid-extent')
    expectRejection(project, intent('service.setVerticalExtent', { serviceId: riser.id, field: 'centre', value: 1000 }), 'invalid-service')
  })

  it('refuses a Height of nothing on a Riser', () => {
    const { project, riser } = oneRiser()
    expectRejection(project, intent('service.setVerticalExtent', { serviceId: riser.id, field: 'height', value: 0 }), 'invalid-extent')
  })
})

describe('the label and the delete (#79 §4)', () => {
  it('renames, clears back to no label, and refuses more than 80 characters', () => {
    const { project, run } = oneRun({ label: 'Condensate' })
    const renamed = expectRoundTrip(project, intent('service.rename', { serviceId: run.id, label: 'AC condensate' })).project
    expect(servicesOf(renamed.existingModel)[0]).toMatchObject({ label: 'AC condensate' })
    const cleared = expectApplied(renamed, intent('service.rename', { serviceId: run.id, label: '' })).project
    expect('label' in servicesOf(cleared.existingModel)[0]!).toBe(false)
    expectRejection(project, intent('service.rename', { serviceId: run.id, label: 'x'.repeat(81) }), 'invalid-service')
  })

  it('deletes the record and leaves every other Service standing', () => {
    const first = oneRun()
    const twice = expectApplied(first.project, intent('service.create', runPayload(first.project, { kind: 'gas' }), source(2))).project
    const survivor = servicesOf(twice.existingModel)[1]!
    const deleted = expectApplied(twice, intent('service.delete', { serviceId: survivor.id })).project
    expect(servicesOf(deleted.existingModel).map((service) => service.id)).toStrictEqual([first.run.id])
  })

  it('refuses a delete of a Service that is not there', () => {
    expectRejection(newProject(), intent('service.delete', { serviceId: 'nope' }), 'unknown-target')
  })
})

describe('where a Service is created (#79 §5)', () => {
  it('writes into the Existing Model when no Option is targeted', () => {
    const { project } = oneRun()
    expect(servicesOf(project.existingModel)).toHaveLength(1)
    expect(designOptionsOf(project)).toHaveLength(0)
  })

  it('proposes into the Option it was drawn in, with provenance that says so', () => {
    const project = newProject()
    const withOption = expectApplied(project, intent('designOption.create', { name: 'Option A' }, ['opt-a'])).project
    const drawn = expectRoundTrip(
      withOption,
      intent('service.create', runPayload(withOption, { target: { designOptionId: 'opt-a' } }), source(1)),
    ).project
    expect(servicesOf(drawn.existingModel)).toHaveLength(0)
    const proposed = servicesOf(designOptionsOf(drawn)[0]!.proposed)
    expect(proposed).toHaveLength(1)
    expect(proposed[0]).toMatchObject({ predecessorIds: [] })
  })

  it('files a new Service on the Services layer the view names, and nowhere else (#79 §5)', () => {
    const project = newProject()
    const servicesLayer = drawingLayersOf(project).find((layer) => layer.name === 'Services')
    const drawn = expectApplied(project, intent('service.create', runPayload(project), source(1))).project
    const created = servicesOf(drawn.existingModel)[0]!
    if (servicesLayer === undefined) {
      expect('drawingLayerId' in created).toBe(false)
      return
    }
    expect(created.drawingLayerId).toBe(servicesLayer.id)
  })
})

/** The undo of every Service Intent puts the Project back byte for byte. */
describe('a Service edit round-trips (#79 §4)', () => {
  it('inverses every box the tool and the inspector have', () => {
    const { project, run } = oneRun()
    const steps = [
      intent('service.setKind', { serviceId: run.id, kind: 'gas' }),
      intent('service.setSection', { serviceId: run.id, section: 'rectangular' }),
      intent('service.setWidth', { serviceId: run.id, width: 200 }),
      intent('service.setDepth', { serviceId: run.id, depth: 100 }),
      intent('service.setLength', { serviceId: run.id, length: 1000, keepFixed: 'end' }),
      intent('service.rename', { serviceId: run.id, label: 'Gas riser feed' }),
    ]
    let current = project
    for (const step of steps) {
      const applied = expectApplied(current, step)
      expect(JSON.stringify(applyPatches(applied.project, applied.inversePatches))).toBe(JSON.stringify(current))
      current = applied.project
    }
    expect(servicesOf(current.existingModel)[0]).toMatchObject({ kind: 'gas', section: 'rectangular', width: 200, depth: 100, label: 'Gas riser feed' })
  })
})
