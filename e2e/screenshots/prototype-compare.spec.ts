import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '../support/fixtures'
import { compareWithPrototype } from '../support/prototypeCompare'
import {
  LIBRARY_28,
  importCollision,
  library,
  migrationReview,
  permanentDelete,
  recoveryPoint,
  saveFailure,
} from '../support/prototypes/library28'

// The comparison infrastructure the Project Library issues build on (#39 §3, #21): every
// required #28 state rendered from the published archive at 1440x1000, plus one reference
// PNG, so both helper modes are proven by this spec. Nothing here is baselined — these are
// review artifacts, attached to the run and uploaded as the `screenshots` CI artifact.

const libraryStates = [
  {
    name: 'library-28-library',
    prepare: library,
    // Review-only until the Library exists in production (#28): today's app is the right
    // thing to put next to it, not a baseline of it.
    production: { route: './' },
  },
  { name: 'library-28-save-failure', prepare: saveFailure },
  { name: 'library-28-import-collision', prepare: importCollision },
  { name: 'library-28-recovery-point', prepare: recoveryPoint },
  { name: 'library-28-migration-review', prepare: migrationReview },
  { name: 'library-28-permanent-delete', prepare: permanentDelete },
]

for (const state of libraryStates) {
  test(`#28 ${state.name}`, async ({ page }, testInfo) => {
    await compareWithPrototype(page, testInfo, {
      name: state.name,
      prototype: { kind: 'static-archive', ...LIBRARY_28, prepare: state.prepare },
      ...(state.production ? { production: state.production } : {}),
    })
  })
}

test('#30 reference PNG mode', async ({ page }, testInfo) => {
  await compareWithPrototype(page, testInfo, {
    name: 'odd-shape-30-a-preset',
    prototype: { kind: 'reference-png', commit: 'cadf2d5', path: 'prototype-screenshots/A-preset.png' },
  })
})

// Every prototype commit #39 names, so a capture that leaked one of them into a baseline
// is recognisable by name alone.
const PROTOTYPE_COMMITS = ['817e929', '8787ba4', '62b24c2', 'cadf2d5', 'abdc3cd', 'e272386']

const pngs = (dir: string, prefix = ''): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? pngs(join(dir, entry.name), `${prefix}${entry.name}/`)
          : [`${prefix}${entry.name}`],
      )
    : []

test('prototypes are compared, never baselined', () => {
  const snapshotRoot = resolve('e2e/screenshots/__snapshots__')
  const offenders = pngs(snapshotRoot).filter(
    (file) =>
      // `prototype…` catches both a capture named for a prototype and the compare spec's
      // own snapshot folder; a bare commit SHA or any long hex run is a capture id.
      /(^|\/)prototype/i.test(file) ||
      PROTOTYPE_COMMITS.some((commit) => file.includes(commit)) ||
      /[0-9a-f]{7,}/.test(file),
  )
  expect(offenders, 'a prototype capture must never land in __snapshots__ (#39 §3)').toEqual([])
})
