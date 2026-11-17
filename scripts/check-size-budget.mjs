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
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
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

function appShellGzipBytes() {
  const indexPath = path.join(DIST, 'index.html')
  if (!existsSync(indexPath)) throw new Error('dist/index.html not found — run `npm run build` first')
  const files = shellRefs(readFileSync(indexPath, 'utf8'))
    .map(shellFile)
    .filter((file) => ['.js', '.css'].includes(path.extname(file)))
  if (files.length === 0) throw new Error('dist/index.html references no JS or CSS — the app shell is empty')
  return files.reduce((total, file) => total + gzipSync(readFileSync(file), { level: 9 }).length, 0)
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

const bytes = appShellGzipBytes()

if (process.argv.includes('--record')) {
  const budget = { appShellGzipBytes: bytes, maxGrowth: 0.15, baselineCommit: currentCommit(ROOT), note: NOTE }
  writeFileSync(BUDGET_FILE, `${JSON.stringify(budget, null, 2)}\n`)
  console.log(`recorded app shell: ${bytes} B gzip at ${budget.baselineCommit} -> size-budget.json`)
  process.exit(0)
}

if (!existsSync(BUDGET_FILE)) throw new Error('size-budget.json not found — record one with `node scripts/check-size-budget.mjs --record`')
const { appShellGzipBytes: baseline, maxGrowth } = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'))
const limit = Math.floor(baseline * (1 + maxGrowth))
console.log(`app shell: ${bytes} B gzip (baseline ${baseline}, limit ${limit})`)
if (bytes > limit) {
  const growth = (((bytes - baseline) / baseline) * 100).toFixed(1)
  console.error(`over budget: app shell is ${bytes - baseline} B (+${growth}%) above the S0 baseline; limit is ${limit} B (#20 §12). Shrink the app shell or record a new baseline with an explicit decision.`)
  process.exit(1)
}
