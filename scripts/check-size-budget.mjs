// App-shell size budget (#35, #20 §12).
//
// The app shell is every JS and CSS file dist/index.html loads eagerly: module
// scripts, modulepreload links and stylesheets. Lazily imported chunks are not
// part of it, so they never count against the budget.
//
//   node scripts/check-size-budget.mjs            check against size-budget.json
//   node scripts/check-size-budget.mjs --record   re-record the baseline
//
// The budget is the recorded baseline plus maxGrowth. Growing it is a decision,
// not a side effect of a build, so --record is deliberately not part of any script.
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIST = path.join(ROOT, 'dist')
const BUDGET_FILE = path.join(ROOT, 'size-budget.json')
const NOTE = 'S0 baseline, #20 §12. Do not re-record without an explicit decision.'

const REF_PATTERNS = [
  /<script[^>]+\btype="module"[^>]+\bsrc="([^"]+)"/g,
  /<link[^>]+\brel="modulepreload"[^>]+\bhref="([^"]+)"/g,
  /<link[^>]+\brel="stylesheet"[^>]+\bhref="([^"]+)"/g,
]

function shellRefs(indexHtml) {
  const refs = new Set()
  for (const pattern of REF_PATTERNS) {
    for (const match of indexHtml.matchAll(pattern)) refs.add(match[1])
  }
  return [...refs]
}

// Refs are emitted with the Vite `base` prefix (/buildbox/), which is not part of
// the dist layout, so try the path as written and then with its first segment cut.
function shellFile(ref) {
  const pathname = new URL(ref, 'http://localhost/').pathname
  const segments = pathname.split('/').filter(Boolean)
  for (const start of [0, 1]) {
    const candidate = path.join(DIST, ...segments.slice(start))
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  throw new Error(`dist/index.html references ${ref}, which is not in dist/`)
}

function appShellFiles() {
  const indexPath = path.join(DIST, 'index.html')
  if (!existsSync(indexPath)) throw new Error('dist/index.html not found — run `npm run build` first')
  const files = shellRefs(readFileSync(indexPath, 'utf8'))
    .map(shellFile)
    .filter((file) => ['.js', '.css'].includes(path.extname(file)))
  if (files.length === 0) throw new Error('dist/index.html references no JS or CSS — the app shell is empty')
  return files
}

function appShellGzipBytes(files) {
  return files.reduce((total, file) => total + gzipOf(file), 0)
}

// The export chunk (#61 §11): `pdf-lib`, `@pdf-lib/fontkit` and the subset face are named one
// lazy chunk in `vite.config.ts`. Two things are checked about it — that it is a chunk of its own
// and small enough, and that none of it leaked into what a first visit downloads. The second is
// the one that matters: a single accidental static import of `export` from the workspace would
// fold a megabyte into the app shell, the shell budget would still pass on a day when it happens
// to fit, and every reader would pay for a feature they never opened.
const EXPORT_CHUNK = /^export-[A-Za-z0-9_-]+\.js$/
const EXPORT_MARKERS = [
  // A string literal pdf-lib writes into every document it produces, and one fontkit reads out of
  // a font's `name` table. Both survive minification because both are data, not identifiers.
  'pdf-lib (https://github.com/Hopding/pdf-lib)',
  'BaseFontName',
  // The subset face the PDF embeds, by emitted asset name. It is a pattern and not a literal
  // because Vite hashes the file name, and it is `.ttf` specifically: the interface has always
  // shipped a `NotoSans-Latin1` *woff2* from the app shell's CSS, and that one is not the export.
  /NotoSans-Latin1-[A-Za-z0-9_-]+\.ttf/,
]

function exportChunkFiles() {
  const assets = path.join(DIST, 'assets')
  if (!existsSync(assets)) return []
  return readdirSync(assets).filter((name) => EXPORT_CHUNK.test(name)).map((name) => path.join(assets, name))
}

function gzipOf(file) {
  return gzipSync(readFileSync(file), { level: 9 }).length
}

function checkExportChunk(shellFiles, cap) {
  const chunks = exportChunkFiles()
  if (chunks.length === 0) {
    console.error('no `export-*.js` chunk in dist/assets: the export is not a chunk of its own (#61 §11)')
    process.exit(1)
  }
  const bytes = chunks.reduce((total, file) => total + gzipOf(file), 0)
  const eager = shellFiles.filter((file) => chunks.includes(file))
  console.log(`export chunk: ${bytes} B gzip (cap ${cap}) across ${chunks.length} file(s)`)
  if (eager.length > 0) {
    console.error(`the export chunk is loaded eagerly by dist/index.html (#61 §11): ${eager.map((f) => path.basename(f)).join(', ')}`)
    process.exit(1)
  }
  if (bytes > cap) {
    console.error(`over budget: the export chunk is ${bytes - cap} B above its ${cap} B cap (#61 §11)`)
    process.exit(1)
  }
  for (const file of shellFiles) {
    const text = readFileSync(file, 'utf8')
    for (const marker of EXPORT_MARKERS) {
      const found = typeof marker === 'string' ? text.includes(marker) : marker.test(text)
      if (!found) continue
      const name = typeof marker === 'string' ? `\`${marker}\`` : marker.source
      console.error(`${path.basename(file)} contains ${name}: the export reached the app shell (#61 §11)`)
      process.exit(1)
    }
  }
}

// Every app chunk the build emitted, eager or lazy. Since #53 the editor is a dynamic import,
// so the budgeted shell is only what a first visit loads before it paints; this number is the
// whole app, printed for context and gating nothing.
function allChunksGzipBytes() {
  const assets = path.join(DIST, 'assets')
  if (!existsSync(assets)) return 0
  return readdirSync(assets)
    .filter((name) => ['.js', '.css'].includes(path.extname(name)))
    .reduce((total, name) => total + gzipSync(readFileSync(path.join(assets, name)), { level: 9 }).length, 0)
}

// The commit the recorded build came from, read straight from .git so the script
// stays free of child processes and dependencies. Handles a linked worktree, whose
// refs live in the common git dir.
function currentCommit(startDir) {
  const gitDir = findGitDir(startDir)
  if (!gitDir) return 'unknown'
  const headPath = path.join(gitDir, 'HEAD')
  if (!existsSync(headPath)) return 'unknown'
  const head = readFileSync(headPath, 'utf8').trim()
  if (!head.startsWith('ref:')) return head
  const ref = head.slice(4).trim()
  const searchDirs = [gitDir]
  const commonDir = path.join(gitDir, 'commondir')
  if (existsSync(commonDir)) searchDirs.push(path.resolve(gitDir, readFileSync(commonDir, 'utf8').trim()))
  for (const dir of searchDirs) {
    const refPath = path.join(dir, ref)
    if (existsSync(refPath)) return readFileSync(refPath, 'utf8').trim()
  }
  return 'unknown'
}

function findGitDir(startDir) {
  for (let dir = startDir; ; dir = path.dirname(dir)) {
    const dotGit = path.join(dir, '.git')
    if (existsSync(dotGit)) {
      if (!statSync(dotGit).isFile()) return dotGit
      const pointer = readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/m)
      return pointer ? path.resolve(dir, pointer[1].trim()) : null
    }
    if (path.dirname(dir) === dir) return null
  }
}

