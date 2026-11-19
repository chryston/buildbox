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
  FloorLimits,
  GenericItemDesign,
  ItemDesign,
  ItemFootprint,
  PathItemFootprint,
  PlanImageMediaType,
  PlanView,
  PlacedItem,
  PresetItemFootprint,
  Project,
  ProjectMeta,
} from './project'
import type { CornerRadii, Preset } from '../geometry'

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

// --- Item Footprints ----------------------------------------------------------

/** Millimetres from 10 mm up: big enough that a fraction of it is still a real radius. */
const arbBigMm = fc.integer({ min: 100, max: 60000 }).map((value) => value / 10)

/** Millimetres from 0 to `max`, in tenths, so a radius never lands on a rounding edge. */
const arbUpToMm = (max: number): fc.Arbitrary<number> =>
  fc.integer({ min: 0, max: Math.max(0, Math.floor(max * 10)) }).map((value) => value / 10)

const arbSize = fc.record({ width: arbMm, depth: arbMm })
const arbBigSize = fc.record({ width: arbBigMm, depth: arbBigMm })

/**
 * Four corner radii that together fit the side they sit on.
 *
 * A quarter of the shorter side, not a half: the constraint is per side — the two radii on a
 * side must sum to no more than it — and a quarter is what makes that true for every pair
 * without threading one radius through the next.
 */
const arbCornerRadii = (width: number, depth: number): fc.Arbitrary<CornerRadii> => {
  const radius = arbUpToMm(Math.min(width, depth) / 4)
  return fc.record({
    topLeft: radius,
    topRight: radius,
    bottomRight: radius,
    bottomLeft: radius,
  })
}

/**
 * A preset whose parameters always describe a shape.
 *
 * The ranges are what make that true rather than a filter: a Rounded Rectangle's radii stay
 * under half the shorter side, so no two of them can overlap; a Capsule is always longer than
 * it is wide; a Regular Polygon always has three sides or more. `arbProject` is reused by the
 * `package` and `edit` properties, which assert that a generated Project validates — an
 * impossible shape here would be a bug in the generator, not a finding. Impossible shapes are
 * made on purpose by `impossibleRadii` instead.
 */
const arbPreset: fc.Arbitrary<Preset> = fc.oneof(
  arbMm.map((side): Preset => ({ kind: 'square', side })),
  arbSize.map(({ width, depth }): Preset => ({ kind: 'rectangle', width, depth })),
  arbBigSize.chain(({ width, depth }) =>
    fc.oneof(
      // Half the shorter side would leave no straight edge at all — a Rounded Rectangle whose
      // radius reaches half the side is a circle, and the kernel says so.
      arbUpToMm(Math.min(width, depth) / 2 - 10).map((radius): Preset => ({ kind: 'roundedRectangle', width, depth, radius })),
      arbCornerRadii(width, depth).map((radii): Preset => ({ kind: 'roundedRectangle', width, depth, radii })),
    ),
  ),
  arbMm.map((diameter): Preset => ({ kind: 'circle', diameter })),
  arbSize.map(({ width, depth }): Preset => ({ kind: 'ellipse', width, depth })),
  arbBigSize.chain(({ width }) =>
    // The straight run between the two ends has to have a length of its own.
    arbUpToMm(6000 - width).map((extra): Preset => ({ kind: 'capsule', width, length: width + 100 + extra })),
  ),
  arbSize.chain(({ width: baseWidth, depth }) =>
    fc.option(arbUpToMm(baseWidth).map((offset) => offset - baseWidth / 2), { nil: undefined }).map(
      (apexOffset): Preset => ({ kind: 'triangle', baseWidth, depth, apexOffset }),
    ),
  ),
  fc.record({ sideCount: fc.integer({ min: 3, max: 12 }), sideLength: arbMm }).map(
    ({ sideCount, sideLength }): Preset => ({ kind: 'regularPolygon', sideCount, sideLength }),
  ),
)

/** A preset footprint: the shape, where it sits, how far it is turned. */
const arbPresetFootprint: fc.Arbitrary<PresetItemFootprint> = fc.record({
  kind: fc.constant('preset' as const),
  preset: arbPreset,
  centre: arbPoint,
  orientationDeg: fc.integer({ min: 0, max: 359 }),
})

/**
 * A Custom Path that always closes: an axis-aligned rectangle with one corner optionally cut.
 *
 * Every vertex lies on the boundary of a convex box and is visited in order, so the loop is
 * convex and encloses a real area — valid by construction, which is the same reason the
 * generator never asks the kernel whether a sample is one.
 */
