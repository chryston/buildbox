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

    request.onupgradeneeded = () => {
      const db = request.result
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
    }
    request.onerror = () => rejectSeed(new Error(`opening ${seed.dbName} failed: ${request.error?.message}`))

    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(['projects', 'library', 'assets'], 'readwrite')
      tx.oncomplete = () => {
        db.close()
        resolveSeed()
      }
      tx.onabort = () => rejectSeed(new Error(`seeding ${seed.dbName} aborted: ${tx.error?.message}`))

      for (const record of seed.projects) tx.objectStore('projects').put(record)
      for (const record of seed.library) tx.objectStore('library').put(record)
      for (const asset of seed.assets) {
        const { base64, ...record } = asset
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
        tx.objectStore('assets').put({ ...record, blob: new Blob([bytes], { type: record.mediaType }) })
      }
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
