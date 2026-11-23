/**
 * Generate `fixtures/domain/v9/plan-range-scene.json` (#74, the Fixture scene).
 *
 * The scene the Range and Overlap-selection criteria are stated against, assembled entirely through
 * the Intents the editor dispatches — nothing here writes a field directly, so the fixture cannot
 * describe a Project the editor could not have produced, and `validateProject` at the end is what
 * proves the transcript ends somewhere legal:
 *
 *   Floor        the Floor Datum is Z = 0 by definition; limits upper 2 600, no lower limit
 *   Walls        W-1…W-4, a 4 m × 3 m shell, every one of them 0–2 600
 *   Opening      WND-1, a window in W-1 at 900–2 100
 *   Items        `Base cabinet` (860) placed twice at Base 0 — `#1` and `#2`; `Wall cabinet` (700)
 *                placed once at Base 1 500, standing over `Base cabinet #1`; `Sump box` (100) at
 *                Base −150, the one entity below the Floor Datum
 *   View         the Floor's default Plan View, its Plan View Range at 0–1 200 — the range criterion
 *                1 counts the classes at, criterion 9 cycles at, and the gauge shows as `Lower 0` and
 *                `Upper 1200`
 *
 * Every height in the scene is a cabinet design's, because that is what the Intents can set today:
 * `design.update` patches a generic design's name and colour only, and `plan.addTemplate` fixes 900.
 * The three designs are therefore `cabinet.addUnit` copies of one another, renamed and re-set — the
 * three names and three heights the spec names, reached the only legal way until #76 owns generic
 * Item Design heights.
 *
 *   npx vite-node scripts/make-plan-range-seed.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIntent, CREATE_PROJECT_ID_COUNT, createProject, INTENT_LABELS } from '../src/edit'
import type { IntentType, PayloadOf } from '../src/edit'
import { designHeight, validateProject } from '../src/domain'
import type { EntityId, Project } from '../src/domain'
import { canonicalJson } from '../src/lib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(repoRoot, 'fixtures/domain/v9/plan-range-scene.json')

const NOW = '2026-01-01T10:15:00+08:00'
const PROJECT_NAME = 'Plan with a Plan View Range'

/** The scene's one range: criterion 1 counts the classes at it, and criterion 9 cycles at it. */
const RANGE_LOWER = 0
const RANGE_UPPER = 1200
/** The extents the fixture spec names, in millimetres. */
const BASE_CABINET_HEIGHT = 860
const WALL_CABINET_HEIGHT = 700
const SUMP_BOX_HEIGHT = 100
const STOREY = 2600
const SILL = 900
const HEAD = 2100
/** The gap between the three base-level footprints, so the scene's classes are readable apart. */
const SPACING = 800

function fail(message: string): never {
  console.error(`make-plan-range-seed: ${message}`)
  process.exit(1)
}

let nextId = 0
const newIds = (count: number): string[] => Array.from({ length: count }, () => `pr-${String(++nextId).padStart(3, '0')}`)

