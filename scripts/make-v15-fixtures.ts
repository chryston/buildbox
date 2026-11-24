/**
 * Writes the `fixtures/domain/v15/` goldens (#80 §1).
 *
 * Run it with `npx vite-node scripts/make-v15-fixtures.ts`. Every v14 fixture is carried forward by
 * the real chain — the same `migrateProject` the app runs — and written as canonical JSON, so the
 * goldens are the bytes the chain actually produces, not a hand-edit of them. The v14 files are
 * never touched: they stay on disk as that version's permanent compatibility evidence.
 *
 * The one file that is not a carry is `comments.json`: the shared renovation scene with the Comments
 * the v15 step could not have invented — one of every Anchor kind, a Resolved one, and one anchored
 * inside a cabinet's tree — because that scene is what the #80 derive, panel and package tests are
 * judged against. Every target it names is read out of the scene itself rather than written down, so
 * the golden cannot drift from the record it points at.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson } from '../src/lib'
import { DOMAIN_SCHEMA_VERSION, migrateProject, type Comment, type Project } from '../src/domain'
import { MIGRATORS } from '../src/domain/migrate'

if (MIGRATORS.length !== 14 || DOMAIN_SCHEMA_VERSION !== 15) {
  console.error(`Expected fourteen migrators and schema v15, found ${String(MIGRATORS.length)} and v${String(DOMAIN_SCHEMA_VERSION)}.`)
  process.exit(1)
}

const SOURCE = join('fixtures', 'domain', 'v14')
const OUT = join('fixtures', 'domain', 'v15')
const NAMES = [
  'beams-scene',
  'beams',
  'clearance',
  'elevation-scene',
  'export',
  'layers-zero',
  'layers',
  'paste-elm',
  'paste-fitout',
  'plan-range-scene',
  'renovation',
  'renovation-views',
  'services-scene',
  'services',
  'skirting',
]

/** Sequential IDs, so a migrated fixture's new views are named the same way every run. */
function allocator(prefix = 'fixture-view'): (count: number) => string[] {
  let issued = 0
  return (count) => Array.from({ length: count }, () => `${prefix}-${(issued += 1)}`)
}

mkdirSync(OUT, { recursive: true })
for (const name of NAMES) {
  const envelope = JSON.parse(readFileSync(join(SOURCE, `${name}.json`), 'utf8')) as { domainSchemaVersion: number; project: unknown }
  const result = migrateProject(envelope.project, 14, allocator())
  if (!result.ok) {
    console.error(`${name}: ${result.error.message}`)
    process.exit(1)
  }
  writeFileSync(join(OUT, `${name}.json`), `${canonicalJson({ domainSchemaVersion: DOMAIN_SCHEMA_VERSION, project: result.project })}\n`)
  console.info(`wrote ${join(OUT, `${name}.json`)}`)
}

// The Comment golden: the renovation scene, plus one Comment of every Anchor kind. The targets come
// from the scene — its Floor, its first Design Option, its first Wall, a cabinet's own space — so
// every Anchor resolves, which is the whole point of a strict-import golden.
const scene = JSON.parse(readFileSync(join(OUT, 'renovation.json'), 'utf8')) as { domainSchemaVersion: number; project: Project }
const floorId = scene.project.floors[0]!.id
const option = scene.project.designOptions?.[0]
const wall = scene.project.existingModel.walls[0]
const cabinet = scene.project.itemDesigns.find((design) => design.kind === 'cabinet')
if (option === undefined || wall === undefined || cabinet === undefined || cabinet.kind !== 'cabinet') {
  console.error('comments: the renovation scene carries no Option, no Wall or no cabinet design')
  process.exit(1)
}
const nodeId = cabinet.construction.root.id

const CREATED = '2026-11-23T09:00:00.000Z'
const comment = (
  reference: string,
  title: string,
  body: string,
  anchor: Comment['anchor'],
  over: Partial<Comment> = {},
): Comment => ({
  id: `comment-${reference}`,
  reference,
  title,
  body,
  anchor,
  status: 'open',
  priority: 'normal',
  createdAt: CREATED,
  updatedAt: CREATED,
  ...over,
})

scene.project.comments.push(
  comment('C-001', 'Check the ceiling coordination', 'Walk the site before the first drawing is issued.', { kind: 'project' }, { scope: 'all', priority: 'high' }),
  comment('C-002', 'Re-measure the slab edge', 'The recorded Floor outline is from the 2019 survey.', { kind: 'floor', floorId }, { scope: 'all' }),
  comment('C-003', 'Confirm which layout this replaces', 'The client asked for both options side by side.', { kind: 'design_option', designOptionId: option.id }),
  comment('C-004', 'Supplier quotes a deeper carcass', 'Every placement of this unit is affected, not one of them.', { kind: 'item_design', itemDesignId: cabinet.id }, { scope: 'all' }),
  comment('C-005', 'Notch the base of this Wall', 'A duct passes at 100 mm above the Datum.', { kind: 'entity', entityId: wall.id }),
  comment('C-006', 'Clip fixed to this face', 'Mid-span, where the face is clear of the opening.', { kind: 'feature', ownerId: wall.id, featureId: 'leftFace', t: 0.5 }),
  comment('C-007', 'This space stays unlined', 'The client will paint the carcass itself.', { kind: 'feature', ownerId: cabinet.id, featureId: nodeId }),
  comment('C-008', 'Floor drain to be confirmed here', 'The gully is drawn on the structural plan only.', { kind: 'floor_point', floorId, point: { x: 3400, y: 2200 } }, { scope: option.id }),
  comment('C-009', 'Skirting colour settled', 'Agreed on site; nothing further to do.', { kind: 'floor', floorId }, {
    scope: 'all',
    status: 'resolved',
    resolvedAt: '2026-11-24T02:15:00.000Z',
    linkedWarning: { key: 'wall_crossing|wall-1,wall-2|', message: 'W-1 and W-2 cross without a Junction.' },
  }),
)
scene.project.commentReferenceCounter = 9
writeFileSync(join(OUT, 'comments.json'), `${canonicalJson({ domainSchemaVersion: DOMAIN_SCHEMA_VERSION, project: scene.project })}\n`)
console.info(`wrote ${join(OUT, 'comments.json')}`)
