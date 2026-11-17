/**
 * The S4 performance reference Project (#47, #20 §8).
 *
 * Run with `node scripts/make-reference-project.ts`; it rewrites
 * `fixtures/domain/v1/reference-project.json` byte for byte. The file is committed, and
 * `src/domain/fixtures.test.ts` migrates and canonicalises it on every run like any other
 * domain fixture.
 *
 * The shape is the S4 subset of #20 §8's reference Project — 3 Floors, 200 generic Placed
 * Items per Floor, 30 cabinet Item Designs of tree depth 8 each placed once on Floor 1.
 * Walls, Openings and the rest extend this generator when their capabilities arrive.
 *
 * Everything is derived from the index, so the same generator gives the same bytes: no
 * clock, no randomness, no ID allocator.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { canonicalJson } from '../src/lib/canonicalJson.ts'
import type {
  CabinetItemDesign,
  CabinetNode,
  ElementType,
  GenericItemDesign,
  GlobalSettings,
  ItemDesign,
  PlacedItem,
  Project,
  SplitAxis,
} from '../src/domain/project.ts'

const OUT_FILE = fileURLToPath(new URL('../fixtures/domain/v1/reference-project.json', import.meta.url))

const FLOOR_NAMES = ['Floor 1', 'Floor 2', 'Floor 3']
const CABINET_COUNT = 30
const CABINET_TREE_DEPTH = 8
const PLAN_ITEMS_PER_FLOOR = 200

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

const ROTATIONS = [0, 90, 180, 270]

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
        footprint: { kind: 'rectangle', width: entry.w, depth: entry.h },
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
        rotationDeg: ROTATIONS[index % ROTATIONS.length]!,
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
              assetHash: '0'.repeat(64),
              mediaType: 'image/png',
              widthPx: 2000,
              heightPx: 1500,
              pixelsPerMm: 0.2,
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

const nodes = (node: CabinetNode): number =>
  node.children === undefined ? 1 : 1 + nodes(node.children[0]) + nodes(node.children[1])

console.log(
  `${OUT_FILE}\n` +
    `  floors: ${project.floors.length}\n` +
    `  item designs: ${project.itemDesigns.length} (cabinet tree nodes: ${nodes(project.itemDesigns[0]!.kind === 'cabinet' ? project.itemDesigns[0]!.construction.root : { id: 'x' })})\n` +
    `  placed items: ${project.existingModel.placedItems.length}\n`,
)
