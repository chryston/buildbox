import { describe, expect, it } from 'vitest'
import { MAX_TREE_DEPTH, rectangleFootprint, validateProject } from './index'
import type { CabinetNode, GenericItemDesign, Opening, Project } from './index'

// A Project small enough to read and complete enough to reach every level of the schema:
// two Floors, one cabinet Item Design whose root splits into two voids, one generic Item
// Design, and one Placed Item tying them together.
function baseProject(): Project {
  return {
    id: 'project-0',
    meta: { name: 'Maple Street Kitchen', address: '412 Maple Street' },
    preferences: { displayUnit: 'cm', displayPrecision: 1, defaultWallHeight: 2600 },
    floors: [
      {
        id: 'floor-0',
        name: 'Floor 1',
        planImage: {
          assetHash: 'a'.repeat(64),
          mediaType: 'image/png',
          widthPx: 2400,
          heightPx: 1600,
          pixelsPerMm: 0.5,
        },
      },
      { id: 'floor-1', name: 'Mezzanine', planImage: null },
    ],
    views: [
      { id: 'view-0', kind: 'plan', floorId: 'floor-0', name: 'Floor 1', isDefault: true, showPlanImage: true, planViewRange: { lowerMm: 0, upperMm: 2600 } },
      { id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Mezzanine', isDefault: true, showPlanImage: true, planViewRange: { lowerMm: 0, upperMm: 2600 } },
    ],
    itemDesigns: [
      {
        id: 'design-0',
        kind: 'cabinet',
        name: 'Base Cabinet',
        construction: {
          settings: {
            unit: 'mm',
            height: 850,
            width: 600,
            depth: 560,
            thickness: 18,
            backThickness: 6,
            toeKick: { height: 100, setback: 50 },
            material: 'walnut',
          },
          root: {
            id: 'node-root',
            splitAxis: 'horizontal',
            splitRatio: 0.6,
            children: [
              { id: 'node-left', drawerConfig: { slideType: 'undermount', reveal: 20 } },
              { id: 'node-right', locked: true, fixedSize: 300, elementType: 'hanging-space' },
            ],
          },
        },
      },
      {
        id: 'design-1',
        kind: 'generic',
        name: 'King Bed',
        footprint: rectangleFootprint(1820, 1980),
        origin: { x: 910, y: 990 },
        height: 500,
        heightIsTypical: true,
        color: '#8b5a2b',
        catalogKey: 'bed-king',
      },
    ],
    existingModel: {
      walls: [],
      wallJunctions: [],
      openings: [],
      rooms: [],
      beams: [],
      placedItems: [
        {
          id: 'place-0',
          itemDesignId: 'design-0',
          floorId: 'floor-0',
          translation: { x: 1200, y: 0 },
          rotationDeg: 90,
          baseElevation: 0,
        },
      ],
    },
    warningAcknowledgements: [],
    comments: [],
    commentReferenceCounter: 0,
  }
}

/** The cabinet Item Design of the base Project, narrowed once for the tests below. */
function baseCabinet(project: Project): Project['itemDesigns'][number] & { kind: 'cabinet' } {
  const design = project.itemDesigns[0]
  if (design.kind !== 'cabinet') throw new Error('the base Project leads with a cabinet')
  return design
}

function cabinetRoot(project: Project): CabinetNode {
  return baseCabinet(project).construction.root
}

/** The base Project with the cabinet's root replaced by an untrusted shape. */
function withCabinetRoot(root: unknown): unknown {
  const project = baseProject()
  const design = baseCabinet(project)
  const swapped = { ...design, construction: { ...design.construction, root } }
  return { ...project, itemDesigns: [swapped, project.itemDesigns[1]] }
}

/** The base Project with one Floor replaced by an untrusted shape. */
function withFloor(index: number, floor: unknown): unknown {
  const project = baseProject()
  const floors: unknown[] = [...project.floors]
  floors[index] = floor
  return { ...project, floors }
}

/** The generic Item Design of the base Project, narrowed once for the tests below. */
function baseGeneric(project: Project): GenericItemDesign {
  const design = project.itemDesigns[1]
  if (design.kind !== 'generic') throw new Error('the base Project has a generic second')
  return design
}

/** One space of the base cabinet's root split. */
function baseChild(project: Project, index: number): CabinetNode {
  const children = cabinetRoot(project).children
  if (children === undefined) throw new Error('the base cabinet root is split')
  return children[index]
}

/** A chain of splits whose deepest void sits at depth `levels`, each node ID unique. */
function chainTree(levels: number): CabinetNode {
  let node: CabinetNode = { id: 'deep-0' }
  for (let level = 0; level < levels; level += 1) {
    node = {
      id: `deep-${level + 1}`,
      splitAxis: 'vertical',
      splitRatio: 0.5,
      children: [node, { id: `deep-sibling-${level}` }],
    }
  }
  return node
}

function problemsOf(value: unknown): { path: string; code: string }[] {
  const result = validateProject(value)
  return result.ok ? [] : result.problems.map(({ path, code }) => ({ path, code }))
}

/** The exact `{path, code}` pairs, in the order the validator reported them. */
function expectProblems(value: unknown, expected: { path: string; code: string }[]): void {
  expect(problemsOf(value)).toEqual(expected)
}

/**
 * The Item Footprint, checked strictly (#58 §7).
 *
 * The point of these cases is the last one: an impossible shape arriving in a Backup is
 * refused with the geometry kernel's own sentence, the same words the editor shows while a
 * proposal is on screen. Two doors, one rule.
 */
describe('validateProject — the Item Footprint (#58)', () => {
  /** `{path, code, message}` triples, because the message is the thing under test. */
  function problemsWithMessages(value: unknown): { path: string; code: string; message: string }[] {
    const result = validateProject(value)
    return result.ok ? [] : result.problems.map(({ path, code, message }) => ({ path, code, message }))
  }

  const bed = (footprint: unknown): Project => {
    const project = baseProject()
    baseGeneric(project).footprint = footprint as never
    return project
  }

  it('refuses a radius left on a Rectangle, which has no such field', () => {
    expectProblems(
      bed({ kind: 'preset', preset: { kind: 'rectangle', width: 1820, depth: 1980, radius: 40 }, centre: { x: 910, y: 990 }, orientationDeg: 0 }),
      [{ path: 'itemDesigns[1].footprint.preset.radius', code: 'unknown-field' }],
    )
  })

  it('refuses a footprint that is still a v2 width-and-depth pair', () => {
    // `rectangle` is a preset kind, not a footprint kind: the first thing the validator says
    // is that it cannot tell what this footprint is supposed to be.
    expectProblems(bed({ kind: 'rectangle', width: 1820, depth: 1980 }), [
      { path: 'itemDesigns[1].footprint.kind', code: 'not-one-of' },
    ])
  })

  it('refuses a preset kind this build does not know', () => {
    expectProblems(
      bed({ kind: 'preset', preset: { kind: 'hexagon', width: 100 }, centre: { x: 50, y: 50 }, orientationDeg: 0 }),
      [{ path: 'itemDesigns[1].footprint.preset.kind', code: 'not-one-of' }],
    )
  })

  it('refuses a footprint kind that is neither preset nor path', () => {
    expectProblems(bed({ kind: 'circle', diameter: 100 }), [
      { path: 'itemDesigns[1].footprint.kind', code: 'not-one-of' },
    ])
  })

  it('refuses an impossible corner radius in the kernel\'s sentence', () => {
    const overlapping = {
      kind: 'preset',
      preset: {
        kind: 'roundedRectangle',
        width: 2000,
        depth: 3000,
        radii: { topLeft: 1000, topRight: 1001, bottomRight: 0, bottomLeft: 0 },
      },
      centre: { x: 1000, y: 1500 },
      orientationDeg: 0,
    }
    // The base Project displays centimetres at one decimal, and the sentence says so: the
    // refusal is written in the units the person reading it asked for.
    expect(problemsWithMessages(bed(overlapping))).toEqual([
      {
        path: 'itemDesigns[1].footprint',
        code: 'corner-radii-overlap',
        message: 'Corner radii on the top side overlap (100.0 + 100.1 > 200.0 cm)',
      },
    ])

    const inMillimetres = bed(overlapping)
    inMillimetres.preferences = { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 }
    expect(problemsWithMessages(inMillimetres)).toEqual([
      {
        path: 'itemDesigns[1].footprint',
        code: 'corner-radii-overlap',
        message: 'Corner radii on the top side overlap (1,000 + 1,001 > 2,000 mm)',
      },
    ])
  })

  it('refuses a Custom Path that does not close, and names the Edge', () => {
    const [problem] = problemsWithMessages(
      bed({
        kind: 'path',
        path: {
          start: { x: 0, y: 0 },
          segments: [
            { kind: 'line', to: { x: 100, y: 0 } },
            { kind: 'line', to: { x: 100, y: 100 } },
            { kind: 'line', to: { x: 0, y: 90 } },
          ],
        },
      }),
    )
    expect(problem).toEqual({
      path: 'itemDesigns[1].footprint.segments[2]',
      code: 'arc-not-closed',
      message: "Edge 3 doesn't meet its neighbour",
    })
  })

  it('refuses a shape that encloses nothing rather than storing a line as a footprint', () => {
    expectProblems(
      bed({
        kind: 'path',
        path: {
          start: { x: 0, y: 0 },
          segments: [
            { kind: 'line', to: { x: 100, y: 100 } },
            { kind: 'line', to: { x: 100, y: 0 } },
            { kind: 'line', to: { x: 0, y: 100 } },
            { kind: 'line', to: { x: 0, y: 0 } },
          ],
        },
      }),
      [
        { path: 'itemDesigns[1].footprint.segments[0]', code: 'edges-cross' },
        { path: 'itemDesigns[1].footprint.segments[0]', code: 'no-area' },
      ],
    )
  })

  it('stops at the structure when there is no shape to check', () => {
    // A preset with no side has no loop to hand the kernel, so the answer is one missing
    // field and not a pile of geometry complaints about a shape that does not exist.
    expectProblems(bed({ kind: 'preset', preset: { kind: 'square' }, centre: { x: 0, y: 0 }, orientationDeg: 0 }), [
      { path: 'itemDesigns[1].footprint.preset.side', code: 'missing-field' },
    ])
  })

  it('accepts a Custom Path that is a real shape', () => {
    const project = bed({
      kind: 'path',
      path: {
        start: { x: 0, y: 0 },
        segments: [
          { kind: 'line', to: { x: 1200, y: 0 } },
          { kind: 'line', to: { x: 1200, y: 600 } },
          { kind: 'line', to: { x: 0, y: 600 } },
          { kind: 'line', to: { x: 0, y: 0 } },
        ],
      },
    })
    expect(validateProject(project).ok).toBe(true)
  })

  it('accepts a turned preset, because a turn is not a defect', () => {
    const project = bed({
      kind: 'preset',
      preset: { kind: 'circle', diameter: 1600 },
      centre: { x: 800, y: 800 },
      orientationDeg: 37,
    })
    expect(validateProject(project).ok).toBe(true)
  })
})

describe('validateProject — the root', () => {
  it('accepts a valid Project and hands back the same reference', () => {
    const project = baseProject()
    const result = validateProject(project)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project).toBe(project)
  })

  it('reports a value that is not a plain object at the root path', () => {
    for (const value of [null, undefined, 42, 'project', [], true]) {
      expectProblems(value, [{ path: '', code: 'wrong-type' }])
    }
  })

  it('treats an undefined-valued key as absent', () => {
    const project = { ...baseProject(), meta: { name: 'Kitchen', address: undefined } }
    expect(validateProject(project).ok).toBe(true)
  })

  it('never mutates its input', () => {
    const project = baseProject()
    baseGeneric(project).color = '#GGG'
    const before = JSON.stringify(project)
    validateProject(project)
    expect(JSON.stringify(project)).toBe(before)
  })
})

