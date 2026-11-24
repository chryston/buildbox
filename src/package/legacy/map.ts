/**
 * The legacy → domain v1 mapping table (#20 §3), applied literally.
 *
 * Every row of that table is one function here, and the row is quoted above it: this file
 * is where a mapping decision is *recorded*, not where a new one is made. Anything the
 * table does not say is left as the legacy value had it — geometry is never rescaled
 * (#11 finding 6), the cabinet editor unit stays inside the payload (#20 §15.3), and a
 * catalog key or custom flag is carried rather than dropped (#14).
 *
 * Everything here runs after the strict legacy validator has passed the value, so the
 * fields are read as the shapes `types.ts` describes them.
 */
import { decodeBase64, problem, sha256Hex, type ValidationProblem } from '../../lib'
import { DEFAULT_WALL_HEIGHT_MM, defaultPlanView, rectangleFootprint } from '../../domain'
import type {
  CabinetItemDesign,
  CabinetNode,
  GenericItemDesign,
  GlobalSettings,
  PlanImage,
  PlacedItem,
  Project,
  ProjectPreferences,
} from '../../domain'
import type { LegacyAsset, LegacyDiscardedSketches, LegacyFloorPlanContent } from './conversion'
import type {
  LegacyCabinetNode,
  LegacyCabinetUnit,
  LegacyCustomTemplate,
  LegacyDesign,
  LegacyFloorPlanData,
  LegacyFloorPlanImage,
  LegacyFloorPlanObject,
  LegacyFloorPlanObjectType,
} from './types'

/** The one Floor every converted `Design` gets (#20 §3). */
export const FLOOR_ONE_NAME = 'Floor 1'

/** Domain v1 defaults: geometry is millimetres, and the display unit is a preference (#13). */
export const MIGRATED_PREFERENCES: ProjectPreferences = { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: DEFAULT_WALL_HEIGHT_MM }

/**
 * "Typical — measure yours" heights for the legacy catalog (#43). Base elevation is 0
 * unless the row says otherwise, and `heightIsTypical` marks every one of them.
 */
const TYPICAL_SIZES = {
  'sofa-2': { height: 850, base: 0 },
  'sofa-3': { height: 850, base: 0 },
  armchair: { height: 850, base: 0 },
  'bed-single': { height: 500, base: 0 },
  'bed-double': { height: 500, base: 0 },
  'bed-queen': { height: 500, base: 0 },
  'bed-king': { height: 500, base: 0 },
  fridge: { height: 1800, base: 0 },
  washer: { height: 850, base: 0 },
  dryer: { height: 850, base: 0 },
  'water-heater': { height: 500, base: 1800 },
  'robot-vacuum': { height: 100, base: 0 },
  toilet: { height: 750, base: 0 },
  basin: { height: 200, base: 650 },
  bathtub: { height: 550, base: 0 },
  shower: { height: 2100, base: 0 },
  'ceiling-fan': { height: 300, base: 2300 },
  light: { height: 150, base: 2450 },
  tv: { height: 700, base: 900 },
  'curtain-rail': { height: 100, base: 2400 },
  wardrobe: { height: 2400, base: 0 },
  'kitchen-counter': { height: 900, base: 0 },
  'cabinet-unit': { height: 900, base: 0 },
  custom: { height: 900, base: 0 },
} satisfies Record<LegacyFloorPlanObjectType, { height: number; base: number }>

/** A saved custom shape has no catalog type of its own; it is a custom item at 900 mm. */
const TYPICAL_CUSTOM = TYPICAL_SIZES.custom

// --- Design → Project ---------------------------------------------------------

/**
 * | `Design{id,name,units[]}` | One Project. `project.id = design.id` and
 * | `meta.name = design.name`. `meta.address` is absent. `preferences` use the domain v1
 * | defaults. There is exactly one Floor named "Floor 1" with no Plan Image, and no
 * | Design Options. |
 *
 * The Floor's ID is new: a legacy `Design` never had one.
 */
export function projectFromDesign(design: LegacyDesign, newId: () => string): Project {
  const floorId = newId()
  return {
    id: design.id,
    meta: { name: design.name },
    preferences: { ...MIGRATED_PREFERENCES },
    floors: [{ id: floorId, name: FLOOR_ONE_NAME, planImage: null }],
    views: [defaultPlanView(newId(), { id: floorId, name: FLOOR_ONE_NAME, planImage: null })],
    itemDesigns: design.units.map((unit) => cabinetItemDesign(unit)),
    existingModel: {
      placedItems: design.units.map((unit) => cabinetPlacement(unit, floorId, newId())),
      walls: [],
      wallJunctions: [],
      openings: [],
      rooms: [],
      beams: [],
      skirting: [],
    },
    warningAcknowledgements: [],
  }
}

