// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MAX_TREE_DEPTH, validateLegacyDesigns, validateLegacyFloorPlan, validateLegacyPersistedState } from './validate'
import type { ValidationProblem } from './problems'

const settings = {
  unit: 'mm',
  height: 720,
  width: 600,
  depth: 560,
  thickness: 18,
  backThickness: 12,
  toeKick: null,
  material: 'oak',
}

const leaf = (id: string): Record<string, unknown> => ({ id, fixedSize: 300 })

const split = (id: string, a: unknown, b: unknown, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  splitAxis: 'vertical',
  splitRatio: 0.5,
  children: [a, b],
  ...over,
})

const unit = (root: unknown, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'cabinet',
  id: 'unit-1',
  label: 'Unit 1',
  x: 0,
  y: 0,
  settings,
  root,
  ...over,
})

const design = (units: unknown, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'p1',
  name: 'Kitchen',
  units,
  ...over,
})

const designs = (value: unknown): ValidationProblem[] => validateLegacyDesigns(value, 'projects')
const oneDesign = (value: unknown): ValidationProblem[] => designs([value])
/** `path code` for every problem, in report order. */
/** A copy without `key`, for the rules that fire when a field is absent. */
function omit<T extends Record<string, unknown>>(value: T, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value }
  delete copy[key]
  return copy
}

const shown = (problems: ValidationProblem[]): string[] => problems.map((p) => `${p.path} ${p.code}`)
/** The codes reported at one exact path. */
const at = (problems: ValidationProblem[], path: string): string[] =>
  problems.filter((p) => p.path === path).map((p) => p.code)
const onlyAt = (problems: ValidationProblem[], path: string): string[] => at(problems, path)

/** A split chain of `levels` nodes; the root is depth 0, so the deepest is `levels - 1`. */
function chain(levels: number): Record<string, unknown> {
  let node: Record<string, unknown> = leaf('leaf')
  for (let level = 1; level < levels; level++) node = split(`n${level}`, leaf(`s${level}`), node)
  return node
}

const unitProblems = (root: unknown): ValidationProblem[] => oneDesign(design([unit(root)]))
const tree = (root: unknown): string[] => shown(unitProblems(root))

describe('validateLegacyDesigns — the file', () => {
  it('accepts a well-formed workspace', () => {
    expect(designs([design([unit(leaf('r'))])])).toEqual([])
  })

  it('reports missing projects by the base path', () => {
    expect(designs(undefined)).toEqual([{ path: 'projects', code: 'missing-field', message: 'Missing the list of projects.' }])
  })

  it('reports projects that is not a list', () => {
    expect(designs({})).toEqual([{ path: 'projects', code: 'wrong-type', message: 'Expected a list of projects.' }])
  })

  it('reports an empty project list, which the app can never export', () => {
    expect(designs([])).toEqual([{ path: 'projects', code: 'empty-list', message: 'Expected at least one project.' }])
  })

  it('reports a project that is not an object', () => {
    expect(shown(designs(['p1']))).toEqual(['projects[0] wrong-type'])
  })

  it('reports every field a project that is there but empty is missing', () => {
    expect(shown(oneDesign({}))).toEqual([
      'projects[0].id missing-field',
      'projects[0].name missing-field',
      'projects[0].units missing-field',
    ])
  })

  it('reports a project id that is not a non-empty string', () => {
    expect(at(oneDesign(design([unit(leaf('r'))], { id: '' })), 'projects[0].id')).toEqual(['wrong-type'])
    expect(at(oneDesign(design([unit(leaf('r'))], { id: 7 })), 'projects[0].id')).toEqual(['wrong-type'])
  })

  it('reports a project id used twice', () => {
    const two = [design([unit(leaf('r'))]), design([unit(leaf('r2'))])]
    expect(shown(designs(two))).toEqual([
      'projects[1].id duplicate-id',
    ])
  })
})