describe('validateProject — IDs (#42 §3)', () => {
  const badIds: { why: string; id: string }[] = [
    { why: 'empty', id: '' },
    { why: 'a lone space', id: ' ' },
    { why: 'a leading space', id: ' project-0' },
    { why: 'a trailing space', id: 'project-0 ' },
    { why: 'a NUL', id: 'project-0\0' },
    { why: 'a control character', id: 'project-\u001f0' },
    { why: 'a delete', id: 'project-\u007f0' },
    { why: '129 characters long', id: 'x'.repeat(129) },
  ]

  it.each(badIds)('rejects an EntityId that is $why', ({ id }) => {
    expectProblems({ ...baseProject(), id }, [{ path: 'id', code: 'bad-id' }])
  })

  it('keeps a 128-character ID, a nanoid and a UUID', () => {
    for (const id of ['x'.repeat(128), 'V1StGXR8_Z5jdHi6B-myT', '3f2504e0-4f89-11d3-9a0c-0305e82c3301']) {
      expect(validateProject({ ...baseProject(), id }).ok).toBe(true)
    }
  })

  it('reports a duplicate ID on the second occurrence and names the first in the message', () => {
    const project = baseProject()
    project.existingModel.placedItems[0].id = 'floor-0'
    const result = validateProject(project)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: 'existingModel.placedItems[0].id', code: 'duplicate-id' },
    ])
    expect(result.problems[0].message).toContain('floors[0].id')
  })

  it('reports every occurrence after the first', () => {
    const project = baseProject()
    project.floors[1].id = 'floor-0'
    project.existingModel.placedItems[0].id = 'floor-0'
    expectProblems(project, [
      { path: 'floors[1].id', code: 'duplicate-id' },
      // The Mezzanine's Plan View now names an id no Floor answers to (#56).
      { path: 'views[1].floorId', code: 'dangling-reference' },
      { path: 'existingModel.placedItems[0].id', code: 'duplicate-id' },
    ])
  })
})

