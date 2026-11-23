#!/usr/bin/env node
// Screenshot baselines are container pixels (#39, #20 §9.5). Playwright runs inside the
// pinned mcr.microsoft.com/playwright image so a baseline committed on one machine is
// comparable on every other one, and the image tag is read from package.json so the two
// can never drift.
//
//   npm run test:screenshots                    check the committed baselines
//   npm run test:screenshots -- --update        rewrite them (see e2e/README.md)
//   npm run test:screenshots -- --grep floor    any other arg goes to playwright
//
// Two jobs, in order:
//   1. stage the prototype sources the specs ask for into .prototype-cache/ (gitignored).
//      The container has no git history, so the helper reads extracted files instead.
//   2. run Playwright in the container. A named volume holds the Linux node_modules so the
//      install never lands in the host tree.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheRoot = join(repoRoot, '.prototype-cache')
const CONFIG = 'playwright.screenshots.config.ts'
const NODE_MODULES_VOLUME = 'buildbox-pw-node-modules'

/** The exact `@playwright/test` version, which is also the container tag (#39 §1). */
function playwrightVersion() {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const version = pkg.devDependencies?.['@playwright/test'] ?? pkg.dependencies?.['@playwright/test']
  if (!version) fail('package.json has no @playwright/test dependency.')
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail(`@playwright/test must be pinned exactly to run in the matching container, got "${version}".`)
  }
  return version
}

function fail(message) {
  console.error(`run-screenshots: ${message}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'buffer', maxBuffer: 512 << 20, ...options })
  if (result.error?.code === 'ENOENT') fail(`${command} is not installed.`)
  return result
}

function runOrFail(label, command, args, options = {}) {
  const result = run(command, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) fail(`${label} failed (exit ${result.status ?? result.error?.message}).`)
  return result
}

/** Same, but the bytes are the point: `git archive` and `git show` feed the cache. */
function captureOrFail(label, command, args) {
  const result = run(command, args)
  if (result.status !== 0) fail(`${label} failed (exit ${result.status ?? result.error?.message}).`)
  return result.stdout
}

// --- 1. stage the prototype sources the specs request -------------------------------------

function tsFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return tsFiles(full)
    return entry.endsWith('.ts') ? [full] : []
  })
}

/** The object literal around `index`, so sibling fields of a `commit:` are readable. */
function enclosingObjectLiteral(source, index) {
  let depth = 0
  let start = index
  for (; start >= 0; start--) {
    const char = source[start]
    if (char === '}') depth += 1
    else if (char === '{' && depth === 0) break
    else if (char === '{') depth -= 1
  }
  depth = 0
  let end = start
  for (; end < source.length; end += 1) {
    const char = source[end]
    if (char === '{') depth += 1
    else if (char === '}' && (depth -= 1) === 0) break
  }
  return source.slice(start, end + 1)
}

function stringField(literal, field) {
  return new RegExp(`${field}:\\s*['"\`]([^'"\`]+)['"\`]`).exec(literal)?.[1]
}

/**
 * Every `PrototypeSource` the specs declare, found by reading the specs. A source is one
 * object literal with a `commit:` and either a `dir:` (static archive) or a `path:`
 * (reference PNG), so the request list can never drift from what the specs render.
 */
function prototypeRequests() {
  const requests = new Map()
  for (const file of tsFiles(join(repoRoot, 'e2e'))) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/commit:\s*['"`]([0-9a-f]{7,40})['"`]/g)) {
      const literal = enclosingObjectLiteral(source, match.index)
      const request = { commit: match[1], dir: stringField(literal, 'dir'), path: stringField(literal, 'path') }
      if (!request.dir && !request.path) {
        fail(`${relative(repoRoot, file)} declares commit ${request.commit} with no \`dir\` or \`path\` to stage.`)
      }
      requests.set(`${request.commit} ${request.dir ?? ''} ${request.path ?? ''}`, request)
    }
  }
  return [...requests.values()]
}

function ensureCommit(commit) {
  if (run('git', ['cat-file', '-e', `${commit}^{commit}`]).status === 0) return
  // fetch-depth: 0 in CI makes this a no-op; it covers shallow clones and forks (#39 §3).
  runOrFail(`git fetch origin ${commit}`, 'git', ['fetch', '--no-tags', 'origin', commit])
}

function stage(request) {
  const commitDir = join(cacheRoot, request.commit)
  if (request.dir) {
    const target = join(commitDir, request.dir)
    if (!existsSync(target)) {
      ensureCommit(request.commit)
      mkdirSync(target, { recursive: true })
      const archive = captureOrFail('git archive', 'git', ['archive', request.commit, request.dir])
      // stdin must be a pipe for `input` to reach tar; the rest stays on the terminal.
      runOrFail('tar', 'tar', ['-x', '-C', commitDir], { input: archive, stdio: ['pipe', 'inherit', 'inherit'] })
      console.log(`run-screenshots: staged ${relative(repoRoot, target)}/`)
    }
  }
  if (request.path) {
    const target = join(commitDir, request.path)
    if (!existsSync(target)) {
      ensureCommit(request.commit)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, captureOrFail(`git show ${request.commit}:${request.path}`, 'git', [
        'show',
        `${request.commit}:${request.path}`,
      ]))
      console.log(`run-screenshots: staged ${relative(repoRoot, target)}`)
    }
  }
}

// --- 2. run Playwright in the pinned container --------------------------------------------

const argv = process.argv.slice(2)
const update = argv.includes('--update')
const passthrough = argv.filter((arg) => arg !== '--update')
const snapshots = 'e2e/screenshots/__snapshots__'

const version = playwrightVersion()
const image = `mcr.microsoft.com/playwright:v${version}-noble`

for (const request of prototypeRequests()) stage(request)

// `bash -lc` so the whole chain is one shell command; the exit code is captured before the
// chown so a red run stays red. The container writes baselines, its build and artifacts into
// the bind mount as root, so hand them back to the calling user before it exits — a root-owned
// dist/ makes the next host `vite build` fail to empty the output directory.
const shellQuote = (arg) => `'${arg.replaceAll(`'`, `'\\''`)}'`
const test = `npx playwright test -c ${CONFIG}${passthrough.map((arg) => ` ${shellQuote(arg)}`).join('')}${
  update ? ' --update-snapshots' : ''
}`
const handBack =
  `for p in ${snapshots} test-results playwright-report dist; do ` +
  `[ -e "/work/$p" ] && chown -R ${process.getuid()}:${process.getgid()} "/work/$p"; done; true`
// One artifact since #53: Local Projects is the app, so every scene photographs `dist/`.
const inner = `npm ci && npm run build && ${test}; rc=$?; ${handBack}; exit $rc`

console.log(`run-screenshots: ${image} (${update ? 'updating' : 'checking'} baselines)`)
const docker = runOrFail(
  'docker',
  'docker',
  [
    'run',
    '--rm',
    '--ipc=host',
    '-v',
    `${repoRoot}:/work`,
    '-v',
    `${NODE_MODULES_VOLUME}:/work/node_modules`,
    '-w',
    '/work',
    image,
    'bash',
    '-lc',
    inner,
  ],
)
process.exit(docker.status ?? 1)