describe('validateLegacyDesigns — units', () => {
  it('reports a project with no units, an empty unit list, and units of the wrong type', () => {
    expect(at(oneDesign({ id: 'p1', name: 'A' }), 'projects[0].units')).toEqual(['missing-field'])
    expect(at(oneDesign(design([])), 'projects[0].units')).toEqual(['empty-list'])
    expect(at(oneDesign(design({})), 'projects[0].units')).toEqual(['wrong-type'])
  })

  it('reports a unit that is not an object', () => {
    expect(shown(oneDesign(design([null])))).toEqual(['projects[0].units[0] wrong-type'])
  })

  it('reports a unit whose type is missing or not cabinet', () => {
    expect(at(oneDesign(design([omit(unit(leaf('r')), 'type')])), 'projects[0].units[0].type')).toEqual(['missing-field'])
    expect(at(oneDesign(design([unit(leaf('r'), { type: 'countertop' })])), 'projects[0].units[0].type'))
      .toEqual(['not-one-of'])
  })

  it('reports a unit missing its id, label or position', () => {
    expect(shown(oneDesign(design([{ type: 'cabinet' }])))).toEqual([
      'projects[0].units[0].id missing-field',
      'projects[0].units[0].label missing-field',
      'projects[0].units[0].x missing-field',
      'projects[0].units[0].y missing-field',
      'projects[0].units[0].settings missing-field',
      'projects[0].units[0].root missing-field',
    ])
  })

  it('reports a position that is not a finite number', () => {
    expect(at(oneDesign(design([unit(leaf('r'), { x: '0' })])), 'projects[0].units[0].x')).toEqual(['wrong-type'])
    expect(at(oneDesign(design([unit(leaf('r'), { y: Number.NaN })])), 'projects[0].units[0].y')).toEqual(['wrong-type'])
  })

  it('reports a unit id used twice in the same project', () => {
    expect(shown(oneDesign(design([unit(leaf('a')), unit(leaf('b'))])))).toEqual([
      'projects[0].units[1].id duplicate-id',
    ])
  })

  it('allows the same unit id in two different projects', () => {
    expect(designs([design([unit(leaf('a'))]), design([unit(leaf('b'))], { id: 'p2' })])).toEqual([])
  })
})

