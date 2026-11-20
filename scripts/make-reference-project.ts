/**
 * The S4 performance reference Project (#47, #20 §8).
 *
 * Run with `node scripts/make-reference-project.ts`; it rewrites
 * `fixtures/domain/v1/reference-project.json`,
 * `fixtures/domain/v2/reference-project.json` and
 * `fixtures/domain/v3/reference-project.json` byte for byte. All three are committed, and
 * `src/domain/fixtures.test.ts` migrates and canonicalises each on every run like any other
 * domain fixture. The v2 file is the v1 one through `migrateV1toV2` — the same Project, plus
 * the default Plan View each Floor comes with (#56) — and the v3 file is that one through
 * `migrateV2toV3`, with every Item Footprint restated as a Rectangle preset (#58). That is
 * how a benchmark can measure the current schema without rewriting the compatibility evidence
 * next to it.
 *
 * The shape is the S4 subset of #20 §8's reference Project — 3 Floors, 200 generic Placed
 * Items per Floor, 30 cabinet Item Designs of tree depth 8 each placed once on Floor 1.
 * Walls, Openings and the rest extend this generator when their capabilities arrive.
 *
 * #60 gave it the two shapes the drawing path is slow on: 40 of every Floor's 200 generic
 * Placed Items carry preset Item Footprints with arcs (Rounded Rectangle, Circle, Capsule),
 * and rotations run through 0–359° in 7° steps instead of four right angles. Deriving a
 * Floor is now measured on curved outlines turned to arbitrary angles, which is what the
 * Plan View actually has to draw; four rotations let a per-angle cache look fast.
 *
 * The arc footprints are written in the current Item Footprint shape rather than v1's
 * `{ kind: 'rectangle', width, depth }`, because v1 had no way to describe a curve and
 * `migrateV2toV3` deliberately leaves anything it did not author alone. That makes the v1
 * and v2 twins a *benchmark* document rather than something a v1 BuildBox could have
 * written — which they already were, since no v1 writer ever emitted `views` either. The
 * entity IDs are unchanged, so `src/domain/remapIds.property.test.ts`'s pinned count holds.
 *
 * Floor 1's Plan Image points at `fixtures/domain/reference-plan-image.png`, a 64 × 48 PNG
 * committed next to these files, so the derived record carries the hash of bytes that
 * exist. Its `widthPx`/`heightPx` are read out of the PNG's own header, so the record
 * cannot drift from the asset it names.
 *
 * Everything is derived from the index, so the same generator gives the same bytes: no
 * clock, no randomness, no ID allocator.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { canonicalJson } from '../src/lib/canonicalJson.ts'
import { DOMAIN_SCHEMA_VERSION, migrateV1toV2, migrateV2toV3 } from '../src/domain/migrate.ts'
import type {
  CabinetItemDesign,
  CabinetNode,
  ElementType,
  GenericItemDesign,
  GlobalSettings,
  ItemDesign,
  ItemFootprint,
  PlacedItem,
  Preset,
  Project,
  SplitAxis,
} from '../src/domain/project.ts'

const OUT_FILE = fileURLToPath(new URL('../fixtures/domain/v1/reference-project.json', import.meta.url))
const OUT_FILE_V2 = fileURLToPath(new URL('../fixtures/domain/v2/reference-project.json', import.meta.url))
const OUT_FILE_V3 = fileURLToPath(new URL('../fixtures/domain/v3/reference-project.json', import.meta.url))

const FLOOR_NAMES = ['Floor 1', 'Floor 2', 'Floor 3']
const CABINET_COUNT = 30
const CABINET_TREE_DEPTH = 8
const PLAN_ITEMS_PER_FLOOR = 200

/** The Plan Image asset Floor 1 is calibrated against (#60). Small on purpose: the record
 * is what the derive path reads, and the bytes only have to exist and hash. */
const PLAN_IMAGE_FILE = fileURLToPath(new URL('../fixtures/domain/reference-plan-image.png', import.meta.url))
const PLAN_IMAGE_BYTES = readFileSync(PLAN_IMAGE_FILE)

/** `width` × `height` from the PNG's own IHDR, so the record describes the real asset. */
function pngSize(bytes: Buffer): { widthPx: number; heightPx: number } {
  if (bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`${PLAN_IMAGE_FILE} is not a PNG`)
  }
  return { widthPx: bytes.readUInt32BE(16), heightPx: bytes.readUInt32BE(20) }
}

const PLAN_IMAGE_ASSET_HASH = createHash('sha256').update(PLAN_IMAGE_BYTES).digest('hex')
const PLAN_IMAGE_SIZE = pngSize(PLAN_IMAGE_BYTES)
/** 0.2 px per mm, so the 64 × 48 sheet stands for a 320 × 240 mm scan. */
const PLAN_IMAGE_PIXELS_PER_MM = 0.2

