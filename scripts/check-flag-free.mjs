// #49 criterion 6: the preview app is a build-time choice, so a production bundle must not
// carry it at all — not merely fail to run it. Two strings prove which build this is: the
// preview database's name, and the sentinel `src/app/projectsV2.tsx` sets when it mounts.
//
// Run as part of `npm run build`, after `vite build`. A build made *with* the flag on is the
// opposite case and has nothing to check, so it says so and passes.
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const outDir = process.argv[2] ?? 'dist'
const FORBIDDEN = ['buildbox-preview', '__PROJECTS_V2__']
// Only the files that could contain application code: an image or a font cannot.
const SCANNED = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg', '.txt', '.map'])

if (process.env.VITE_FF_PROJECTS_V2 === 'true') {
  console.log(`${outDir}: built with VITE_FF_PROJECTS_V2, nothing to prove`)
  process.exit(0)
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
  console.error(`${outDir} is not flag-free (${scanned} files scanned):`)
  for (const problem of found) console.error(`  ${problem}`)
  console.error('The preview app must fold away entirely when VITE_FF_PROJECTS_V2 is unset.')
  process.exit(1)
}

console.log(`${outDir}: flag-free (${scanned} files scanned)`)