describe('validateProject — text and preferences', () => {
  it('requires trimmed non-empty text', () => {
    expectProblems({ ...baseProject(), meta: { name: '   ' } }, [{ path: 'meta.name', code: 'empty-text' }])
    expectProblems({ ...baseProject(), meta: { name: 'Kitchen', address: '  ' } }, [
      { path: 'meta.address', code: 'empty-text' },
    ])
  })

  it('accepts a Project with no address at all', () => {
    expect(validateProject({ ...baseProject(), meta: { name: 'Kitchen' } }).ok).toBe(true)
  })

  it('checks the display unit and precision', () => {
    expectProblems({ ...baseProject(), preferences: { displayUnit: 'in', displayPrecision: 1, defaultWallHeight: 2600 } }, [
      { path: 'preferences.displayUnit', code: 'not-one-of' },
    ])
    expectProblems({ ...baseProject(), preferences: { displayUnit: 'cm', displayPrecision: 5, defaultWallHeight: 2600 } }, [
      { path: 'preferences.displayPrecision', code: 'out-of-range' },
    ])
    expectProblems({ ...baseProject(), preferences: { displayUnit: 'cm', displayPrecision: 1.5, defaultWallHeight: 2600 } }, [
      { path: 'preferences.displayPrecision', code: 'out-of-range' },
    ])
  })
})

