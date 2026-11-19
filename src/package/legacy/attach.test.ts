/**
 * Choosing an owner for the converted floor plan — #43 criterion 11, plus the two ways the
 * helpers refuse. The counts here are the whole point: nothing may go missing on the way in.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { rectangleFootprint, validateProject, type PlanImage, type Project } from '../../domain'
import {
  attachFloorPlan,
  convertLegacy,
  floorPlanAsProject,
  type LegacyConversionResult,
  type LegacyFloorPlanContent,
} from '../index'

const fixturesRoot = fileURLToPath(new URL('../../../fixtures/legacy', import.meta.url))
const read = (rel: string): string => readFileSync(join(fixturesRoot, rel), 'utf8')

const allocator = (prefix = 'gen'): (() => string) => {
  let issued = 0
  return () => `${prefix}-${++issued}`
}

const convert = (rel: string): Promise<LegacyConversionResult> => convertLegacy(read(rel), { newId: allocator() })

/** The converted v3 store's Kitchen Wall Project: two cabinets, one empty Floor 1. */
async function kitchenWall(): Promise<Project> {
  const result = await convert('v3/buildbox-store.json')
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  const proposal = result.conversion.projects.find((each) => each.designId === 'proj-kitchen-wall')
  if (proposal === undefined || proposal.status !== 'ok') throw new Error(JSON.stringify(proposal))
  return proposal.project
}

/** The same plan as a stand-alone file: 7 objects, 1 template, 1 image, 2 sketches. */
async function planContent(): Promise<LegacyFloorPlanContent> {
  const result = await convertLegacy(read('floor-plan/with-image-floor-plan.json'), { newId: allocator('plan') })
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  const plan = result.conversion.floorPlan
  if (plan === null || plan.status !== 'ok') throw new Error(JSON.stringify(plan))
  return plan.content
}

const floorOne = (project: Project): string => {
  const [floor] = project.floors
  if (floor === undefined) throw new Error('expected a Floor')
  return floor.id
}

describe('attachFloorPlan (#43 criterion 11)', () => {
  it('adds every Item Design and Placed Item to the chosen Floor', async () => {
    const project = await kitchenWall()
    const content = await planContent()

    const attached = attachFloorPlan(project, content, { floorId: floorOne(project), newId: allocator() })
    if (!attached.ok) throw new Error(JSON.stringify(attached.problems))

    expect(validateProject(attached.project).ok).toBe(true)
    expect(attached.regeneratedIds).toEqual([])
    // 2 cabinets + 7 objects + 1 template; the template is the one thing with no placement.
    expect(attached.project.itemDesigns).toHaveLength(10)
    expect(attached.project.existingModel.placedItems).toHaveLength(9)
    expect(attached.project.floors[0]?.planImage).toEqual(content.planImage)
    expect(attached.project.existingModel.placedItems.slice(2).every((item) => item.floorId === floorOne(project)))
      .toBe(true)
    // The plan's own IDs survive, so the Migration review can point back at them.
    expect(attached.project.itemDesigns.slice(2).map((design) => design.id))
      .toEqual([
        'plan-1', 'plan-2', 'plan-3', 'plan-4', 'plan-5', 'plan-6', 'plan-7',
        'tpl-island',
      ])
  })

  it('keeps a Floor with no Plan Image of its own when the plan has none either', async () => {
    const project = await kitchenWall()
    const result = await convert('floor-plan/no-image-floor-plan.json')
    if (!result.ok || result.conversion.floorPlan?.status !== 'ok') throw new Error(JSON.stringify(result))

    const attached = attachFloorPlan(project, result.conversion.floorPlan.content, {
      floorId: floorOne(project),
      newId: allocator(),
    })
    if (!attached.ok) throw new Error(JSON.stringify(attached.problems))

    expect(attached.project.floors[0]?.planImage).toBeNull()
    expect(validateProject(attached.project).ok).toBe(true)
  })

  it('regenerates a colliding ID and repoints the Placed Item that used it', async () => {
    const project = await kitchenWall()
    const content = await planContent()
    // Somebody already drew a sofa here, under both names the legacy object would bring:
    // the Placed Item id it kept and the fresh Item Design id the converter gave it.
    const occupied: Project = {
      ...project,
      itemDesigns: [...project.itemDesigns, {
        id: 'fp-sofa',
        kind: 'generic',
        name: 'My sofa',
        footprint: rectangleFootprint(2000, 900),
        origin: { x: 1000, y: 450 },
        height: 850,
        heightIsTypical: true,
        color: '#000000',
      }, {
        id: 'plan-1',
        kind: 'generic',
        name: 'My fridge',
        footprint: rectangleFootprint(180, 180),
        origin: { x: 90, y: 90 },
        height: 1800,
        heightIsTypical: true,
        color: '#eeeeee',
      }],
    }

    const attached = attachFloorPlan(occupied, content, { floorId: floorOne(occupied), newId: allocator('att') })
    if (!attached.ok) throw new Error(JSON.stringify(attached.problems))

    expect(validateProject(attached.project).ok).toBe(true)
    expect(attached.regeneratedIds).toEqual([
      { scope: 'floor-plan', path: 'itemDesigns[4].id', oldId: 'plan-1', newId: 'att-1' },
      { scope: 'floor-plan', path: 'existingModel.placedItems[2].id', oldId: 'fp-sofa', newId: 'att-2' },
    ])
    // The Placed Item that carried the old Item Design id now points at the moved one.
    expect(attached.project.itemDesigns[4]?.id).toBe('att-1')
    expect(attached.project.existingModel.placedItems[2]?.itemDesignId).toBe('att-1')
    // The Project's own names win: what was already there keeps what it was called.
    expect(attached.project.itemDesigns[2]?.id).toBe('fp-sofa')
    expect(attached.project.itemDesigns.filter((design) => design.id === 'plan-1')).toHaveLength(1)
  })

  it('refuses to overwrite a Floor that already has a Plan Image', async () => {
    const project = await kitchenWall()
    const content = await planContent()
    const first = attachFloorPlan(project, content, { floorId: floorOne(project), newId: allocator() })
    if (!first.ok) throw new Error(JSON.stringify(first.problems))

    expect(attachFloorPlan(first.project, content, { floorId: floorOne(first.project), newId: allocator() })).toEqual({
      ok: false,
      problems: [{ path: 'floors[0].planImage', code: 'plan-image-present', message: 'This Floor already has a Plan Image.' }],
    })
  })

  it('refuses a Floor the Project does not have', async () => {
    const project = await kitchenWall()
    const content = await planContent()

    expect(attachFloorPlan(project, content, { floorId: 'floor-9', newId: allocator() })).toMatchObject({
      ok: false,
      problems: [{ path: 'floors', code: 'missing-floor' }],
    })
  })

  it('re-runs strict validation rather than handing back an invalid Project', async () => {
    const project = await kitchenWall()
    const content = await planContent()
    if (content.planImage === null) throw new Error('expected a Plan Image')
    // A media type the domain does not know: the converter keeps it, the Project cannot hold
    // it. No valid `PlanImage` can say `image/tiff`, so this one is widened where it is built.
    const tiff: LegacyFloorPlanContent = {
      ...content,
      planImage: { ...content.planImage, mediaType: 'image/tiff' } as unknown as PlanImage,
    }

    const attached = attachFloorPlan(project, tiff, { floorId: floorOne(project), newId: allocator() })
    expect(attached.ok).toBe(false)
    if (attached.ok) return
    expect(attached.problems.map((each) => each.path)).toEqual(['floors[0].planImage.mediaType'])
  })
})

