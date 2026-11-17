/**
 * Test-only arbitraries for the domain schema (#42 §7), reachable from test files alone:
 * `eslint.config.js` bans imports of this entry point anywhere else in `src`.
 *
 * `arbProject()` is deliberately generic: `package` encode/decode and `edit`
 * random-Intent properties reuse it, so it produces whole valid Projects rather than
 * anything shaped for one module's tests.
 *
 * IDs come from positions, never from a generator: Floors are `floor-0…`, Item Designs
 * `design-0…`, Placed Items `place-0…`, and cabinet features are numbered by the walk
 * that builds their tree. That is what makes uniqueness structural rather than lucky.
 * Corruption helpers add what they need under the `inject-` prefix, which no generated
 * ID ever uses, so a corruption can never collide with the value it corrupts.
 */
import fc from 'fast-check'
import { MAX_TREE_DEPTH } from './cabinetPayload'
import type {
  AccessoryType,
  CabinetMaterialId,
  CabinetNode,
  Divider,
  DrawerConfig,
  ElementType,
  GlobalSettings,
  SlideType,
  SplitAxis,
  Unit,
} from './cabinetPayload'
import type {
  CabinetItemDesign,
  Floor,
  GenericItemDesign,
  ItemDesign,
  PlanImageMediaType,
  PlacedItem,
  Project,
  ProjectMeta,
} from './project'

/** A Project that breaks exactly one invariant, and where the validator must say so. */
export interface Corruption {
  project: Project
  path: string
  code: string
}

// --- Small arbitraries --------------------------------------------------------

const LETTERS = 'abcdefghijklmnopqrstuvwxyz0123456789 -'.split('')
const HEX_DIGITS = '0123456789abcdef'.split('')

/** Text with something in it, as every name and label must be. */
const arbText = (min: number, max: number): fc.Arbitrary<string> =>
  fc
    .string({ unit: fc.constantFrom(...LETTERS), minLength: min, maxLength: max })
    .filter((value) => value.trim() !== '')

/** Millimetres to one decimal, always finite and greater than 0. */
const arbMm = fc.integer({ min: 1, max: 60000 }).map((value) => value / 10)
const arbPoint = fc.record({
  x: fc.integer({ min: -5000, max: 20000 }),
  y: fc.integer({ min: -5000, max: 20000 }),
})

/** Lowercase hex of exactly `length` characters: an asset hash, or a color without its `#`. */
const arbHex = (length: number): fc.Arbitrary<string> =>
  fc.string({ unit: fc.constantFrom(...HEX_DIGITS), minLength: length, maxLength: length })

const ARB_DISPLAY_UNIT = fc.constantFrom('mm', 'cm', 'm') as fc.Arbitrary<Project['preferences']['displayUnit']>
const ARB_UNIT = fc.constantFrom('mm', 'cm', 'in') as fc.Arbitrary<Unit>
const ARB_SPLIT_AXIS = fc.constantFrom('horizontal', 'vertical') as fc.Arbitrary<SplitAxis>
const ARB_MATERIAL = fc.constantFrom('oak', 'walnut', 'white', 'birch', 'mdf') as fc.Arbitrary<CabinetMaterialId>
const ARB_ELEMENT_TYPE = fc.constantFrom('void', 'drawer', 'hanging-space', 'microwave') as fc.Arbitrary<ElementType>
const ARB_SLIDE_TYPE = fc.constantFrom('side-mount', 'undermount') as fc.Arbitrary<SlideType>
const ARB_ACCESSORY_TYPE = fc.constantFrom('door', 'drawer-front', 'pull', 'hinge') as fc.Arbitrary<AccessoryType>
const ARB_MEDIA_TYPE = fc.constantFrom(
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
  'image/svg+xml',
) as fc.Arbitrary<PlanImageMediaType>

/** Strictly inside the open interval a split share has to live in. */
const arbSplitRatio = fc.integer({ min: 5, max: 95 }).map((value) => value / 100)

const arbSettings: fc.Arbitrary<GlobalSettings> = fc.record({
  unit: ARB_UNIT,
  height: arbMm,
  width: arbMm,
  depth: arbMm,
  thickness: arbMm,
  backThickness: fc.integer({ min: 0, max: 50 }).map((value) => value / 10),
  toeKick: fc.option(
    fc.record({
      height: fc.integer({ min: 0, max: 300 }).map((value) => value / 10),
      setback: fc.integer({ min: 0, max: 300 }).map((value) => value / 10),
    }),
    { nil: null },
  ),
  material: ARB_MATERIAL,
})