/** The legacy default cabinet, the way `defaultDesign()` still builds one. */
const DEFAULT_SETTINGS: GlobalSettings = {
  unit: 'mm',
  height: 800,
  width: 600,
  depth: 500,
  thickness: 18,
  backThickness: 6,
  toeKick: null,
  material: 'oak',
}

/** The legacy catalog, copied here because `scripts` runs outside the module graph. */
const CATALOG: Array<{ key: string; w: number; h: number; height: number; base: number; color: string }> = [
  { key: 'sofa-2', w: 1500, h: 800, height: 850, base: 0, color: '#6366f1' },
  { key: 'bed-queen', w: 1520, h: 1980, height: 500, base: 0, color: '#8b5cf6' },
  { key: 'fridge', w: 600, h: 650, height: 1800, base: 0, color: '#10b981' },
  { key: 'toilet', w: 380, h: 680, height: 750, base: 0, color: '#0ea5e9' },
  { key: 'shower', w: 900, h: 900, height: 2100, base: 0, color: '#0ea5e9' },
  { key: 'tv', w: 1200, h: 80, height: 700, base: 900, color: '#374151' },
  { key: 'wardrobe', w: 1800, h: 600, height: 2400, base: 0, color: '#92400e' },
  { key: 'washer', w: 600, h: 600, height: 850, base: 0, color: '#10b981' },
]

/**
 * Rotations in 7° steps, so 51 distinct angles appear across a Floor and no angle is a
 * right angle by accident (#60). Four rotations let a derive path look cheap by caching on
 * the angle; a prime-ish step makes every placement rotate the outline for real.
 */
const ROTATION_STEP_DEG = 7

/**
 * A full binary tree `depth` splits deep, alternating the axis every level. `path` is the
 * node's address from the root — `'n'`, then one digit per turn — so every ID is unique
 * inside the design and says where the node sits.
 */
function tree(prefix: string, depth: number, path = 'n'): CabinetNode {
  const id = `${prefix}-${path}`
  const level = path.length - 1
  if (level === depth) {
    const leaf = leafType(parseInt(path.slice(1), 2))
    return leaf === 'drawer'
      ? { id, elementType: leaf, drawerConfig: { slideType: 'side-mount', reveal: 3 } }
      : { id, elementType: leaf }
  }
  const axis: SplitAxis = level % 2 === 0 ? 'horizontal' : 'vertical'
  return {
    id,
    splitAxis: axis,
    splitRatio: 0.5,
    children: [tree(prefix, depth, `${path}0`), tree(prefix, depth, `${path}1`)],
  }
}

/** A little vocabulary variety, so validation walks every node feature it knows. */
function leafType(index: number): ElementType {
  if (index % 7 === 0) return 'drawer'
  if (index % 5 === 0) return 'microwave'
  if (index % 3 === 0) return 'hanging-space'
  return 'void'
}

function cabinets(): { designs: CabinetItemDesign[]; placements: PlacedItem[] } {
  const designs: CabinetItemDesign[] = []
  const placements: PlacedItem[] = []
  for (let index = 0; index < CABINET_COUNT; index += 1) {
    const id = `cabinet-${index}`
    designs.push({
      id,
      kind: 'cabinet',
      name: `Unit ${index + 1}`,
      construction: {
        settings: { ...DEFAULT_SETTINGS },
        root: tree(id, CABINET_TREE_DEPTH),
      },
    })
    // Legacy `x = index * (width + 20)`, `y = 0`, in the #43 placement convention.
    const x = index * (DEFAULT_SETTINGS.width + 20)
    placements.push({
      id: `placed-cabinet-${index}`,
      itemDesignId: id,
      floorId: 'floor-0',
      translation: { x: x + DEFAULT_SETTINGS.width / 2, y: DEFAULT_SETTINGS.depth / 2 },
      rotationDeg: 0,
      baseElevation: 0,
    })
  }
  return { designs, placements }
}

/**
 * Every fifth Item Footprint is a preset with arcs (#60): Rounded Rectangle, Circle and
 * Capsule in turn, sized to the catalog entry so the Floor still reads as furniture. The
 * other four keep v1's `{ kind: 'rectangle', width, depth }`, which `migrateV2toV3` turns
 * into the Rectangle preset — the mix is the point, because a Plan View draws both.
 */
const ARC_PRESET_EVERY = 5
const ARC_PRESET_KINDS = ['roundedRectangle', 'circle', 'capsule'] as const

