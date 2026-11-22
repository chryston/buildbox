// #53 criterion 2: the removed export paths must be gone from what ships, not merely from
// `src/`. Three strings prove which release this bundle is from: the workspace-JSON filename
// the old `Export` wrote, the floor-plan-JSON filename its sibling wrote, and the flag that
// used to choose between the two apps. None of them has a producer any more.
//
// `buildbox-store` is deliberately NOT on this list: reading the old key is the Migration
// review's job until #86, and `package/legacy` and `platform/legacySource` are allowed to name
// it. `buildbox-preview` is not either — the preview channel (#20 §11) is a mechanism this
// build still carries, and it is named by whichever flag is set, not by a flag of its own.
//
// Run as part of `npm run build`, after `vite build`.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import process from 'node:process'

const outDir = process.argv[2] ?? 'dist'
// `floor-plan.svg` is the file name the removed `Export SVG` button produced (#61 criterion 8).
// It is forbidden here so the old path cannot come back as a helper nobody thought to delete.
const FORBIDDEN = [
  '.buildbox.json',
  '-floor-plan.json',
  'floor-plan.svg',
  'VITE_FF_PROJECTS_V2',
  '__PROJECTS_V2__',
  // #69 criterion 13: the renovation Intents are registered from one module, and that module is
  // reachable only through `FF_RENOVATION`. A flag-off build that still carries the marker string
  // has shipped the renovation catalogue to production, which is the thing the flag exists to
  // prevent. A flagged build is allowed to carry it, so the check is skipped when the flag is on.
  ...(process.env['VITE_FF_RENOVATION'] === 'true' ? [] : ['__renovation_intents__']),
  // The same rule for the words: the renovation dialogs and the `Design Options` settings section
  // are dark, so a flag-off bundle that still carries their copy has shipped a surface nobody can
  // open. Two sentences prove it — one the delete review says, one the move review asks.
  ...(process.env['VITE_FF_RENOVATION'] === 'true'
    ? []
    : ['Nothing in the Existing Model changes.', 'Move to a Design Option']),
]
// Only the files that could contain application code: an image or a font cannot.
const SCANNED = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg', '.txt', '.map'])

if (!existsSync(outDir)) {
  console.error(`${outDir} not found — run \`vite build\` first`)
  process.exit(1)
}

function* textFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* textFiles(path)
    else if (SCANNED.has(extname(entry.name))) yield path
  }
}

const found = []
let scanned = 0
for (const file of textFiles(outDir)) {
  scanned += 1
  const text = readFileSync(file, 'utf8')
  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) found.push(`${relative('.', file)} contains "${needle}"`)
  }
}

if (found.length > 0) {
  console.error(`${outDir} still ships a removed export path (${scanned} files scanned):`)
  for (const problem of found) console.error(`  ${problem}`)
  console.error('Download Backup replaced the workspace and floor-plan JSON exports at S4 (#19 §10).')
  process.exit(1)
}

console.log(`${outDir}: no removed export strings (${scanned} files scanned)`)