const arbDrawerConfig: fc.Arbitrary<DrawerConfig> = fc.record({
  slideType: ARB_SLIDE_TYPE,
  reveal: fc.integer({ min: 0, max: 200 }).map((value) => value / 10),
})

// --- The cabinet tree ---------------------------------------------------------

/** A node before it has IDs; `numberTree` adds those as it walks. */
interface NodeSpec {
  splitAxis?: SplitAxis
  splitRatio?: number
  children?: [NodeSpec, NodeSpec]
  spaceLabel?: string
  elementType?: ElementType
  drawerConfig?: DrawerConfig
  dividers?: { materialId: CabinetMaterialId }[]
  accessories?: { type: AccessoryType; label?: string }[]
}

const arbNodeExtras: fc.Arbitrary<NodeSpec> = fc.record({
  spaceLabel: fc.option(arbText(1, 14), { nil: undefined }),
  elementType: fc.option(ARB_ELEMENT_TYPE, { nil: undefined }),
  drawerConfig: fc.option(arbDrawerConfig, { nil: undefined }),
  dividers: fc.option(fc.array(fc.record({ materialId: ARB_MATERIAL }), { maxLength: 2 }), { nil: undefined }),
  accessories: fc.option(
    fc.array(
      fc.record({ type: ARB_ACCESSORY_TYPE, label: fc.option(arbText(1, 10), { nil: undefined }) }),
      { maxLength: 2 },
    ),
    { nil: undefined },
  ),
})

const { nodeSpec: arbNodeSpec } = fc.letrec<{ nodeSpec: NodeSpec }>((tie) => ({
  nodeSpec: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    arbNodeExtras,
    fc
      .tuple(ARB_SPLIT_AXIS, arbSplitRatio, arbNodeExtras, tie('nodeSpec'), tie('nodeSpec'))
      .map(([splitAxis, splitRatio, extras, left, right]) => ({
        ...extras,
        splitAxis,
        splitRatio,
        children: [left, right] as [NodeSpec, NodeSpec],
      })),
  ),
}))

/**
 * Number every node, divider and accessory from `nextId`, and cut the tree off at
 * `MAX_TREE_DEPTH`: a split deeper than the limit becomes a void, which is the one edit
 * that cannot make the node invalid.
 */
function numberTree(spec: NodeSpec, depth: number, nextId: () => string): CabinetNode {
  const { children, splitAxis, splitRatio, dividers, accessories, ...rest } = spec
  const node: CabinetNode = { id: nextId(), ...rest }
  if (dividers !== undefined) {
    node.dividers = dividers.map((divider): Divider => ({ id: nextId(), materialId: divider.materialId }))
  }
  if (accessories !== undefined) {
    node.accessories = accessories.map((accessory) => ({ id: nextId(), ...accessory }))
  }
  if (children === undefined || depth >= MAX_TREE_DEPTH) return node
  node.splitAxis = splitAxis
  node.splitRatio = splitRatio
  node.children = [numberTree(children[0], depth + 1, nextId), numberTree(children[1], depth + 1, nextId)]
  return node
}

// --- Item Designs -------------------------------------------------------------

const arbCabinetBody = fc
  .record({ name: arbText(1, 16), settings: arbSettings, spec: arbNodeSpec })
  .map(({ name, settings, spec }) => ({ name, settings, spec }))

const arbGenericBody = fc.record({
  name: arbText(1, 16),
  footprint: fc.record({ kind: fc.constant('rectangle' as const), width: arbMm, depth: arbMm }),
  origin: arbPoint,
  height: arbMm,
  heightIsTypical: fc.boolean(),
  color: arbHex(6).map((hex) => `#${hex}`),
  catalogKey: fc.option(arbText(1, 12), { nil: undefined }),
  isCustom: fc.option(fc.boolean(), { nil: undefined }),
})

// --- The Project --------------------------------------------------------------

const arbFloorBody = fc.record({
  assetHash: arbHex(64),
  mediaType: ARB_MEDIA_TYPE,
  widthPx: fc.integer({ min: 1, max: 8000 }),
  heightPx: fc.integer({ min: 1, max: 8000 }),
  pixelsPerMm: fc.option(fc.integer({ min: 1, max: 400 }).map((value) => value / 100), { nil: null }),
  hasPlanImage: fc.boolean(),
})