const arbPathFootprint: fc.Arbitrary<PathItemFootprint> = fc
  .record({ width: arbBigMm, depth: arbBigMm, cut: fc.option(arbBigMm, { nil: null }) })
  .map(({ width, depth, cut }) => {
    const inset = cut === null ? 0 : Math.min(cut, width / 3, depth / 3)
    const corners =
      inset > 0
        ? [
            { x: 0, y: 0 },
            { x: width - inset, y: 0 },
            { x: width, y: inset },
            { x: width, y: depth },
            { x: 0, y: depth },
          ]
        : [
            { x: 0, y: 0 },
            { x: width, y: 0 },
            { x: width, y: depth },
            { x: 0, y: depth },
          ]
    return {
      kind: 'path' as const,
      path: {
        start: corners[0],
        segments: [...corners.slice(1), corners[0]].map((to) => ({ kind: 'line' as const, to })),
      },
    }
  })

/** Any Item Footprint that describes a shape. */
export const arbFootprint: fc.Arbitrary<ItemFootprint> = fc.oneof(
  arbPresetFootprint,
  arbPresetFootprint,
  arbPathFootprint,
)

const arbGenericBody = fc.record({
  name: arbText(1, 16),
  footprint: arbFootprint,
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
  // Either bound of #56's limits on its own, and the pair is ordered below rather than
  // filtered, so a Floor with both bounds is valid without rejecting samples.
  lowerMm: fc.option(fc.integer({ min: -1000, max: 3000 }), { nil: undefined }),
  upperMm: fc.option(fc.integer({ min: -1000, max: 3000 }), { nil: undefined }),
  hasLimits: fc.boolean(),
})

/** The two bounds the generator drew, put the right way round and trimmed of nothing. */
function arbLimits(body: { lowerMm?: number; upperMm?: number; hasLimits: boolean }): FloorLimits | undefined {
  if (!body.hasLimits) return undefined
  const { lowerMm, upperMm } = body
  // A Floor with neither bound has no limits at all — an empty `limits` object is the one
  // shape the validator rightly refuses.
  if (lowerMm === undefined && upperMm === undefined) return undefined
  if (lowerMm === undefined) return { upperMm }
  if (upperMm === undefined) return { lowerMm }
  return { lowerMm: Math.min(lowerMm, upperMm), upperMm: Math.max(lowerMm, upperMm) }
}

const arbPlacement = fc.record({
  design: fc.nat({ max: 31 }),
  floor: fc.nat({ max: 31 }),
  translation: arbPoint,
  rotationDeg: fc.constantFrom(0, 45, 90, 135, 180, 225, 270, 315),
  baseElevation: fc.integer({ min: -1000, max: 3000 }),
})

/**
 * Valid domain v1 Projects: unique IDs across the whole Project namespace, references
 * that always resolve, cabinet trees no deeper than `MAX_TREE_DEPTH`, 0–4 Floors each with
 * its default Plan View, and
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
      const floors: Floor[] = skeleton.floors.map((body, index) => {
        const limits = arbLimits(body)
        return {
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
          ...(limits === undefined ? {} : { limits }),
        }
      })

      // One default Plan View per Floor, named after it (#56): the shape a v1 Project
      // arrives at through the migrator, which is what `arbProject` has to keep producing.
      const views: PlanView[] = floors.map((floor, index) => ({
        id: `view-${index}`,
        kind: 'plan',
        floorId: floor.id,
        name: floor.name,
        isDefault: true,
        showPlanImage: true,
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
        views,
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
    footprint: {
      kind: 'preset',
      preset: { kind: 'rectangle', width: 900, depth: 600 },
      centre: { x: 450, y: 300 },
      orientationDeg: 0,
    },
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

function injectedPlanView(index: number, floorId: string, overrides: Partial<PlanView> = {}): PlanView {
  return {
    id: `${INJECT}-view-${index}`,
    kind: 'plan',
    floorId,
    name: `${INJECT} view ${index}`,
    isDefault: false,
    showPlanImage: true,
    ...overrides,
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

/** A Floor whose name another Floor already has, differing only in case and spacing. */
const duplicateFloorName: CorruptionMaker = (project) => {
  const floor = { ...injectedFloor(0), name: ' floor 1 ' }
  const floors = [...project.floors, floor]
  const clash = { ...floor, name: 'Floor 1' }
  return {
    project: { ...project, floors: [...floors.slice(0, 1), clash, ...floors.slice(1)] },
    path: 'floors[1].name',
    code: 'duplicate-name',
  }
}