describe('validateLegacyDesigns — settings', () => {
  const withSettings = (patch: Record<string, unknown> | null): ValidationProblem[] =>
    oneDesign(design([unit(leaf('r'), { settings: patch === null ? {} : { ...settings, ...patch } })]))

  it('accepts the settings the app writes', () => {
    expect(withSettings({ ...settings })).toEqual([])
  })

  it('reports settings that are missing altogether or not an object', () => {
    expect(at(oneDesign(design([{ type: 'cabinet', id: 'u', label: 'l', x: 0, y: 0, root: leaf('r') }])), 'projects[0].units[0].settings'))
      .toEqual(['missing-field'])
    expect(at(oneDesign(design([unit(leaf('r'), { settings: 'oak' })])), 'projects[0].units[0].settings'))
      .toEqual(['wrong-type'])
  })

  it('reports every field empty settings is missing, in the order the app writes them', () => {
    expect(shown(withSettings(null))).toEqual([
      'projects[0].units[0].settings.unit missing-field',
      'projects[0].units[0].settings.height missing-field',
      'projects[0].units[0].settings.width missing-field',
      'projects[0].units[0].settings.depth missing-field',
      'projects[0].units[0].settings.thickness missing-field',
      'projects[0].units[0].settings.backThickness missing-field',
      'projects[0].units[0].settings.toeKick missing-field',
      'projects[0].units[0].settings.material missing-field',
    ])
  })

  it('reports a unit outside mm, cm and in', () => {
    expect(onlyAt(withSettings({ unit: 'metres' }), 'projects[0].units[0].settings.unit')).toEqual(['not-one-of'])
  })

  it('reports a dimension that is zero, negative, missing or not a number', () => {
    for (const key of ['height', 'width', 'depth', 'thickness']) {
      const path = `projects[0].units[0].settings.${key}`
      expect(onlyAt(withSettings({ [key]: 0 }), path)).toEqual(['out-of-range'])
      expect(onlyAt(withSettings({ [key]: -1 }), path)).toEqual(['out-of-range'])
      expect(onlyAt(withSettings({ [key]: '600' }), path)).toEqual(['wrong-type'])
      expect(onlyAt(withSettings({ [key]: undefined }), path)).toEqual(['missing-field'])
    }
  })

  it('reports a dimension that is not a finite number', () => {
    // `Infinity` survives as a number in memory; only finite sizes can be laid out.
    expect(onlyAt(withSettings({ width: Number.POSITIVE_INFINITY }), 'projects[0].units[0].settings.width'))
      .toEqual(['wrong-type'])
  })

  it('accepts a back panel of no thickness and reports a negative one', () => {
    expect(withSettings({ backThickness: 0 })).toEqual([])
    expect(onlyAt(withSettings({ backThickness: -1 }), 'projects[0].units[0].settings.backThickness'))
      .toEqual(['out-of-range'])
  })

  it('accepts a toe kick of null, and one with a height and a setback', () => {
    expect(withSettings({ toeKick: null })).toEqual([])
    expect(withSettings({ toeKick: { height: 100, setback: 50 } })).toEqual([])
  })

  it('reports a toe kick that is missing, of the wrong type, or missing a field', () => {
    expect(onlyAt(withSettings({ toeKick: undefined }), 'projects[0].units[0].settings.toeKick')).toEqual(['missing-field'])
    expect(onlyAt(withSettings({ toeKick: 100 }), 'projects[0].units[0].settings.toeKick')).toEqual(['wrong-type'])
    expect(shown(withSettings({ toeKick: {} }))).toEqual([
      'projects[0].units[0].settings.toeKick.height missing-field',
      'projects[0].units[0].settings.toeKick.setback missing-field',
    ])
    expect(onlyAt(withSettings({ toeKick: { height: -1, setback: 'x' } }), 'projects[0].units[0].settings.toeKick.height'))
      .toEqual(['out-of-range'])
    expect(onlyAt(withSettings({ toeKick: { height: -1, setback: 'x' } }), 'projects[0].units[0].settings.toeKick.setback'))
      .toEqual(['wrong-type'])
  })

  it('reports a material outside the five the app offers', () => {
    expect(onlyAt(withSettings({ material: 'marble' }), 'projects[0].units[0].settings.material')).toEqual(['not-one-of'])
    expect(onlyAt(withSettings({ material: 3 }), 'projects[0].units[0].settings.material')).toEqual(['not-one-of'])
  })

  it('reports a settings object with no material at all', () => {
    const problems = oneDesign(design([unit(leaf('r'), {
      settings: { unit: 'mm', height: 1, width: 1, depth: 1, thickness: 1, backThickness: 0, toeKick: null },
    })]))
    expect(shown(problems)).toEqual(['projects[0].units[0].settings.material missing-field'])
  })

  it('accepts the pre-v2 material key the import upgrade leaves behind', () => {
    // A v0 Design spells the key `defaultMaterial`; `upgradeLegacyDesign` renames it to
    // `material` on the way in, so the raw shape the validator sees uses the old key.
    expect(oneDesign(design([unit(leaf('r'), { settings: { ...omit(settings, 'material'), defaultMaterial: 'oak' } })]))).toEqual([])
  })

  it('reports a bad value under the pre-v2 material key', () => {
    expect(at(oneDesign(design([unit(leaf('r'), { settings: { ...omit(settings, 'material'), defaultMaterial: 'marble' } })])), 'projects[0].units[0].settings.defaultMaterial'))
      .toEqual(['not-one-of'])
  })
})

