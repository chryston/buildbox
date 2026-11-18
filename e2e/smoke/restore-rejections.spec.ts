import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { PACKAGE_LIMITS } from '../../src/package'
import { unzipEntries, zipEntries, type ZipLimits } from '../../src/lib'
import {
  dialogHeading,
  openLibrary,
  previewSeed,
  restoreFile,
  storeFingerprint,
  type BackupFile,
} from '../support/libraryApp'

/**
 * Everything a Restore refuses, and the fact that it refused without touching anything
 * (#50 criteria 19–20).
 *
 * The dialog is the easy half. The half that matters is `storeFingerprint`: a rejection that
 * left a half-written Project, an orphaned asset or a bumped revision behind would still show
 * the right sentence, and the user would only find out on the next reload. So every case here
 * takes the fingerprint of all four stores first and demands the identical string afterwards.
 *
 * The inputs are the same shapes #44 rejects in `src/package/import.test.ts`, built here with
 * the same two primitives — `zipEntries` to write an archive, `unzipEntries` to take a real one
 * apart — because the point of the pair is that a hostile archive is an ordinary archive with
 * one thing changed, and the golden fixture is the most ordinary one there is.
 */

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const reference = readFileSync(join(fixturesRoot, 'package', 'v1', 'reference.buildbox'))

/** Generous read limits: this is about writing an archive, not about surviving one. */
const WRITE_LIMITS: ZipLimits = {
  maxEntries: PACKAGE_LIMITS.maxEntries,
  maxEntryBytes: PACKAGE_LIMITS.maxEntryBytes,
  maxTotalBytes: PACKAGE_LIMITS.maxTotalBytes,
  maxRatio: 1_000_000,
  ratioFloorBytes: Number.MAX_SAFE_INTEGER,
}

const bytesOf = (value: string): Uint8Array => new TextEncoder().encode(value)

interface Part {
  name: string
  data: Uint8Array
}

function partsOf(archive: Uint8Array): Part[] {
  const read = unzipEntries(archive, WRITE_LIMITS)
  if (!read.ok) throw new Error(`the golden fixture must be readable: ${read.failure.code}`)
  return read.entries.map((entry) => ({ name: entry.name, data: entry.data }))
}

/** The golden archive with its manifest rewritten. */
function withManifest(edit: (manifest: Record<string, unknown>) => void): Uint8Array {
  const parts = partsOf(reference)
  const manifest = parts.find((part) => part.name === 'manifest.json')
  if (manifest === undefined) throw new Error('the golden fixture carries no manifest')
  const json = JSON.parse(new TextDecoder().decode(manifest.data)) as Record<string, unknown>
  edit(json)
  return zipEntries(
    parts.map((part) => (part.name === 'manifest.json' ? { name: part.name, data: bytesOf(JSON.stringify(json)) } : part)),
  )
}

/**
 * Every case, with the heading its dialog has to show.
 *
 * Two headings only: #19 fixes one sentence word for word for the inputs that are BuildBox's
 * own exports — a user holding one of those needs to be told the file is fine, it is just not a
 * Backup — and everything else, from a truncated archive to a Backup written by a future build,
 * is one of the generic refusals. Which check failed is a detail; that nothing changed is not.
 */
const EXPORT_HEADING = 'This is an export, not a BuildBox Backup'
const NEWER_HEADING = 'This Backup was saved by a newer BuildBox'
const GENERIC_HEADING = "This file can't be restored"

const cases: { name: string; file: () => BackupFile; heading: string }[] = [
  {
    name: 'an export ZIP',
    file: () => ({ name: 'quote.buildbox', buffer: Buffer.from(withManifest((m) => { m.format = 'buildbox-export' })) }),
    heading: EXPORT_HEADING,
  },
  {
    name: 'a loose CSV',
    file: () => ({ name: 'schedule.csv', buffer: Buffer.from('item,width,height\nbase,600,850\n') }),
    heading: EXPORT_HEADING,
  },
  {
    name: 'a loose PDF',
    file: () => ({ name: 'drawing.pdf', buffer: Buffer.from('%PDF-1.7\n%BuildBox\n') }),
    heading: EXPORT_HEADING,
  },
  {
    name: 'a loose SVG',
    file: () => ({ name: 'plan.svg', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>\n') }),
    heading: EXPORT_HEADING,
  },
  {
    name: 'a loose PNG',
    file: () => ({
      name: 'render.png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
    }),
    heading: EXPORT_HEADING,
  },
  {
    // A ZIP signature and nothing behind it: the archive is damaged rather than foreign, which
    // is the distinction `classifyNonZip` draws and the reason this one is not the export copy.
    name: 'a corrupt archive',
    file: () => ({
      name: 'broken.buildbox',
      buffer: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('not an archive at all'.repeat(8))]),
    }),
    heading: GENERIC_HEADING,
  },
  {
    name: 'a path-traversal entry',
    file: () => ({
      name: 'traversal.buildbox',
      buffer: Buffer.from(zipEntries([...partsOf(reference), { name: '../../escape.json', data: bytesOf('{}') }])),
    }),
    heading: GENERIC_HEADING,
  },
  {
    // The manifest still describes the bytes it shipped with, so the entry that changed is the
    // one whose hash no longer matches — the archive is well-formed and lying.
    name: 'a wrong-hash entry',
    file: () => {
      const parts = partsOf(reference)
      return {
        name: 'tampered.buildbox',
        buffer: Buffer.from(
          zipEntries(parts.map((part) => (part.name === 'project.json' ? { ...part, data: bytesOf('{"id":"other"}') } : part))),
        ),
      }
    },
    heading: GENERIC_HEADING,
  },
  {
    name: 'a newer package version',
    file: () => ({
      name: 'future.buildbox',
      buffer: Buffer.from(withManifest((m) => { m.packageVersion = 99 })),
    }),
    heading: NEWER_HEADING,
  },
]

for (const one of cases) {
  test(`refuses ${one.name} and changes nothing`, async ({ page }) => {
    await openLibrary(page, previewSeed)
    const before = await storeFingerprint(page)

    await restoreFile(page, one.file())
    await expect(dialogHeading(page)).toHaveText(one.heading)
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    expect(await storeFingerprint(page)).toBe(before)
    expect(await page.evaluate(() => document.querySelectorAll('article.project-card').length)).toBe(2)
  })
}

/**
 * The oversized case, on its own because it cannot be handed over as bytes.
 *
 * `maxInputBytes` is 250 MB, so a Buffer built here would have to cross the DevTools protocol
 * twice — once into Playwright's temp file and once into the page — to prove a check that fires
 * on `bytes.length` alone. Building the File inside the page with `DataTransfer` says the same
 * thing about the app's behaviour for a fraction of the memory, and the app cannot tell the two
 * apart: it sees one `File` on one `change` event either way.
 */
test('refuses a file over the input limit and changes nothing', async ({ page }) => {
  await openLibrary(page, previewSeed)
  const before = await storeFingerprint(page)

  await pickInPage(page, 'huge.buildbox', PACKAGE_LIMITS.maxInputBytes + 1)
  await expect(dialogHeading(page)).toHaveText(GENERIC_HEADING)
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  expect(await storeFingerprint(page)).toBe(before)
})

/** Put a File of `size` bytes on the app's file input, from inside the page. */
async function pickInPage(page: Page, name: string, size: number): Promise<void> {
  await page.evaluate(({ fileName, byteLength }) => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (input === null) throw new Error('the Library rendered no file input')
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(byteLength)], fileName, { type: 'application/zip' }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, { fileName: name, byteLength: size })
}