/**
 * | `CabinetSceneUnit{id,label,settings,root,x,y}` | Item Design `kind:'cabinet'`, with
 * | `id = unit.id`, `name = unit.label` and `construction: {settings, root}`. `settings`
 * | is copied byte-for-byte, including `settings.unit` (`mm`, `cm` or `in`). |
 *
 * The one thing not copied is a node's `material`, which v2 replaced with
 * `settings.material` and nothing has read since: domain v1 has no field for it, so it is
 * dropped here rather than rejected by the domain validator.
 */
function cabinetItemDesign(unit: LegacyCabinetUnit): CabinetItemDesign {
  return {
    id: unit.id,
    kind: 'cabinet',
    name: unit.label,
    construction: {
      settings: { ...unit.settings } as GlobalSettings,
      root: copyNode(unit.root),
    },
  }
}

/**
 * | Plus one Existing Model Placed Item on Floor 1 with: a new ID; translation
 * | `(x + settings.width/2, settings.depth/2)`, so the cabinet front sits on plan Y = 0;
 * | `rotationDeg: 0`; `baseElevation = y`. Unit order is preserved as the Placed Item
 * | order. |
 *
 * `baseElevation = y` is #20's pinned convention: legacy `y` is a top-edge offset in the
 * front view, not a centre. `derive`'s `cabinetSceneUnits` inverts exactly this.
 */
function cabinetPlacement(unit: LegacyCabinetUnit, floorId: string, placedId: string): PlacedItem {
  return {
    id: placedId,
    itemDesignId: unit.id,
    floorId,
    translation: { x: unit.x + unit.settings.width / 2, y: unit.settings.depth / 2 },
    rotationDeg: 0,
    baseElevation: unit.y,
  }
}

/** A copy of one space, minus the retired node-level `material`, down to the leaves. */
function copyNode(node: LegacyCabinetNode): CabinetNode {
  const { material: retiredMaterial, ...rest } = node
  void retiredMaterial
  return {
    ...rest,
    ...(node.children === undefined ? {} : {
      children: [copyNode(node.children[0]), copyNode(node.children[1])] as [CabinetNode, CabinetNode],
    }),
    ...(node.dividers === undefined ? {} : { dividers: node.dividers.map((divider) => ({ ...divider })) }),
    ...(node.accessories === undefined ? {} : {
      accessories: node.accessories.map((accessory) => ({ ...accessory })),
    }),
  }
}

// --- Floor plan → content -----------------------------------------------------

export type FloorPlanMapping =
  | {
      ok: true
      content: LegacyFloorPlanContent
      discarded: LegacyDiscardedSketches
      assets: LegacyAsset[]
    }
  | { ok: false; problems: ValidationProblem[] }

/**
 * The global floor plan, mapped but not attached: the Plan Image, one generic Item Design
 * per object plus one per saved shape, and a placement per object. The caller decides
 * which Project owns it (#14), which is why this returns content rather than a Project.
 */
export async function mapFloorPlan(
  data: LegacyFloorPlanData,
  newId: () => string,
): Promise<FloorPlanMapping> {
  const assets = new Map<string, LegacyAsset>()

  let planImage: PlanImage | null = null
  if (data.image !== null) {
    const image = await planImageOf(data.image, data.pixelsPerMm, assets)
    if (!image.ok) return { ok: false, problems: image.problems }
    planImage = image.planImage
  }

  const itemDesigns: GenericItemDesign[] = []
  const placements: LegacyFloorPlanContent['placements'] = []
  for (const object of data.objects) {
    const design = objectItemDesign(object, newId())
    itemDesigns.push(design)
    placements.push(objectPlacement(object, design.id))
  }
  for (const template of data.customTemplates) {
    itemDesigns.push(templateItemDesign(template))
  }

  const discarded: LegacyDiscardedSketches = { wallHack: 0, tileZone: 0 }
  for (const annotation of data.annotations) {
    if (annotation.type === 'wall-hack') discarded.wallHack += 1
    else discarded.tileZone += 1
  }

  return {
    ok: true,
    content: { planImage, itemDesigns, placements },
    discarded,
    assets: [...assets.values()],
  }
}

/**
 * | `FloorPlanObject{id,type,label,x,y,w,h,rotation,color,isCustom}` | One generic Item
 * | Design per object (1:1), with a new ID: `name = label`; footprint `{kind:'rectangle',
 * | width: w, depth: h}` with its origin stored at the centre `(w/2, h/2)`; `colour =
 * | color`; `catalogKey = type`; `isCustom = isCustom` (omitted when absent);
 * | `heightIsTypical: true`, with height and base from the table. |
 *
 * The new ID is what lets the legacy object ID stay on the Placed Item, which is the
 * address the Migration review quotes back to the user.
 */