const shellFiles = appShellFiles()
const bytes = appShellGzipBytes(shellFiles)

if (process.argv.includes('--record')) {
  const budget = {
    appShellGzipBytes: bytes,
    maxGrowth: 0.15,
    exportChunkGzipBytes: JSON.parse(readFileSync(BUDGET_FILE, 'utf8')).exportChunkGzipBytes ?? 700000,
    baselineCommit: currentCommit(ROOT),
    note: NOTE,
  }
  writeFileSync(BUDGET_FILE, `${JSON.stringify(budget, null, 2)}\n`)
  console.log(`recorded app shell: ${bytes} B gzip at ${budget.baselineCommit} -> size-budget.json`)
  process.exit(0)
}

if (!existsSync(BUDGET_FILE)) throw new Error('size-budget.json not found — record one with `node scripts/check-size-budget.mjs --record`')
const { appShellGzipBytes: baseline, maxGrowth, exportChunkGzipBytes: exportCap } = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'))
const limit = Math.floor(baseline * (1 + maxGrowth))
console.log(`app shell: ${bytes} B gzip (baseline ${baseline}, limit ${limit})`)
console.log(`all app chunks: ${allChunksGzipBytes()} B gzip (informational; the budget gates the eager shell only)`)
checkExportChunk(shellFiles, exportCap)
if (bytes > limit) {
  const growth = (((bytes - baseline) / baseline) * 100).toFixed(1)
  console.error(`over budget: app shell is ${bytes - baseline} B (+${growth}%) above the S0 baseline; limit is ${limit} B (#20 §12). Shrink the app shell or record a new baseline with an explicit decision.`)
  process.exit(1)
}