describe('validateProject — Floors and Plan Images', () => {
  it('reports a Floor name that only differs in case or spacing', () => {
    const project = baseProject()
    project.floors[1].name = ' floor 1 '
    expectProblems(project, [{ path: 'floors[1].name', code: 'duplicate-name' }])
  })

  it('requires a Floor name', () => {
    const project = baseProject()
    project.floors[0].name = ''
    expectProblems(project, [{ path: 'floors[0].name', code: 'empty-text' }])
  })

  it('accepts a Project with no Floors and no Placed Items', () => {
    const project = { ...baseProject(), floors: [], views: [], existingModel: { placedItems: [], walls: [], wallJunctions: [], openings: [], rooms: [], beams: [] } }
    expect(validateProject(project).ok).toBe(true)
  })

  it('checks the asset hash, media type, pixel size and scale', () => {
    const project = baseProject()
    const image = project.floors[0].planImage
    if (image === null) throw new Error('the base Project has a Plan Image')

    image.assetHash = 'ABC'
    expectProblems(project, [{ path: 'floors[0].planImage.assetHash', code: 'bad-format' }])

    image.assetHash = 'a'.repeat(64)
    image.mediaType = 'image/tiff' as never
    expectProblems(project, [{ path: 'floors[0].planImage.mediaType', code: 'not-one-of' }])

    image.mediaType = 'image/png'
    image.widthPx = 0
    expectProblems(project, [{ path: 'floors[0].planImage.widthPx', code: 'out-of-range' }])

    image.widthPx = 2400
    image.heightPx = 1600.5
    expectProblems(project, [{ path: 'floors[0].planImage.heightPx', code: 'out-of-range' }])

    image.heightPx = 1600
    image.pixelsPerMm = -1
    expectProblems(project, [{ path: 'floors[0].planImage.pixelsPerMm', code: 'out-of-range' }])
  })

  it('requires the scale key, even when it would be null', () => {
    expectProblems(
      withFloor(1, { id: 'floor-1', name: 'Mezzanine', planImage: { assetHash: 'b'.repeat(64), mediaType: 'image/jpeg', widthPx: 10, heightPx: 20 } }),
      [{ path: 'floors[1].planImage.pixelsPerMm', code: 'missing-field' }],
    )
  })

  it('reports unknown fields after the known ones, sorted by key', () => {
    expectProblems(withFloor(1, { id: 'floor-1', name: 'Mezzanine', alpha: 2, zebra: 1 }), [
      { path: 'floors[1].planImage', code: 'missing-field' },
      { path: 'floors[1].alpha', code: 'unknown-field' },
      { path: 'floors[1].zebra', code: 'unknown-field' },
    ])
  })
})

