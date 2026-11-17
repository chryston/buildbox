import type { Page } from '@playwright/test'
import type { AssetRecord, LibraryRecord, ProjectRecord } from '../../src/persistence'

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

/** The database only the flagged build opens (#20 §11). */
export const PREVIEW_DB_NAME = 'buildbox-preview'

/** One stored asset, with its bytes base64-encoded because JSON cannot hold a Blob. */
export interface PreviewSeedAsset extends AssetRecord {
  base64: string
}

/** What `fixtures/e2e/preview-seed/legacy-v3.json` holds: the records the adapter writes. */
export interface PreviewSeed {
  dbName: string
  source: string
  projects: ProjectRecord[]
  library: LibraryRecord[]
  assets: PreviewSeedAsset[]
}

/** Write the seed before every navigation of this page, including reloads. */
export async function seedPreviewDb(page: Page, seed: PreviewSeed): Promise<void> {
  await page.addInitScript(writeSeed, seed)
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
    [PREVIEW_DB_NAME, projectId],
  )
}
