/**
 * Generate `fixtures/e2e/prototype-parity/records.json` (#50 criterion 23).
 *
 * The Library's numeric comparison against the #28 archive only means anything if both sides
 * are showing the same four Projects, with the same names, addresses, Floor counts, save times
 * and backup states, at the same instant. The archive fakes those with literals in
 * `main.tsx`; this writes the real records behind them, through the in-memory adapter, so the
 * derived Library rows — `summary`, `sizeBytes`, the sort order — are whatever production
 * actually computes rather than what a hand-written fixture guessed.
 *
 *   npx vite-node scripts/make-prototype-parity.ts
 *
 * The clock is the one the spec pins with `page.clock.setFixedTime`. Every `savedAt` below is
 * stated relative to it, because the card's `{since}` text is what the comparison is checking;
 * the browser runs UTC, so the strings are UTC and the archive's `Yesterday, 8:42 PM` has to
 * fall out of the arithmetic rather than be asserted into existence.
 *
 * Recovery Points are emitted as counts, not snapshots. The card shows a number and nothing
 * else reads them; `e2e/support/seedPreviewDb.ts` materialises each count from the Project
 * record already in this file, which keeps the fixture the size of four Projects instead of
 * twenty-nine.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProject } from '../src/edit'
import { createMemoryAdapter } from '../src/persistence'
import type { LibraryRecord, Project, ProjectRecord } from '../src/persistence'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(repoRoot, 'fixtures/e2e/prototype-parity/records.json')

/** The database the flagged build opens, repeated here so a rename cannot pass silently. */
const DB_NAME = 'buildbox-preview'

/**
 * The instant the comparison freezes: `2026-10-07T10:44:00+08:00`, which is 02:44 UTC. The spec
 * pins the browser to the same moment; this only needs it to derive the times from.
 */
const NOW = new Date('2026-10-07T02:44:00.000Z')

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString()

function fail(message: string): never {
  console.error(`make-prototype-parity: ${message}`)
  process.exit(1)
}

/** Deterministic and obviously synthetic: a fixture must not look like someone's property. */
let nextId = 0
const newId = () => `parity-${String(++nextId).padStart(3, '0')}`

interface Fixture {
  /** The Project, its address, and the state its card has to render. */
  id: string
  name: string
  address: string
  /** Extra Floors beyond the one `createProject` makes. */
  extraFloors: string[]
  revision: number
  savedAt: string
  lastBackupInitiatedAt: string | null
  lastBackupRevision: number | null
  trashedAt: string | null
  recoveryPoints: number
}

/**
 * The four Projects of the #28 archive's Library, in the archive's order.
 *
 * The reminder count falls out of these rather than being asserted: `Tiong Bahru Home` has
 * never had a Backup and `Studio Renovation`'s is older than seven days with newer revisions
 * since, so the header reads `2 backup reminders`; `Parents’ Flat` was backed up six days ago
 * at the revision it is at now, which is the one case the rule must *not* fire on.
 */
const FIXTURES: Fixture[] = [
  {
    id: 'parity-tiong-bahru',
    name: 'Tiong Bahru Home',
    address: '18 Yong Siak Street',
    extraFloors: ['Bedroom'],
    revision: 3,
    savedAt: ago(2 * MINUTE),
    lastBackupInitiatedAt: null,
    lastBackupRevision: null,
    trashedAt: null,
    recoveryPoints: 8,
  },
  {
    id: 'parity-parents-flat',
    // The archive writes a typographic apostrophe here, and the comparison is of pixels.
    name: 'Parents’ Flat',
    address: '48 Marine Parade Road',
    extraFloors: [],
    revision: 7,
    // 2026-10-06T20:42Z: `Yesterday, 8:42 PM` in the pinned UTC browser.
    savedAt: '2026-10-06T20:42:00.000Z',
    lastBackupInitiatedAt: ago(6 * DAY),
    lastBackupRevision: 7,
    trashedAt: null,
    recoveryPoints: 12,
  },
  {
    id: 'parity-studio',
    name: 'Studio Renovation',
    address: '71 Ayer Rajah Crescent',
    extraFloors: [],
    revision: 3,
    savedAt: ago(4 * DAY),
    lastBackupInitiatedAt: ago(19 * DAY),
    lastBackupRevision: 1,
    trashedAt: null,
    recoveryPoints: 5,
  },
  {
    id: 'parity-old-apartment',
    name: 'Old Apartment Study',
    address: '9 Kim Yam Road',
    extraFloors: [],
    revision: 2,
    savedAt: ago(14 * DAY),
    lastBackupInitiatedAt: null,
    lastBackupRevision: null,
    trashedAt: ago(12 * DAY),
    recoveryPoints: 3,
  },
]

const ports = createMemoryAdapter()
const projects: ProjectRecord[] = []
const library: LibraryRecord[] = []

for (const fixture of FIXTURES) {
  const project: Project = createProject({
    ids: [fixture.id, `${fixture.id}-floor`, `${fixture.id}-design`, `${fixture.id}-place`, `${fixture.id}-root`],
    name: fixture.name,
  })
  project.meta.address = fixture.address
  for (const [index, floorName] of fixture.extraFloors.entries()) {
    project.floors.push({ id: `${fixture.id}-floor-${index + 2}`, name: floorName, planImage: null })
  }

  const committed = await ports.projects.commit(
    { project, revision: fixture.revision, savedAt: fixture.savedAt },
    null,
  )
  if (!committed.ok) fail(`"${fixture.name}" would not commit: ${committed.error.kind}`)

  const loaded = await ports.projects.load(fixture.id)
  if (!loaded.ok) fail(`"${fixture.name}" did not read back: ${loaded.error.kind}`)
  projects.push(loaded.value)

  const listed = await ports.projects.list({ includeTrashed: true })
  if (!listed.ok) fail(`the Library would not list: ${listed.error.kind}`)
  const record = listed.value.find((row) => row.id === fixture.id)
  if (record === undefined) fail(`"${fixture.name}" has no Library row`)
  // The three columns the adapter is not told about, because no commit writes them: a Backup
  // that was started, and a Trash that happened. `markBackupInitiated` and `trash` are what
  // would have set them in a running app.
  library.push({
    ...record,
    lastBackupInitiatedAt: fixture.lastBackupInitiatedAt,
    lastBackupRevision: fixture.lastBackupRevision,
    trashedAt: fixture.trashedAt,
  })
}

const due = library.filter(
  (record) =>
    record.trashedAt === null &&
    record.revision > (record.lastBackupRevision ?? 0) &&
    (record.lastBackupInitiatedAt === null || Date.parse(record.lastBackupInitiatedAt) < NOW.getTime() - 7 * DAY),
)
if (due.length !== 2) fail(`the fixture yields ${due.length} backup reminders, and the header says 2`)

const fixture = {
  dbName: DB_NAME,
  source: 'the #28 Variant A Library, at 2026-10-07T10:44:00+08:00',
  projects,
  library,
  assets: [],
  recovery: library.map((record) => ({ projectId: record.id, count: 0 })),
}
for (const entry of fixture.recovery) {
  const source = FIXTURES.find((row) => row.id === entry.projectId)
  if (source === undefined) fail(`no fixture for ${entry.projectId}`)
  entry.count = source.recoveryPoints
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`)

console.log(
  `make-prototype-parity: ${OUT}\n` +
    `  projects: ${library.map((r) => `${r.name}@r${r.revision}`).join(', ')}\n` +
    `  reminders: ${due.map((r) => r.name).join(', ')}\n` +
    `  recovery points: ${fixture.recovery.map((r) => `${r.projectId}=${r.count}`).join(', ')}`,
)