describe('floorPlanAsProject (#43 criterion 11)', () => {
  it('makes a strictly valid Project of its own, with one Floor named "Floor 1"', async () => {
    const content = await planContent()

    const made = floorPlanAsProject(content, {
      projectId: 'proj-floor-plan',
      name: 'Floor plan',
      floorId: 'floor-1',
      newId: allocator(),
    })
    if (!made.ok) throw new Error(JSON.stringify(made.problems))

    expect(validateProject(made.project).ok).toBe(true)
    expect(made.regeneratedIds).toEqual([])
    expect(made.project.id).toBe('proj-floor-plan')
    expect(made.project.meta).toEqual({ name: 'Floor plan' })
    expect(made.project.preferences).toEqual({ displayUnit: 'mm', displayPrecision: 0 })
    expect(made.project.floors).toEqual([{ id: 'floor-1', name: 'Floor 1', planImage: content.planImage }])
    // 7 objects + 1 template, and only the objects are placed.
    expect(made.project.itemDesigns).toHaveLength(8)
    expect(made.project.existingModel.placedItems).toHaveLength(7)
  })

  it('resolves a collision with the Project it is given an id for', async () => {
    const content = await planContent()
    const first = content.itemDesigns[0]
    if (first === undefined) throw new Error('expected an object')
    // The legacy sofa arrives wanting to be called after the Project itself.
    const colliding: LegacyFloorPlanContent = {
      ...content,
      itemDesigns: [{ ...first, id: 'proj-floor-plan' }, ...content.itemDesigns.slice(1)],
      placements: content.placements.map((item) =>
        (item.itemDesignId === first.id ? { ...item, itemDesignId: 'proj-floor-plan' } : item)),
    }

    const made = floorPlanAsProject(colliding, {
      projectId: 'proj-floor-plan',
      name: 'Floor plan',
      floorId: 'floor-1',
      newId: allocator(),
    })
    if (!made.ok) throw new Error(JSON.stringify(made.problems))

    expect(validateProject(made.project).ok).toBe(true)
    // `gen-1` went to the Floor's Plan View, so the regenerated id is the next one (#56).
    expect(made.regeneratedIds).toEqual([
      { scope: 'floor-plan', path: 'itemDesigns[0].id', oldId: 'proj-floor-plan', newId: 'gen-2' },
    ])
    expect(made.project.existingModel.placedItems[0]?.itemDesignId).toBe('gen-2')
  })
})