/** One Intent, with the IDs it spends minted the way the app mints them. */
function apply<T extends IntentType>(project: Project, type: T, payload: PayloadOf<T>, ids: string[] = []): Project {
  const intent = { type, payload, label: INTENT_LABELS[type], ids, now: NOW } as Parameters<typeof applyIntent>[1]
  const applied = applyIntent(project, intent)
  if (!applied.ok) fail(`${type} was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
  return applied.project
}

// --- the Project, the Floor and the one Plan View ---------------------------------------------

let current = createProject({ ids: newIds(CREATE_PROJECT_ID_COUNT), now: NOW, name: PROJECT_NAME })
const floorId: EntityId = current.floors[0]?.id ?? fail('a new Project has no Floor')
const viewId: EntityId = current.views.find((view) => view.isDefault)?.id ?? fail('the Floor has no default view')

const designId = (name: string): EntityId =>
  current.itemDesigns.find((design) => design.name === name)?.id ?? fail(`no Item Design is named ${name}`)

// --- the three Item Designs and the four placements --------------------------------------------
//
// `createProject` brings one cabinet design, `Unit 1`, with one placement of it. That design becomes
// `Base cabinet` and its placement is `Base cabinet #1`. The other two designs come from
// `cabinet.addUnit`, which — the way the Unit tool works — places the new Unit as it creates it: that
// placement is kept and moved, so the scene ends with exactly the four placements the spec names and
// nothing has to be deleted afterwards. All three designs carry the same construction and differ only
// in the two things this scene is about: a name and a height.
//
// The Wall cabinet stands over `Base cabinet #1` on the same Item Origin, which is the pair criterion 9
// clicks: two footprints on one spot, one In range and one Above it. `Base cabinet #2` and the sump box
// stand clear, so each Range Class also has an entity that is not part of that cycle.

const baseDesign: EntityId = current.itemDesigns[0]?.id ?? fail('a new Project has no Item Design')
current = apply(current, 'design.update', { itemDesignId: baseDesign, patch: { name: 'Base cabinet' } })
current = apply(current, 'cabinet.updateSettings', { itemDesignId: baseDesign, patch: { height: BASE_CABINET_HEIGHT } })

/** The one placement of a design, which the scene keeps to one per design but `Base cabinet`. */
const placementOf = (design: EntityId): EntityId =>
  current.existingModel.placedItems.find((item) => item.itemDesignId === design)?.id ?? fail(`design ${design} has no placement`)

const at = (column: number): { x: number; y: number } => ({ x: 600 + column * SPACING, y: 600 })
const move = (placedItemId: EntityId, column: number): Project => apply(current, 'plan.movePlacement', { placedItemId, translation: at(column) })

current = move(placementOf(baseDesign), 0)

for (const [name, height, column, base] of [
  ['Wall cabinet', WALL_CABINET_HEIGHT, 0, 1500],
  ['Sump box', SUMP_BOX_HEIGHT, 2, -150],
] as const) {
  const before = new Set(current.itemDesigns.map((design) => design.id))
  current = apply(current, 'cabinet.addUnit', { sourceItemDesignId: baseDesign }, newIds(3))
  const added = current.itemDesigns.find((design) => !before.has(design.id)) ?? fail(`${name} was not added`)
  current = apply(current, 'design.update', { itemDesignId: added.id, patch: { name } })
  current = apply(current, 'cabinet.updateSettings', { itemDesignId: added.id, patch: { height } })
  // The Unit tool placed it where the tool would have dropped it; the scene wants it in its own column,
  // at the Base that puts it in its own Range Class.
  current = move(placementOf(added.id), column)
  current = apply(current, 'plan.setPlacementVerticalExtent', {
    placedItemId: placementOf(added.id),
    field: 'base',
    value: base,
    target: { designOptionId: null },
  })
}

// `Base cabinet #2` is a second placement of the same design, at Base 0 — the read-only Height line
// then reads `shared by 2 placements`, which is what §5's line is for.
current = apply(current, 'plan.placeDesign', { floorId, itemDesignId: designId('Base cabinet'), target: { designOptionId: null } }, newIds(1))
const secondBase = current.existingModel.placedItems.filter((item) => item.itemDesignId === baseDesign)[1] ?? fail('there is no second base cabinet')
current = move(secondBase.id, 1)

// --- the shell, and the window in it -----------------------------------------------------------
//
// Four free-ended Walls rather than one closed chain: the scene is about heights, and free ends keep
// it free of Wall Junctions that would add entities no criterion here counts.

current = apply(current, 'floor.setLimits', { floorId, lowerMm: null, upperMm: STOREY })

const corners: readonly [{ x: number; y: number }, { x: number; y: number }][] = [
  [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
  [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
  [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }],
  [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
]
for (const [start, end] of corners) {
  current = apply(
    current,
    'wall.createChain',
    {
      floorId,
      walls: [{ line: { kind: 'line', start, end }, thickness: 200, justification: 'centre', baseElevation: 0, height: STOREY }],
      starts: [{ kind: 'free' }],
      ends: [{ kind: 'free' }],
    },
    newIds(1),
  )
}

current = apply(
  current,
  'opening.create',
  {
    floorId,
    hostWallId: current.existingModel.walls[0]?.id ?? fail('the shell has no first Wall'),
    kind: 'window',
    label: 'Window 1',
    start: 1500,
    width: 1200,
    sill: SILL,
    head: HEAD,
  },
  newIds(1),
)

// --- the Plan View Range -----------------------------------------------------------------------

current = apply(current, 'view.setPlanViewRange', { viewId, lowerMm: RANGE_LOWER, upperMm: RANGE_UPPER })

// --- the check and the write -------------------------------------------------------------------

const checked = validateProject(current)
if (!checked.ok) fail(`the scene does not validate: ${JSON.stringify(checked.problems, null, 2)}`)

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${canonicalJson({ domainSchemaVersion: 9, project: current })}\n`)

const refOf = (wallId: EntityId): string => current.existingModel.walls.find((wall) => wall.id === wallId)?.ref ?? '?'
const nameOf = (designIdOf: EntityId): string => current.itemDesigns.find((design) => design.id === designIdOf)?.name ?? '?'

console.log(
  `make-plan-range-seed: ${OUT}\n` +
    `  ${current.floors[0]?.name}: limits ${JSON.stringify(current.floors[0]?.limits)}\n` +
    `  walls ${current.existingModel.walls.map((wall) => `${wall.ref} ${wall.baseElevation}–${wall.baseElevation + wall.height}`).join(', ')}\n` +
    `  openings ${current.existingModel.openings.map((o) => `${o.label} ${o.sill}–${o.head} in ${refOf(o.hostWallId)}`).join(', ')}\n` +
    `  items ${current.existingModel.placedItems
      .map((item) => `${nameOf(item.itemDesignId)} base ${item.baseElevation}–${item.baseElevation + designHeight(current.itemDesigns.find((d) => d.id === item.itemDesignId)!)}`)
      .join(', ')}\n` +
    `  ${current.views.find((view) => view.id === viewId)?.name}: range ${RANGE_LOWER}–${RANGE_UPPER}\n` +
    `  ids minted: ${nextId}`,
)