describe('validateProject — Item Designs', () => {
  it('requires a known kind', () => {
    const project = baseProject()
    baseGeneric(project).kind = 'sofa' as never
    expectProblems(project, [{ path: 'itemDesigns[1].kind', code: 'not-one-of' }])
  })

  it('requires a name', () => {
    const project = baseProject()
    project.itemDesigns[0].name = ' '
    expectProblems(project, [{ path: 'itemDesigns[0].name', code: 'empty-text' }])
  })

  it('checks the generic footprint, height and color', () => {
    const project = baseProject()
    const bed = baseGeneric(project)

    bed.footprint = { kind: 'circle', width: 100, depth: 100 } as never
    expectProblems(project, [{ path: 'itemDesigns[1].footprint.kind', code: 'not-one-of' }])

    bed.footprint = rectangleFootprint(0, 1980)
    expectProblems(project, [{ path: 'itemDesigns[1].footprint', code: 'size-not-positive' }])

    bed.footprint = rectangleFootprint(1820, 1980)
    bed.height = Number.NaN
    expectProblems(project, [{ path: 'itemDesigns[1].height', code: 'out-of-range' }])

    bed.height = 500
    bed.color = '#FFF'
    expectProblems(project, [{ path: 'itemDesigns[1].color', code: 'bad-format' }])

    bed.color = '#8b5a2b'
    bed.catalogKey = '  '
    expectProblems(project, [{ path: 'itemDesigns[1].catalogKey', code: 'empty-text' }])
  })

  it('checks the cabinet settings', () => {
    const project = baseProject()
    const settings = baseCabinet(project).construction.settings

    settings.unit = 'ft' as never
    expectProblems(project, [{ path: 'itemDesigns[0].construction.settings.unit', code: 'not-one-of' }])

    settings.unit = 'mm'
    settings.width = Number.POSITIVE_INFINITY
    expectProblems(project, [{ path: 'itemDesigns[0].construction.settings.width', code: 'out-of-range' }])

    settings.width = 600
    settings.backThickness = -1
    expectProblems(project, [
      { path: 'itemDesigns[0].construction.settings.backThickness', code: 'out-of-range' },
    ])

    settings.backThickness = 6
    settings.material = 'plywood' as never
    expectProblems(project, [{ path: 'itemDesigns[0].construction.settings.material', code: 'not-one-of' }])

    settings.material = 'walnut'
    settings.toeKick = { height: -1, setback: 50 }
    expectProblems(project, [
      { path: 'itemDesigns[0].construction.settings.toeKick.height', code: 'out-of-range' },
    ])
  })

  it('rejects a field v1 has never heard of, inside the payload too', () => {
    const root = cabinetRoot(baseProject())
    expectProblems(withCabinetRoot({ ...root, material: 'walnut' }), [
      { path: 'itemDesigns[0].construction.root.material', code: 'unknown-field' },
    ])
  })
})