const arbPlacement = fc.record({
  design: fc.nat({ max: 31 }),
  floor: fc.nat({ max: 31 }),
  translation: arbPoint,
  rotationDeg: fc.constantFrom(0, 45, 90, 135, 180, 225, 270, 315),
  baseElevation: fc.integer({ min: -1000, max: 3000 }),
})

/**
 * Valid domain v1 Projects: unique IDs across the whole Project namespace, references
 * that always resolve, cabinet trees no deeper than `MAX_TREE_DEPTH`, 0–4 Floors, and
 * both Item Design kinds. Placed Items exist only once there is something to place and
 * a Floor to place it on, which is how a real Project gets here too.
 */
export function arbProject(): fc.Arbitrary<Project> {
  return fc
    .record({
      name: arbText(1, 20),
      address: fc.option(arbText(1, 24), { nil: undefined }),
      displayUnit: ARB_DISPLAY_UNIT,
      displayPrecision: fc.integer({ min: 0, max: 4 }),
      floors: fc.array(arbFloorBody, { maxLength: 4 }),
      cabinets: fc.array(arbCabinetBody, { maxLength: 2 }),
      generics: fc.array(arbGenericBody, { maxLength: 3 }),
      placements: fc.array(arbPlacement, { maxLength: 6 }),
    })
    .map((skeleton) => {
      const floors: Floor[] = skeleton.floors.map((body, index) => ({
        id: `floor-${index}`,
        name: `Floor ${index + 1}`,
        planImage: body.hasPlanImage
          ? {
              assetHash: body.assetHash,
              mediaType: body.mediaType,
              widthPx: body.widthPx,
              heightPx: body.heightPx,
              pixelsPerMm: body.pixelsPerMm,
            }
          : null,
      }))

      const designs: ItemDesign[] = [
        ...skeleton.cabinets.map((body, index): CabinetItemDesign => {
          let next = 0
          const id = `design-${index}`
          return {
            id,
            kind: 'cabinet',
            name: body.name,
            construction: {
              settings: body.settings,
              root: numberTree(body.spec, 0, () => `${id}-node-${next++}`),
            },
          }
        }),
        ...skeleton.generics.map((body, index): GenericItemDesign => ({
          id: `design-${skeleton.cabinets.length + index}`,
          kind: 'generic',
          ...body,
        })),
      ]

      const placeable = designs.length > 0 && floors.length > 0
      const placedItems: PlacedItem[] = placeable
        ? skeleton.placements.map((placement, index) => ({
            id: `place-${index}`,
            itemDesignId: designs[placement.design % designs.length].id,
            floorId: floors[placement.floor % floors.length].id,
            translation: placement.translation,
            rotationDeg: placement.rotationDeg,
            baseElevation: placement.baseElevation,
          }))
        : []

      return {
        id: 'project-0',
        meta: { name: skeleton.name, address: skeleton.address },
        preferences: { displayUnit: skeleton.displayUnit, displayPrecision: skeleton.displayPrecision },
        floors,
        itemDesigns: designs,
        existingModel: { placedItems },
      }
    })
}

// --- Corruptions --------------------------------------------------------------

const INJECT = 'inject'

function injectedFloor(index: number): Floor {
  return { id: `${INJECT}-floor-${index}`, name: `${INJECT} floor ${index}`, planImage: null }
}

function injectedGenericDesign(index: number): GenericItemDesign {
  return {
    id: `${INJECT}-design-${index}`,
    kind: 'generic',
    name: `${INJECT} design ${index}`,
    footprint: { kind: 'rectangle', width: 900, depth: 600 },
    origin: { x: 450, y: 300 },
    height: 2000,
    heightIsTypical: false,
    color: '#0a0b0c',
  }
}

function injectedCabinetDesign(index: number, root: CabinetNode): CabinetItemDesign {
  return {
    id: `${INJECT}-design-${index}`,
    kind: 'cabinet',
    name: `${INJECT} cabinet ${index}`,
    construction: {
      settings: {
        unit: 'mm',
        height: 850,
        width: 600,
        depth: 560,
        thickness: 18,
        backThickness: 6,
        toeKick: null,
        material: 'mdf',
      },
      root,
    },
  }
}