describe('validateLegacyDesigns — nodes', () => {
  it('reports a node with no id', () => {
    expect(tree({ fixedSize: 100 })).toEqual(['projects[0].units[0].root.id missing-field'])
    expect(tree({ id: '', fixedSize: 100 })).toEqual(['projects[0].units[0].root.id wrong-type'])
  })

  it('accepts a node that carries a field the app has since removed', () => {
    // Node `material` predates persist v2 and is still in stored data.
    expect(tree({ id: 'r', fixedSize: 100, material: 'oak' })).toEqual([])
  })

  it('reports children that is not a pair', () => {
    expect(tree(split('r', leaf('a'), undefined, { children: [leaf('a')] }))).toEqual([
      'projects[0].units[0].root.children bad-children',
    ])
    expect(tree({ id: 'r', splitAxis: 'vertical', children: 'two' })).toEqual([
      'projects[0].units[0].root.children bad-children',
    ])
  })

  it('reports a split direction with nothing under it', () => {
    expect(tree({ id: 'r', splitAxis: 'vertical', fixedSize: 100 })).toEqual([
      'projects[0].units[0].root.children bad-children',
    ])
  })

  it('reports a pair of children with no split direction', () => {
    expect(tree({ id: 'r', splitRatio: 0.5, children: [leaf('a'), leaf('b')] })).toEqual([
      'projects[0].units[0].root.splitAxis bad-children',
    ])
  })

  it('reports a split axis outside horizontal and vertical', () => {
    expect(tree(split('r', leaf('a'), leaf('b'), { splitAxis: 'diagonal' }))).toEqual([
      'projects[0].units[0].root.splitAxis not-one-of',
    ])
  })

  it('reports a split ratio that is not strictly between 0 and 1', () => {
    for (const splitRatio of [0, 1, 1.5, -0.5]) {
      expect(tree(split('r', leaf('a'), leaf('b'), { splitRatio }))).toEqual([
        'projects[0].units[0].root.splitRatio out-of-range',
      ])
    }
    expect(tree(split('r', leaf('a'), leaf('b'), { splitRatio: '0.5' }))).toEqual([
      'projects[0].units[0].root.splitRatio wrong-type',
    ])
  })

  it('reports a fixed size that is zero, negative or not a number', () => {
    expect(tree({ id: 'r', fixedSize: 0 })).toEqual(['projects[0].units[0].root.fixedSize out-of-range'])
    expect(tree({ id: 'r', fixedSize: -10 })).toEqual(['projects[0].units[0].root.fixedSize out-of-range'])
    expect(tree({ id: 'r', fixedSize: '300' })).toEqual(['projects[0].units[0].root.fixedSize wrong-type'])
  })

  it('reports a locked flag or space label of the wrong type', () => {
    expect(tree({ id: 'r', fixedSize: 100, locked: 'yes' })).toEqual([
      'projects[0].units[0].root.locked wrong-type',
    ])
    expect(tree({ id: 'r', fixedSize: 100, spaceLabel: 5 })).toEqual([
      'projects[0].units[0].root.spaceLabel wrong-type',
    ])
    expect(tree({ id: 'r', fixedSize: 100, locked: true, spaceLabel: 'Sink' })).toEqual([])
  })

  it('reports an element type outside the four the app offers', () => {
    expect(tree({ id: 'r', fixedSize: 100, elementType: 'desk' })).toEqual([
      'projects[0].units[0].root.elementType not-one-of',
    ])
    for (const elementType of ['void', 'drawer', 'hanging-space', 'microwave']) {
      expect(tree({ id: 'r', fixedSize: 100, elementType })).toEqual([])
    }
  })

  it('accepts a drawer config and reports a bad one', () => {
    expect(tree({ id: 'r', fixedSize: 100, elementType: 'drawer', drawerConfig: { slideType: 'undermount', reveal: 2 } }))
      .toEqual([])
    expect(tree({ id: 'r', fixedSize: 100, drawerConfig: 'auto' })).toEqual([
      'projects[0].units[0].root.drawerConfig wrong-type',
    ])
    expect(tree({ id: 'r', fixedSize: 100, drawerConfig: { slideType: 'side-mount', reveal: 0 } })).toEqual([])
    expect(tree({ id: 'r', fixedSize: 100, drawerConfig: { slideType: 'telescopic', reveal: 2 } })).toEqual([
      'projects[0].units[0].root.drawerConfig.slideType not-one-of',
    ])
    expect(tree({ id: 'r', fixedSize: 100, drawerConfig: { slideType: 'undermount', reveal: -1 } })).toEqual([
      'projects[0].units[0].root.drawerConfig.reveal out-of-range',
    ])
    expect(tree({ id: 'r', fixedSize: 100, drawerConfig: {} })).toEqual([
      'projects[0].units[0].root.drawerConfig.slideType missing-field',
      'projects[0].units[0].root.drawerConfig.reveal missing-field',
    ])
  })

  it('accepts dividers and reports a divider that is not an id and a material', () => {
    expect(tree({ id: 'r', fixedSize: 100, dividers: [{ id: 'd1', materialId: 'mdf' }] })).toEqual([])
    expect(tree({ id: 'r', fixedSize: 100, dividers: 'none' })).toEqual([
      'projects[0].units[0].root.dividers wrong-type',
    ])
    expect(tree({ id: 'r', fixedSize: 100, dividers: [{}] })).toEqual([
      'projects[0].units[0].root.dividers[0].id missing-field',
      'projects[0].units[0].root.dividers[0].materialId missing-field',
    ])
    expect(tree({ id: 'r', fixedSize: 100, dividers: [{ id: 'd1', materialId: 'marble' }] })).toEqual([
      'projects[0].units[0].root.dividers[0].materialId not-one-of',
    ])
  })

  it('accepts accessories and reports one outside the four types', () => {
    expect(tree({ id: 'r', fixedSize: 100, accessories: [{ id: 'a1', type: 'pull', label: 'Handle' }] })).toEqual([])
    expect(tree({ id: 'r', fixedSize: 100, accessories: 'none' })).toEqual([
      'projects[0].units[0].root.accessories wrong-type',
    ])
    expect(tree({ id: 'r', fixedSize: 100, accessories: [{}] })).toEqual([
      'projects[0].units[0].root.accessories[0].id missing-field',
      'projects[0].units[0].root.accessories[0].type missing-field',
    ])
    expect(tree({ id: 'r', fixedSize: 100, accessories: [{ id: 'a1', type: 'hinge', label: 3 }] })).toEqual([
      'projects[0].units[0].root.accessories[0].label wrong-type',
    ])
    expect(tree({ id: 'r', fixedSize: 100, accessories: [{ id: 'a1', type: 'knob' }] })).toEqual([
      'projects[0].units[0].root.accessories[0].type not-one-of',
    ])
  })

  it('reports a child that is not an object', () => {
    expect(tree(split('r', leaf('a'), 7))).toEqual(['projects[0].units[0].root.children[1] bad-children'])
  })

  it('reports a problem inside a nested node by its full path', () => {
    expect(tree(split('r', leaf('a'), split('b', leaf('c'), leaf('d'), { splitRatio: 2 })))).toEqual([
      'projects[0].units[0].root.children[1].splitRatio out-of-range',
    ])
  })
})

