import type { Page } from '@playwright/test'
import type { AssetRecord, LibraryRecord, ProjectRecord, ProjectSummary, RecoveryPointKind } from '../../src/persistence'

/**
 * Seeding the flagged build's database (#49 criterion 1).
 *
 * Raw IndexedDB, in an init script, before any app script runs: the preview app opens
 * `buildbox-preview` during mount, so the records have to exist by the time its first read
 * happens, and there is deliberately no production test hook to lean on. The store and index
 * names below are the adapter's own (`src/persistence/indexeddb/schema.ts`), created at the
 * same version, so the app's open finds an existing database and never upgrades it.
 *
 * The records come from `scripts/make-preview-seed.ts` — real conversion output, not a
 * hand-written guess at the shape.
 */

/** The database the app opens: since #53 the e2e artifact is the production one. */
export const E2E_DB_NAME = 'buildbox'

/** One stored asset, with its bytes base64-encoded because JSON cannot hold a Blob. */
export interface PreviewSeedAsset extends AssetRecord {
  base64: string
}

/**
 * One Recovery Point the fixture names exactly.
 *
 * The picker reads these rows — the clock time, the day word, why BuildBox kept it — so the
 * fixture that feeds it cannot let the seeder invent them. What a row does not name is taken from
 * the Project record already in the seed, because a Recovery Point *is* a copy of that record.
 */
export interface PreviewSeedRecoveryPoint {
  id: string
  createdAt: string
  kind: RecoveryPointKind
  /** The row's shape line; the Project's own summary when the fixture does not care about it. */
  summary?: ProjectSummary
}

/**
 * The Recovery Points a fixture wants.
 *
 * Either as rows, for the surfaces that list them (#51 §1), or as a count for a card that shows a
 * number and nothing else — the latter materialised from the Project record already in the seed,
 * which keeps the fixture the size of four Projects instead of twenty-nine.
 */
export interface PreviewSeedRecovery {
  projectId: string
  /** Newest first. Takes precedence over `count` when both are given. */
  points?: PreviewSeedRecoveryPoint[]
  count?: number
}

/** What `fixtures/e2e/preview-seed/legacy-v3.json` holds: the records the adapter writes. */
export interface PreviewSeed {
  dbName: string
  source: string
  projects: ProjectRecord[]
  library: LibraryRecord[]
  assets: PreviewSeedAsset[]
  recovery?: PreviewSeedRecovery[]
}

/** Write the seed before every navigation of this page, including reloads. */
export async function seedPreviewDb(page: Page, seed: PreviewSeed): Promise<void> {
  await page.addInitScript(writeSeed, seed)
}

/**
 * Make the seed the database's contents on a page that has already loaded.
 *
 * The seed can only be written from an init script, and an init script runs at navigation — so the
 * database is deleted after registering it, and the reload is what writes it. Seeding an existing
 * database would write nothing, because the seeder only fills a database it has to create.
 *
 * `reseedAndReload` in `libraryApp.ts` is this plus the wait for the Library heading, which is only
 * the right wait on a page that opens on the Library.
 */
export async function reseedPreviewDb(page: Page, seed: PreviewSeed): Promise<void> {
  await seedPreviewDb(page, seed)
  await page.evaluate(
    // The executor form rather than `Promise.withResolvers`: the e2e tsconfig targets es2023.
    (dbName) =>
      new Promise<void>((resolveDelete, rejectDelete) => {
        const request = indexedDB.deleteDatabase(dbName)
        request.onsuccess = () => resolveDelete()
        request.onerror = () => rejectDelete(new Error(`deleting ${dbName} failed`))
        request.onblocked = () => rejectDelete(new Error(`deleting ${dbName} was blocked`))
      }),
    E2E_DB_NAME,
  )
  await page.reload({ waitUntil: 'networkidle' })
}

/**
 * Runs in the page. Playwright awaits the returned promise before it lets the document load,
 * which is the whole reason this is one transaction: a half-written database would render a
 * scene that no real save could produce.
 */