function objectItemDesign(object: LegacyFloorPlanObject, designId: string): GenericItemDesign {
  const typical = TYPICAL_SIZES[object.type]
  return {
    id: designId,
    kind: 'generic',
    name: object.label,
    footprint: rectangleFootprint(object.w, object.h),
    origin: { x: object.w / 2, y: object.h / 2 },
    height: typical.height,
    heightIsTypical: true,
    color: object.color,
    catalogKey: object.type,
    ...(object.isCustom === undefined ? {} : { isCustom: object.isCustom }),
  }
}

/**
 * | Plus one Existing Model Placed Item with `id = object.id`, translation
 * | `(x + w/2, y + h/2)` and `rotationDeg = rotation` (0, 90, 180 or 270, clockwise with
 * | +Y down, which matches domain v1). |
 *
 * Centres, not corners: legacy rotation is about the centre (the legacy canvas drew
 * `rotate(rotation, cx, cy)`), and a domain placement rotates about the Item Origin too.
 */
function objectPlacement(object: LegacyFloorPlanObject, designId: string): LegacyFloorPlanContent['placements'][number] {
  return {
    id: object.id,
    itemDesignId: designId,
    translation: { x: object.x + object.w / 2, y: object.y + object.h / 2 },
    rotationDeg: object.rotation,
    baseElevation: TYPICAL_SIZES[object.type].base,
  }
}

/**
 * | `CustomTemplate{id,label,defaultW,defaultH,color}` | A generic Item Design with
 * | `id = template.id`. The footprint is `{kind:'rectangle', width: defaultW, depth:
 * | defaultH}`, with the origin at the centre. It has `isCustom: true`,
 * | `heightIsTypical: true` and no placements. |
 */
function templateItemDesign(template: LegacyCustomTemplate): GenericItemDesign {
  return {
    id: template.id,
    kind: 'generic',
    name: template.label,
    footprint: rectangleFootprint(template.defaultW, template.defaultH),
    origin: { x: template.defaultW / 2, y: template.defaultH / 2 },
    height: TYPICAL_CUSTOM.height,
    heightIsTypical: true,
    color: template.color,
    isCustom: true,
  }
}

/**
 * | `floorPlan.image` + `pixelsPerMm` | The base64 `dataUrl` is decoded to bytes and
 * | hashed with SHA-256. The result is a Plan Image record `{assetHash, mediaType,
 * | widthPx, heightPx, pixelsPerMm | null}`, where `mediaType` comes from the data-URL
 * | prefix. Legacy media types are kept even when they are not PNG, JPEG or WebP. Image
 * | scale is `1/pixelsPerMm`, or 1 when uncalibrated. Object geometry values are never
 * | rescaled. |
 *
 * The Plan Image stores `pixelsPerMm` itself, so the scale is derived where it is used and
 * nothing here rewrites a coordinate (#11 finding 6).
 */
async function planImageOf(
  image: LegacyFloorPlanImage,
  pixelsPerMm: number | null,
  assets: Map<string, LegacyAsset>,
): Promise<{ ok: true; planImage: PlanImage } | { ok: false; problems: ValidationProblem[] }> {
  const path = 'image.dataUrl'
  const data = splitDataUrl(image.dataUrl)
  if (data === null) {
    return { ok: false, problems: [problem(path, 'bad-data-url', 'Expected a base64 data URL.')] }
  }
  const bytes = decodeBase64(data.body)
  if (bytes === null) {
    return { ok: false, problems: [problem(path, 'bad-data-url', 'Expected the image encoded as base64.')] }
  }

  const sha256 = await sha256Hex(bytes)
  const known = assets.get(sha256)
  if (known === undefined) assets.set(sha256, { sha256, mediaType: data.mediaType, bytes })

  return {
    ok: true,
    planImage: {
      assetHash: sha256,
      mediaType: data.mediaType as PlanImage['mediaType'],
      widthPx: image.widthPx,
      heightPx: image.heightPx,
      pixelsPerMm,
    },
  }
}

/** `data:<mediaType>;base64,<body>`, or `null` for anything else. */
function splitDataUrl(value: string): { mediaType: string; body: string } | null {
  if (!value.startsWith('data:')) return null
  const comma = value.indexOf(',')
  if (comma < 0) return null
  const meta = value.slice('data:'.length, comma).split(';')
  const mediaType = meta[0] ?? ''
  if (mediaType.length === 0 || !meta.includes('base64')) return null
  return { mediaType, body: value.slice(comma + 1) }
}