function arcPreset(kind: (typeof ARC_PRESET_KINDS)[number], width: number, depth: number): Preset {
  const small = Math.min(width, depth)
  const large = Math.max(width, depth)
  if (kind === 'circle') return { kind, diameter: small }
  if (kind === 'capsule') {
    // A Capsule is a straight run between two rounded ends, so its length has to exceed its
    // width. A square catalog box has no longer axis to run along, and three quarters of the
    // side is what leaves a run at all.
    return { kind, length: large, width: small === large ? small * 0.75 : small }
  }
  return { kind, width, depth, radius: small / 4 }
}

function planFootprint(index: number, width: number, depth: number): ItemFootprint | { kind: 'rectangle'; width: number; depth: number } {
  if (index % ARC_PRESET_EVERY !== 0) return { kind: 'rectangle', width, depth }
  const kind = ARC_PRESET_KINDS[Math.floor(index / ARC_PRESET_EVERY) % ARC_PRESET_KINDS.length]!
  return {
    kind: 'preset',
    preset: arcPreset(kind, width, depth),
    // The same local bounds the rectangle case draws: (0,0) to (width,depth).
    centre: { x: width / 2, y: depth / 2 },
    orientationDeg: 0,
  }
}

/** A 10 × 20 grid of catalog items per Floor, 400 mm apart. */
function planItems(): { designs: GenericItemDesign[]; placements: PlacedItem[] } {
  const designs: GenericItemDesign[] = []
  const placements: PlacedItem[] = []
  FLOOR_NAMES.forEach((_, floorIndex) => {
    for (let index = 0; index < PLAN_ITEMS_PER_FLOOR; index += 1) {
      const entry = CATALOG[(floorIndex + index) % CATALOG.length]!
      const id = `generic-${floorIndex}-${index}`
      designs.push({
        id,
        kind: 'generic',
        name: entry.key,
        footprint: planFootprint(index, entry.w, entry.h),
        origin: { x: entry.w / 2, y: entry.h / 2 },
        height: entry.height,
        heightIsTypical: true,
        color: entry.color,
        catalogKey: entry.key,
      })
      placements.push({
        id: `placed-${id}`,
        itemDesignId: id,
        floorId: `floor-${floorIndex}`,
        translation: {
          x: 2000 + (index % 10) * 400,
          y: 2000 + Math.floor(index / 10) * 400,
        },
        rotationDeg: (index * ROTATION_STEP_DEG) % 360,
        baseElevation: entry.base,
      })
    }
  })
  return { designs, placements }
}

function referenceProject(): Project {
  const cabinet = cabinets()
  const plan = planItems()
  return {
    id: 'reference-project',
    meta: { name: 'Reference Project' },
    preferences: { displayUnit: 'mm', displayPrecision: 0 },
    floors: FLOOR_NAMES.map((name, index) => ({
      id: `floor-${index}`,
      name,
      planImage:
        index === 0
          ? {
              assetHash: PLAN_IMAGE_ASSET_HASH,
              mediaType: 'image/png',
              widthPx: PLAN_IMAGE_SIZE.widthPx,
              heightPx: PLAN_IMAGE_SIZE.heightPx,
              pixelsPerMm: PLAN_IMAGE_PIXELS_PER_MM,
            }
          : null,
    })),
    itemDesigns: [...cabinet.designs, ...plan.designs] satisfies ItemDesign[],
    existingModel: { placedItems: [...cabinet.placements, ...plan.placements] },
  }
}

const project = referenceProject()
const envelope = { domainSchemaVersion: 1, project }
writeFileSync(OUT_FILE, `${canonicalJson(envelope)}\n`)

// The v2 twin, through the real migrator with the fixture's own ID convention. Stamped 2 on
// purpose: it is the record a v2 BuildBox wrote, and the point of keeping it is that a v2
// file still opens.
const v2Project = migrateV1toV2(project, (count) => Array.from({ length: count }, (_, index) => `view-${index}`))
writeFileSync(OUT_FILE_V2, `${canonicalJson({ domainSchemaVersion: 2, project: v2Project })}\n`)

// The current-schema twin: the same Project again, with every Item Footprint restated as a
// Rectangle preset (#58). No new IDs, and the geometry it draws is identical.
const v3Project = migrateV2toV3(v2Project)
writeFileSync(OUT_FILE_V3, `${canonicalJson({ domainSchemaVersion: DOMAIN_SCHEMA_VERSION, project: v3Project })}\n`)

const nodes = (node: CabinetNode): number =>
  node.children === undefined ? 1 : 1 + nodes(node.children[0]) + nodes(node.children[1])

console.log(
  `${OUT_FILE}\n  ${OUT_FILE_V2}\n` +
    `  floors: ${project.floors.length}\n` +
    `  item designs: ${project.itemDesigns.length} (cabinet tree nodes: ${nodes(project.itemDesigns[0]!.kind === 'cabinet' ? project.itemDesigns[0]!.construction.root : { id: 'x' })})\n` +
    `  placed items: ${project.existingModel.placedItems.length}\n`,
)