describe('validateLegacyDesigns — depth and cycles', () => {
  it('accepts a tree as deep as the app can build one', () => {
    expect(tree(chain(MAX_TREE_DEPTH + 1))).toEqual([])
  })

  it('reports a tree one level deeper once, at the unit root', () => {
    expect(unitProblems(chain(MAX_TREE_DEPTH + 2))).toEqual([{
      path: 'projects[0].units[0].root',
      code: 'tree-too-deep',
      message: 'A cabinet can be split at most 12 levels deep.',
    }])
  })

  it('reports a node that holds itself', () => {
    const node = split('r', leaf('a'), leaf('b'))
    node.children = [node, leaf('c')]
    expect(unitProblems(node)).toEqual([{
      path: 'projects[0].units[0].root.children[0]',
      code: 'tree-cycle',
      message: 'This space holds itself, so it never ends.',
    }])
  })

  it('reports a cycle further down by its path', () => {
    const root = split('r', leaf('a'), leaf('b'))
    const deep = split('d', root, leaf('c'))
    root.children = [leaf('a'), deep]
    expect(shown(unitProblems(root))).toEqual(['projects[0].units[0].root.children[1].children[0] tree-cycle'])
  })

  it('allows the same shape twice as long as they are two objects', () => {
    expect(tree(split('r', leaf('shared'), leaf('shared')))).toEqual([])
  })
})