describe('validateProject — the cabinet tree', () => {
  it('requires exactly two spaces under a split, and a split above two spaces', () => {
    const root = cabinetRoot(baseProject())
    expectProblems(withCabinetRoot({ ...root, children: [{ id: 'node-left' }] }), [
      { path: 'itemDesigns[0].construction.root.children', code: 'bad-children' },
    ])
    expectProblems(withCabinetRoot({ ...root, splitAxis: undefined }), [
      { path: 'itemDesigns[0].construction.root.splitAxis', code: 'bad-children' },
    ])
    expectProblems(withCabinetRoot({ ...root, children: undefined }), [
      { path: 'itemDesigns[0].construction.root.children', code: 'bad-children' },
    ])
  })

  it('keeps the split share strictly between 0 and 1', () => {
    for (const splitRatio of [0, 1, 1.5, -0.5]) {
      const project = baseProject()
      cabinetRoot(project).splitRatio = splitRatio
      expectProblems(project, [
        { path: 'itemDesigns[0].construction.root.splitRatio', code: 'out-of-range' },
      ])
    }
  })

  it('checks the node fields where they sit', () => {
    const project = baseProject()
    const right = baseChild(project, 1)

    right.fixedSize = 0
    expectProblems(project, [
      { path: 'itemDesigns[0].construction.root.children[1].fixedSize', code: 'out-of-range' },
    ])

    right.fixedSize = 300
    right.locked = 'yes' as never
    expectProblems(project, [
      { path: 'itemDesigns[0].construction.root.children[1].locked', code: 'wrong-type' },
    ])

    right.locked = true
    right.elementType = 'pipe' as never
    expectProblems(project, [
      { path: 'itemDesigns[0].construction.root.children[1].elementType', code: 'not-one-of' },
    ])

    const left = baseChild(project, 0)
    right.elementType = undefined
    left.drawerConfig = { slideType: 'centre-mount', reveal: 20 } as never
    expectProblems(project, [
      { path: 'itemDesigns[0].construction.root.children[0].drawerConfig.slideType', code: 'not-one-of' },
    ])

    left.drawerConfig = { slideType: 'undermount', reveal: -1 }
    expectProblems(project, [
      { path: 'itemDesigns[0].construction.root.children[0].drawerConfig.reveal', code: 'out-of-range' },
    ])
  })

  it('checks dividers and accessories', () => {
    const project = baseProject()
    const root = cabinetRoot(project)

    root.dividers = [{ id: 'div-0', materialId: 'plywood' } as never]
    expectProblems(project, [
      { path: 'itemDesigns[0].construction.root.dividers[0].materialId', code: 'not-one-of' },
    ])

    root.dividers = [{ id: 'div-0', materialId: 'birch', thickness: 18 } as never]
    expectProblems(project, [
      { path: 'itemDesigns[0].construction.root.dividers[0].thickness', code: 'unknown-field' },
    ])

    root.dividers = undefined
    root.accessories = [{ id: 'acc-0', type: 'light' } as never]
    expectProblems(project, [
      { path: 'itemDesigns[0].construction.root.accessories[0].type', code: 'not-one-of' },
    ])
  })

  it('reports a tree deeper than MAX_TREE_DEPTH once, against the root', () => {
    const project = baseProject()
    baseCabinet(project).construction.root = chainTree(MAX_TREE_DEPTH + 1)
    expectProblems(project, [{ path: 'itemDesigns[0].construction.root', code: 'tree-too-deep' }])
  })

  it('accepts a tree exactly MAX_TREE_DEPTH deep', () => {
    const project = baseProject()
    baseCabinet(project).construction.root = chainTree(MAX_TREE_DEPTH)
    expect(validateProject(project).ok).toBe(true)
  })

  it('catches a cycle instead of walking forever', () => {
    const project = baseProject()
    const root = cabinetRoot(project)
    const child = baseChild(project, 1)
    child.splitAxis = 'vertical'
    child.children = [root, root]
    expectProblems(project, [
      { path: 'itemDesigns[0].construction.root.children[1].children[0]', code: 'bad-children' },
      { path: 'itemDesigns[0].construction.root.children[1].children[1]', code: 'bad-children' },
    ])
  })

  it('scopes feature IDs to their own Item Design (#42 §3)', () => {
    const project = baseProject()
    const cabinet = baseCabinet(project)
    // A forked cabinet: the same node IDs again, in a second Item Design.
    project.itemDesigns.push({ ...structuredClone(cabinet), id: 'design-2' })
    expect(validateProject(project).ok).toBe(true)

    baseChild(project, 1).id = cabinet.construction.root.id
    expectProblems(project, [
      { path: 'itemDesigns[0].construction.root.children[1].id', code: 'duplicate-id' },
    ])
  })

  it('requires a space ID written as text', () => {
    const project = baseProject()
    baseChild(project, 0).id = 42 as never
    expectProblems(project, [
      { path: 'itemDesigns[0].construction.root.children[0].id', code: 'wrong-type' },
    ])
  })
})