function writeSeed(seed: PreviewSeed): Promise<void> {
  return new Promise((resolveSeed, rejectSeed) => {
    const request = indexedDB.open(seed.dbName, 1)

    // The records go in with the version-change transaction rather than after the open: this
    // runs as an init script, so it also runs on the reload a spec performs — and re-putting
    // the seed there would overwrite the very edit the reload is meant to find.
    request.onupgradeneeded = () => {
      const db = request.result
      const version = request.transaction
      if (version === null) {
        rejectSeed(new Error(`no version-change transaction while creating ${seed.dbName}`))
        return
      }
      db.createObjectStore('projects', { keyPath: 'id' })
      const library = db.createObjectStore('library', { keyPath: 'id' })
      library.createIndex('savedAt', 'savedAt')
      library.createIndex('trashedAt', 'trashedAt')
      const assets = db.createObjectStore('assets', { keyPath: 'sha256' })
      assets.createIndex('storedAt', 'storedAt')
      const recovery = db.createObjectStore('recoveryPoints', { keyPath: 'id' })
      recovery.createIndex('projectId', 'projectId')
      recovery.createIndex('projectCreatedAt', ['projectId', 'createdAt'])
      db.createObjectStore('meta', { keyPath: 'key' })
      db.createObjectStore('prefs', { keyPath: 'key' })

      version.oncomplete = () => {
        db.close()
        resolveSeed()
      }
      version.onabort = () => rejectSeed(new Error(`seeding ${seed.dbName} aborted: ${version.error?.message}`))

      for (const record of seed.projects) version.objectStore('projects').put(record)
      for (const record of seed.library) version.objectStore('library').put(record)
      for (const asset of seed.assets) {
        const { base64, ...record } = asset
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
        version.objectStore('assets').put({ ...record, blob: new Blob([bytes], { type: record.mediaType }) })
      }
      for (const group of seed.recovery ?? []) {
        const project = seed.projects.find((record) => record.id === group.projectId)
        const row = seed.library.find((record) => record.id === group.projectId)
        if (project === undefined || row === undefined) throw new Error(`no Project ${group.projectId} to recover`)
        for (const point of group.points ?? []) {
          version.objectStore('recoveryPoints').put({
            id: point.id,
            projectId: group.projectId,
            createdAt: point.createdAt,
            kind: point.kind,
            revision: row.revision,
            schemaVersion: row.schemaVersion,
            summary: point.summary ?? row.summary,
            data: project.data,
          })
        }
        for (let index = 0; index < (group.count ?? 0); index += 1) {
          // One minute apart, working back from the Project's own save: `recovery.list` sorts by
          // `createdAt`, and a list of Points all stamped the same second has no order to show.
          const createdAt = new Date(Date.parse(row.savedAt) - (index + 1) * 60_000).toISOString()
          version.objectStore('recoveryPoints').put({
            id: `${group.projectId}-rp-${index + 1}`,
            projectId: group.projectId,
            createdAt,
            kind: 'idle',
            revision: Math.max(0, row.revision - index),
            schemaVersion: row.schemaVersion,
            summary: row.summary,
            data: project.data,
          })
        }
      }
    }
    request.onerror = () => rejectSeed(new Error(`opening ${seed.dbName} failed: ${request.error?.message}`))

    request.onsuccess = () => {
      // The database already exists, which means it already holds the seed and whatever the
      // spec has saved on top of it since.
      request.result.close()
      resolveSeed()
    }
  })
}

/** Every database this browser context holds, so a spec can assert nothing else was opened. */
export async function databaseNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases()
    return databases.map((database) => database.name ?? '')
  })
}

/**
 * The revision stored for one Project: the proof a write has landed, which a spec needs before
 * it can say anything about what did *not* change elsewhere.
 */
export async function projectRevision(page: Page, projectId: string): Promise<number> {
  return page.evaluate(
    ([dbName, id]) =>
      new Promise<number>((resolveRevision, rejectRevision) => {
        const open = indexedDB.open(dbName, 1)
        open.onerror = () => rejectRevision(new Error(`opening ${dbName} failed`))
        open.onsuccess = () => {
          const db = open.result
          const read = db.transaction('projects', 'readonly').objectStore('projects').get(id)
          read.onsuccess = () => {
            db.close()
            const record = read.result as { revision?: number } | undefined
            resolveRevision(record?.revision ?? 0)
          }
          read.onerror = () => rejectRevision(new Error(`reading ${id} failed`))
        }
      }),
    [E2E_DB_NAME, projectId],
  )
}