describe('validateLegacyDesigns — every problem, not the first', () => {
  it('reports three problems in three different projects', () => {
    const problems = designs([
      design([unit(leaf('a'), { id: '' })], { id: 'a' }),
      design(['not-a-unit'], { id: 'b' }),
      design([unit(chain(MAX_TREE_DEPTH + 2))], { id: 'c' }),
    ])
    expect(shown(problems)).toEqual([
      'projects[0].units[0].id wrong-type',
      'projects[1].units[0] wrong-type',
      'projects[2].units[0].root tree-too-deep',
    ])
  })
})

describe('validateLegacyFloorPlan', () => {
  const empty = { image: null, pixelsPerMm: null, objects: [], annotations: [], customTemplates: [] }
  const plan = (over: Record<string, unknown>): ValidationProblem[] =>
    validateLegacyFloorPlan({ ...empty, ...over }, 'state.floorPlan')

  it('accepts an empty floor plan', () => {
    expect(validateLegacyFloorPlan(empty, 'floorPlan')).toEqual([])
  })

  it('reports a floor plan that is missing or not an object', () => {
    expect(validateLegacyFloorPlan(undefined, 'state.floorPlan')).toEqual([
      { path: 'state.floorPlan', code: 'missing-field', message: 'Missing the floor plan.' },
    ])
    expect(validateLegacyFloorPlan('plan', 'state.floorPlan')).toEqual([
      { path: 'state.floorPlan', code: 'wrong-type', message: 'Expected the floor plan.' },
    ])
  })

  it('reports each list that is missing', () => {
    expect(shown(validateLegacyFloorPlan({}, 'floorPlan'))).toEqual([
      'floorPlan.image missing-field',
      'floorPlan.pixelsPerMm missing-field',
      'floorPlan.objects missing-field',
      'floorPlan.annotations missing-field',
      'floorPlan.customTemplates missing-field',
    ])
  })

  it('accepts a plan as the app writes it', () => {
    expect(plan({
      image: { dataUrl: 'data:image/png;base64,AAAA', widthPx: 256, heightPx: 192 },
      pixelsPerMm: 0.25,
      objects: [
        { id: 'o1', type: 'fridge', label: 'Fridge', x: 10, y: 20, w: 100, h: 200, rotation: 90, color: '#fff' },
        { id: 'o2', type: 'custom', label: 'Island', x: 0, y: 0, w: 10, h: 10, rotation: 0, color: '#000', isCustom: true },
      ],
      annotations: [
        { id: 'a1', type: 'wall-hack', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
        { id: 'a2', type: 'tile-zone', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], label: 'Tiles' },
      ],
      customTemplates: [{ id: 't1', label: 'Island', defaultW: 100, defaultH: 200, color: '#fff' }],
    })).toEqual([])
  })

  it('accepts a plan image and reports one that is not a data URL or has no size', () => {
    expect(plan({ image: { dataUrl: 'data:image/jpeg;base64,AA', widthPx: 1, heightPx: 1 } })).toEqual([])
    expect(shown(plan({ image: { dataUrl: 'https://example.com/a.png', widthPx: 1, heightPx: 1 } }))).toEqual([
      'state.floorPlan.image wrong-type',
    ])
    expect(shown(plan({ image: { dataUrl: 'data:image/png;base64,AA', widthPx: 0, heightPx: -1 } }))).toEqual([
      'state.floorPlan.image.widthPx out-of-range',
      'state.floorPlan.image.heightPx out-of-range',
    ])
    expect(shown(plan({ image: {} }))).toEqual([
      'state.floorPlan.image wrong-type',
      'state.floorPlan.image.widthPx missing-field',
      'state.floorPlan.image.heightPx missing-field',
    ])
  })

  it('accepts a plan scale of null and reports one that is not a positive number', () => {
    expect(plan({ pixelsPerMm: 0.25 })).toEqual([])
    expect(shown(plan({ pixelsPerMm: 0 }))).toEqual(['state.floorPlan.pixelsPerMm out-of-range'])
    expect(shown(plan({ pixelsPerMm: '0.25' }))).toEqual(['state.floorPlan.pixelsPerMm wrong-type'])
  })

  const placed = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'o1', type: 'fridge', label: 'Fridge', x: 0, y: 0, w: 100, h: 100, rotation: 0, color: '#fff', ...over,
  })

  it('reports an object that is not an object', () => {
    expect(shown(plan({ objects: ['o1'] }))).toEqual(['state.floorPlan.objects[0] wrong-type'])
  })

  it('reports an object type outside the 24 the app draws', () => {
    expect(shown(plan({ objects: [placed({ type: 'hot-tub' })] }))).toEqual([
      'state.floorPlan.objects[0].type not-one-of',
    ])
  })

  it('reports an object missing a field', () => {
    expect(shown(plan({ objects: [{}] }))).toEqual([
      'state.floorPlan.objects[0].id missing-field',
      'state.floorPlan.objects[0].type missing-field',
      'state.floorPlan.objects[0].label missing-field',
      'state.floorPlan.objects[0].x missing-field',
      'state.floorPlan.objects[0].y missing-field',
      'state.floorPlan.objects[0].w missing-field',
      'state.floorPlan.objects[0].h missing-field',
      'state.floorPlan.objects[0].rotation missing-field',
      'state.floorPlan.objects[0].color missing-field',
    ])
  })

  it('reports a position that is not finite and a size that is not positive', () => {
    expect(shown(plan({ objects: [placed({ x: '10', w: 0, h: -1 })] }))).toEqual([
      'state.floorPlan.objects[0].x wrong-type',
      'state.floorPlan.objects[0].w out-of-range',
      'state.floorPlan.objects[0].h out-of-range',
    ])
  })

  it('reports a rotation outside the four the app offers', () => {
    expect(shown(plan({ objects: [placed({ rotation: 45 })] }))).toEqual([
      'state.floorPlan.objects[0].rotation not-one-of',
    ])
    for (const rotation of [0, 90, 180, 270]) {
      expect(plan({ objects: [placed({ rotation })] })).toEqual([])
    }
  })

  it('reports a custom flag that is not a boolean', () => {
    expect(shown(plan({ objects: [placed({ isCustom: 'yes' })] }))).toEqual([
      'state.floorPlan.objects[0].isCustom wrong-type',
    ])
  })

  it('reports an object id used twice', () => {
    expect(shown(plan({ objects: [placed(), placed()] }))).toEqual([
      'state.floorPlan.objects[1].id duplicate-id',
    ])
  })

  const marked = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'a1', type: 'wall-hack', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], ...over,
  })

  it('reports an annotation type outside the two the app draws', () => {
    expect(shown(plan({ annotations: [marked({ type: 'zone' })] }))).toEqual([
      'state.floorPlan.annotations[0].type not-one-of',
    ])
  })

  it('reports an annotation with fewer than two points', () => {
    expect(shown(plan({ annotations: [marked({ points: [{ x: 0, y: 0 }] })] }))).toEqual([
      'state.floorPlan.annotations[0].points empty-list',
    ])
    expect(shown(plan({ annotations: [marked({ points: 'line' })] }))).toEqual([
      'state.floorPlan.annotations[0].points wrong-type',
    ])
  })

  it('accepts a zone drawn with more than two points, which the app has always written', () => {
    // #40 asks for exactly two on a tile-zone, but `fixtures/legacy/v3/buildbox-store.json`
    // stores a 4-point zone and AnnotationLayer renders any annotation with >= 2 points.
    expect(plan({ annotations: [marked({ type: 'tile-zone', points: [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ] })] })).toEqual([])
  })

  it('reports a point that is not a pair of numbers', () => {
    expect(shown(plan({ annotations: [marked({ points: [{ x: 0, y: 0 }, 7] })] }))).toEqual([
      'state.floorPlan.annotations[0].points[1] wrong-type',
    ])
    expect(shown(plan({ annotations: [marked({ points: [{ x: 0, y: 0 }, { x: '1', y: undefined }] })] }))).toEqual([
      'state.floorPlan.annotations[0].points[1].x wrong-type',
      'state.floorPlan.annotations[0].points[1].y missing-field',
    ])
  })

  it('reports an annotation id used twice', () => {
    expect(shown(plan({ annotations: [marked(), marked()] }))).toEqual([
      'state.floorPlan.annotations[1].id duplicate-id',
    ])
  })

  const template = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 't1', label: 'Island', defaultW: 100, defaultH: 200, color: '#fff', ...over,
  })

  it('reports a saved shape missing a field', () => {
    expect(shown(plan({ customTemplates: [{}] }))).toEqual([
      'state.floorPlan.customTemplates[0].id missing-field',
      'state.floorPlan.customTemplates[0].label missing-field',
      'state.floorPlan.customTemplates[0].defaultW missing-field',
      'state.floorPlan.customTemplates[0].defaultH missing-field',
      'state.floorPlan.customTemplates[0].color missing-field',
    ])
  })

  it('reports a saved shape with a size that is not positive', () => {
    expect(shown(plan({ customTemplates: [template({ defaultW: 0, defaultH: '200' })] }))).toEqual([
      'state.floorPlan.customTemplates[0].defaultW out-of-range',
      'state.floorPlan.customTemplates[0].defaultH wrong-type',
    ])
  })

  it('reports a saved shape id used twice', () => {
    expect(shown(plan({ customTemplates: [template(), template()] }))).toEqual([
      'state.floorPlan.customTemplates[1].id duplicate-id',
    ])
  })
})