describe('validateProject — the Existing Model', () => {
  it('refuses a Placed Item that names no Item Design', () => {
    const project = baseProject()
    project.existingModel.placedItems[0].itemDesignId = 'design-missing'
    expectProblems(project, [
      { path: 'existingModel.placedItems[0].itemDesignId', code: 'dangling-reference' },
    ])
  })

  it('refuses a Placed Item that names no Floor', () => {
    const project = baseProject()
    project.existingModel.placedItems[0].floorId = 'floor-missing'
    expectProblems(project, [{ path: 'existingModel.placedItems[0].floorId', code: 'dangling-reference' }])
  })

  it('accepts an Item Design nothing places', () => {
    const project = baseProject()
    project.existingModel.placedItems = []
    expect(validateProject(project).ok).toBe(true)
  })

  it('keeps rotation inside a turn and elevation anywhere', () => {
    const project = baseProject()
    const item = project.existingModel.placedItems[0]

    item.rotationDeg = 360
    expectProblems(project, [
      { path: 'existingModel.placedItems[0].rotationDeg', code: 'out-of-range' },
    ])

    item.rotationDeg = 270
    item.baseElevation = -150
    expect(validateProject(project).ok).toBe(true)

    item.baseElevation = Number.NEGATIVE_INFINITY
    expectProblems(project, [
      { path: 'existingModel.placedItems[0].baseElevation', code: 'out-of-range' },
    ])

    item.baseElevation = 0
    item.translation = { x: 0, y: Number.NaN }
    expectProblems(project, [
      { path: 'existingModel.placedItems[0].translation.y', code: 'out-of-range' },
    ])
  })
})

/**
 * An Opening needs a Wall to be cut into, so these cases start from one 4 000 mm Wall
 * along the X axis — free at both ends, so its usable interval is its whole length.
 */
function withWall(project: Project): Project {
  project.existingModel.walls = [
    {
      id: 'wall-0',
      ref: 'W-1',
      floorId: 'floor-0',
      line: { kind: 'line', start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } },
      thickness: 100,
      justification: 'centre',
      baseElevation: 0,
      height: 2600,
    },
  ]
  return project
}

function doorOpening(over: Partial<Opening> = {}): Opening {
  return {
    id: 'opening-0',
    floorId: 'floor-0',
    hostWallId: 'wall-0',
    kind: 'door',
    label: 'Door 1',
    start: 1200,
    width: 900,
    sill: 0,
    head: 2100,
    swing: 'left',
    hingeSide: 'start',
    ...over,
  }
}

function withOpenings(project: Project, openings: readonly Opening[]): Project {
  project.existingModel.openings = [...openings]
  return project
}

/** The sentences, in the order reported — the words a user would actually be shown. */
function messagesOf(value: unknown): string[] {
  const result = validateProject(value)
  return result.ok ? [] : result.problems.map((problem) => problem.message)
}

/**
 * The Openings collection, checked strictly (#65 §9). An Opening is an absence in exactly
 * one Wall, so most of what can go wrong is a reference or a position that no longer
 * describes a hole in that Wall — and every one of those is refused rather than drawn
 * somewhere near.
 */