function injectedPlacedItem(index: number, itemDesignId: string, floorId: string): PlacedItem {
  return {
    id: `${INJECT}-place-${index}`,
    itemDesignId,
    floorId,
    translation: { x: 0, y: 0 },
    rotationDeg: 0,
    baseElevation: 0,
  }
}

/** A chain of splits whose deepest void sits at depth `levels`. */
function chainTree(levels: number): CabinetNode {
  let node: CabinetNode = { id: `${INJECT}-leaf` }
  for (let level = 0; level < levels; level += 1) {
    node = {
      id: `${INJECT}-split-${level}`,
      splitAxis: 'horizontal',
      splitRatio: 0.5,
      children: [node, { id: `${INJECT}-sibling-${level}` }],
    }
  }
  return node
}

type CorruptionMaker = (project: Project) => Corruption

/** A Floor whose ID is the one the Project already carries. */
const duplicateId: CorruptionMaker = (project) => ({
  project: { ...project, floors: [...project.floors, { ...injectedFloor(0), id: project.id }] },
  path: `floors[${project.floors.length}].id`,
  code: 'duplicate-id',
})

/** A Placed Item pointing at an Item Design nobody defined. */
const danglingDesign: CorruptionMaker = (project) => {
  const floors = project.floors.length > 0 ? project.floors : [injectedFloor(0)]
  const index = project.existingModel.placedItems.length
  const item = injectedPlacedItem(index, `${INJECT}-missing-design`, floors[0].id)
  return {
    project: {
      ...project,
      floors,
      existingModel: { placedItems: [...project.existingModel.placedItems, item] },
    },
    path: `existingModel.placedItems[${index}].itemDesignId`,
    code: 'dangling-reference',
  }
}

/** A Placed Item sitting on a Floor that is not in this Project. */
const missingFloor: CorruptionMaker = (project) => {
  const designs =
    project.itemDesigns.length > 0 ? project.itemDesigns : [...project.itemDesigns, injectedGenericDesign(0)]
  const index = project.existingModel.placedItems.length
  const item = injectedPlacedItem(index, designs[0].id, `${INJECT}-missing-floor`)
  return {
    project: {
      ...project,
      itemDesigns: designs,
      existingModel: { placedItems: [...project.existingModel.placedItems, item] },
    },
    path: `existingModel.placedItems[${index}].floorId`,
    code: 'dangling-reference',
  }
}

/** A split share outside the open interval (0, 1). */
const splitRatioOutOfRange: CorruptionMaker = (project) => {
  const root: CabinetNode = { ...chainTree(1), splitRatio: 1.5 }
  const index = project.itemDesigns.length
  return {
    project: { ...project, itemDesigns: [...project.itemDesigns, injectedCabinetDesign(0, root)] },
    path: `itemDesigns[${index}].construction.root.splitRatio`,
    code: 'out-of-range',
  }
}

/** A field v1 has never heard of. */
const unknownField: CorruptionMaker = (project) => ({
  project: { ...project, meta: { ...project.meta, bogus: 'written by a newer BuildBox' } as ProjectMeta },
  path: 'meta.bogus',
  code: 'unknown-field',
})

/** A cabinet tree one split deeper than `MAX_TREE_DEPTH`. */
const treeTooDeep: CorruptionMaker = (project) => {
  const index = project.itemDesigns.length
  const design = injectedCabinetDesign(0, chainTree(MAX_TREE_DEPTH + 1))
  return {
    project: { ...project, itemDesigns: [...project.itemDesigns, design] },
    path: `itemDesigns[${index}].construction.root`,
    code: 'tree-too-deep',
  }
}

const CORRUPTIONS: readonly CorruptionMaker[] = [
  duplicateId,
  danglingDesign,
  missingFloor,
  splitRatioOutOfRange,
  unknownField,
  treeTooDeep,
]

/**
 * A valid Project with exactly one invariant broken, and where and how the validator has
 * to report it. Every corruption adds what it needs under `inject-`, so the broken
 * invariant is the only one the Project fails.
 */
export function arbCorruption(): fc.Arbitrary<Corruption> {
  return fc
    .tuple(arbProject(), fc.integer({ min: 0, max: CORRUPTIONS.length - 1 }))
    .map(([project, kind]) => CORRUPTIONS[kind](project))
}