describe('validateLegacyPersistedState', () => {
  const state = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    projects: [design([unit(leaf('r'))])],
    activeProjectId: 'p1',
    floorPlan: { image: null, pixelsPerMm: null, objects: [], annotations: [], customTemplates: [] },
    ...over,
  })

  it('accepts a migrated v3 state', () => {
    expect(validateLegacyPersistedState(state())).toEqual([])
  })

  it('reports a state that is missing or not an object', () => {
    expect(validateLegacyPersistedState(undefined)).toEqual([
      { path: 'state', code: 'missing-field', message: 'Missing the saved data.' },
    ])
    expect(validateLegacyPersistedState([])).toEqual([
      { path: 'state', code: 'wrong-type', message: 'Expected the saved BuildBox data.' },
    ])
  })

  it('reports a state with no projects', () => {
    expect(shown(validateLegacyPersistedState({}))).toEqual([
      'state.projects missing-field',
      'state.floorPlan missing-field',
    ])
  })

  it('reports an open project that is not one of the saved projects', () => {
    expect(shown(validateLegacyPersistedState(state({ activeProjectId: 'nope' })))).toEqual([
      'state.activeProjectId not-one-of',
    ])
    expect(shown(validateLegacyPersistedState(state({ activeProjectId: 7 })))).toEqual([
      'state.activeProjectId wrong-type',
    ])
  })

  it('accepts no open project, which is what a fresh browser holds', () => {
    expect(validateLegacyPersistedState(state({ activeProjectId: null }))).toEqual([])
  })

  it('names a problem inside the floor plan by its path in storage', () => {
    const problems = validateLegacyPersistedState(state({
      floorPlan: {
        image: null,
        pixelsPerMm: null,
        objects: [
          { id: 'o1', type: 'fridge', label: 'a', x: 0, y: 0, w: 1, h: 1, rotation: 0, color: '#fff' },
          { id: 'o2', type: 'fridge', label: 'a', x: 0, y: 0, w: 1, h: 1, rotation: 0, color: '#fff' },
          { id: 'o3', type: 'fridge', label: 'a', x: 0, y: 0, w: 1, h: 1, rotation: 0, color: '#fff' },
          { id: 'o4', type: 'fridge', label: 'a', x: 0, y: 0, w: 1, h: 1, rotation: 45, color: '#fff' },
        ],
        annotations: [],
        customTemplates: [],
      },
    }))
    expect(shown(problems)).toEqual(['state.floorPlan.objects[3].rotation not-one-of'])
  })
})