describe('validateProject — the Openings collection (#65)', () => {
  it('accepts a door, a window and a removed section on one Wall', () => {
    const project = withOpenings(withWall(baseProject()), [
      doorOpening(),
      doorOpening({ id: 'opening-1', kind: 'window', label: 'Window 1', start: 2400, sill: 1050, head: 2300, swing: undefined, hingeSide: undefined }),
      doorOpening({ id: 'opening-2', kind: 'removed_section', label: 'Removed section 1', start: 3700, width: 300, head: 2600, swing: undefined, hingeSide: undefined }),
    ])
    expectProblems(project, [])
  })

  it('refuses an Opening whose Wall is not in the Project', () => {
    const project = withOpenings(withWall(baseProject()), [doorOpening({ hostWallId: 'wall-missing' })])
    expectProblems(project, [
      { path: 'existingModel.openings[0].hostWallId', code: 'dangling-reference' },
    ])
  })

  it('refuses an Opening whose Wall stands on another Floor', () => {
    const project = withOpenings(withWall(baseProject()), [doorOpening({ floorId: 'floor-1' })])
    expectProblems(project, [
      { path: 'existingModel.openings[0].hostWallId', code: 'dangling-reference' },
    ])
  })

  it('refuses an Opening past the end of its Wall, in the words the editor shows', () => {
    const project = withOpenings(withWall(baseProject()), [doorOpening({ start: 3200 })])
    expectProblems(project, [{ path: 'existingModel.openings[0].start', code: 'out-of-range' }])
    expect(messagesOf(project)).toEqual(['Door 1 would run past the end of W-1. Move or narrow it first.'])
  })

  it('refuses an Opening that would cross the join it is centred on', () => {
    const project = withOpenings(withWall(baseProject()), [doorOpening({ start: 1050 })])
    project.existingModel.walls.push({
      ...project.existingModel.walls[0]!,
      id: 'wall-1',
      ref: 'W-2',
      // A hosted Junction stores its end on the host, so the branch begins at 1 500.
      line: { kind: 'line', start: { x: 1500, y: 0 }, end: { x: 1500, y: 1500 } },
    })
    project.existingModel.wallJunctions = [
      {
        id: 'junction-0',
        floorId: 'floor-0',
        ends: [{ wallId: 'wall-1', end: 'start' }],
        host: { wallId: 'wall-0', at: 1500 },
      },
    ]
    expect(messagesOf(project)).toEqual(['Door 1 would cross the join with W-2.'])
  })

  it('says the Wall is shorter than the Opening when there is no room anywhere', () => {
    const project = withOpenings(withWall(baseProject()), [doorOpening({ width: 4500 })])
    expectProblems(project, [{ path: 'existingModel.openings[0].start', code: 'out-of-range' }])
    expect(messagesOf(project)).toEqual(['This wall is shorter than a 4500 mm door.'])
  })

  it('refuses an Opening whose top is at or below its bottom', () => {
    const project = withOpenings(withWall(baseProject()), [doorOpening({ head: 0 })])
    expectProblems(project, [{ path: 'existingModel.openings[0].head', code: 'out-of-range' }])
  })

  it('refuses an Opening with no width', () => {
    const project = withOpenings(withWall(baseProject()), [doorOpening({ width: 0 })])
    expectProblems(project, [{ path: 'existingModel.openings[0].width', code: 'out-of-range' }])
  })

  it('refuses a door that does not say which way it swings', () => {
    const project = withOpenings(withWall(baseProject()), [doorOpening({ swing: undefined })])
    expectProblems(project, [{ path: 'existingModel.openings[0].swing', code: 'missing-field' }])
  })

  it('refuses a hinged door that does not say which jamb it hangs on', () => {
    const project = withOpenings(withWall(baseProject()), [doorOpening({ hingeSide: undefined })])
    expectProblems(project, [{ path: 'existingModel.openings[0].hingeSide', code: 'missing-field' }])
  })

  it('refuses a sliding door that still names a jamb', () => {
    const project = withOpenings(withWall(baseProject()), [doorOpening({ swing: 'sliding' })])
    expectProblems(project, [{ path: 'existingModel.openings[0].hingeSide', code: 'unknown-field' }])
  })

  it('refuses a window carrying door fields', () => {
    const project = withOpenings(withWall(baseProject()), [doorOpening({ kind: 'window' })])
    expectProblems(project, [
      { path: 'existingModel.openings[0].swing', code: 'unknown-field' },
      { path: 'existingModel.openings[0].hingeSide', code: 'unknown-field' },
    ])
  })

  it('refuses a field no Opening has', () => {
    const project = withOpenings(withWall(baseProject()), [doorOpening()])
    ;(project.existingModel.openings[0] as unknown as Record<string, unknown>).fireRating = 'EI 30'
    expectProblems(project, [{ path: 'existingModel.openings[0].fireRating', code: 'unknown-field' }])
  })

  it('claims an Opening ID, so no second entity may use it', () => {
    const project = withOpenings(withWall(baseProject()), [doorOpening({ id: 'floor-0' })])
    expectProblems(project, [{ path: 'existingModel.openings[0].id', code: 'duplicate-id' }])
  })
})

describe('validateProject — reporting every problem', () => {
  it('lists five independent problems in document order', () => {
    const project = baseProject()
    project.meta.name = '   '
    project.preferences.displayPrecision = 9
    project.floors[0].name = ''
    project.itemDesigns[0].name = ''
    project.existingModel.placedItems[0].rotationDeg = 400
    expectProblems(project, [
      { path: 'meta.name', code: 'empty-text' },
      { path: 'preferences.displayPrecision', code: 'out-of-range' },
      { path: 'floors[0].name', code: 'empty-text' },
      { path: 'itemDesigns[0].name', code: 'empty-text' },
      { path: 'existingModel.placedItems[0].rotationDeg', code: 'out-of-range' },
    ])
  })

  it('walks the cabinet tree depth-first, each node before its children', () => {
    const project = baseProject()
    cabinetRoot(project).splitRatio = 1.5
    baseChild(project, 0).splitRatio = 1.5
    baseChild(project, 1).splitRatio = 1.5
    expectProblems(project, [
      { path: 'itemDesigns[0].construction.root.splitRatio', code: 'out-of-range' },
      { path: 'itemDesigns[0].construction.root.children[0].splitRatio', code: 'out-of-range' },
      { path: 'itemDesigns[0].construction.root.children[1].splitRatio', code: 'out-of-range' },
    ])
  })
})