/** A Floor whose limits measure the other way round. */
const unorderedLimits: CorruptionMaker = (project) => {
  const floors = [...project.floors, { ...injectedFloor(0), limits: { lowerMm: 2400, upperMm: 300 } }]
  return {
    project: { ...project, floors },
    path: `floors[${floors.length - 1}].limits.lowerMm`,
    code: 'out-of-range',
  }
}

/** A Floor that arrived without the default Plan View every Floor must carry. */
const missingDefaultView: CorruptionMaker = (project) => ({
  project: { ...project, floors: [...project.floors, injectedFloor(0)] },
  path: 'views',
  code: 'missing-field',
})

/** A Floor with two default Plan Views. */
const duplicateDefaultView: CorruptionMaker = (project) => {
  const floor = injectedFloor(0)
  return {
    project: {
      ...project,
      floors: [...project.floors, floor],
      views: [...project.views, injectedPlanView(0, floor.id, { isDefault: true }), injectedPlanView(1, floor.id, { isDefault: true })],
    },
    path: 'views',
    code: 'duplicate-id',
  }
}

/** Two Plan Views of one Floor answering to the same name. */
const duplicateViewName: CorruptionMaker = (project) => {
  const floor = project.floors.length > 0 ? project.floors[0] : injectedFloor(0)
  const floors = project.floors.length > 0 ? project.floors : [...project.floors, floor]
  const views = [...project.views, injectedPlanView(0, floor.id, { name: ' Kitchen Plan ' }), injectedPlanView(1, floor.id, { name: 'kitchen plan' })]
  return {
    project: { ...project, floors, views },
    path: `views[${views.length - 1}].name`,
    code: 'duplicate-name',
  }
}

/** A Plan View looking at a Floor this Project does not have. */
const viewOnMissingFloor: CorruptionMaker = (project) => {
  const views = [...project.views, injectedPlanView(0, `${INJECT}-missing-floor`)]
  return {
    project: { ...project, views },
    path: `views[${views.length - 1}].floorId`,
    code: 'dangling-reference',
  }
}

/** A Plan Image claiming a scale of zero pixels per millimetre. */
const zeroScale: CorruptionMaker = (project) => {
  const floor = {
    ...injectedFloor(0),
    planImage: {
      assetHash: 'a'.repeat(64),
      mediaType: 'image/png' as const,
      widthPx: 100,
      heightPx: 100,
      pixelsPerMm: 0,
    },
  }
  const floors = [...project.floors, floor]
  return {
    project: { ...project, floors, views: [...project.views, injectedPlanView(0, floor.id, { isDefault: true })] },
    path: `floors[${floors.length - 1}].planImage.pixelsPerMm`,
    code: 'out-of-range',
  }
}

/**
 * An Item Footprint that describes no shape: radii of 1,000 and 1,001 on a 2,000 mm side.
 *
 * The path is the preset, not one number inside it, because that is what the problem is
 * about — the pair, not either radius — and it is the path the editor puts the message's
 * `aria-describedby` on.
 */
const impossibleShape: CorruptionMaker = (project) => {
  const index = project.itemDesigns.length
  const design: GenericItemDesign = {
    ...injectedGenericDesign(index),
    footprint: {
      kind: 'preset',
      preset: {
        kind: 'roundedRectangle',
        width: 2000,
        depth: 3000,
        radii: { topLeft: 1000, topRight: 1001, bottomRight: 0, bottomLeft: 0 },
      },
      centre: { x: 1000, y: 1500 },
      orientationDeg: 0,
    },
  }
  return {
    project: { ...project, itemDesigns: [...project.itemDesigns, design] },
    // The footprint as a whole, under the geometry kernel's own code: an impossible shape is
    // refused in the kernel's words, not paraphrased as a field the validator disliked.
    path: `itemDesigns[${index}].footprint`,
    code: 'corner-radii-overlap',
  }
}

const CORRUPTIONS: readonly CorruptionMaker[] = [
  duplicateId,
  danglingDesign,
  missingFloor,
  splitRatioOutOfRange,
  unknownField,
  treeTooDeep,
  duplicateFloorName,
  unorderedLimits,
  missingDefaultView,
  duplicateDefaultView,
  duplicateViewName,
  viewOnMissingFloor,
  zeroScale,
  impossibleShape,
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
