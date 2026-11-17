import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import { waitForFonts } from './stability'

/**
 * A prototype to compare production against (#39 §3). Two modes, because later prototype
 * tickets ship one of two things: a built static archive, or committed screenshots.
 *
 * `dir`/`path` are repo paths at `commit`; scripts/run-screenshots.mjs extracts exactly
 * those into `.prototype-cache/<commit>/` before the container starts.
 */
export type PrototypeSource =
  | {
      kind: 'static-archive'
      commit: string
      dir: string
      entry: string
      query?: string
      prepare?: (page: Page) => Promise<void>
    }
  | { kind: 'reference-png'; commit: string; path: string }

export interface CompareWithPrototypeOptions {
  /** File-safe, e.g. 'library-28-import-collision'. */
  name: string
  prototype: PrototypeSource
  /** Omitted → prototype only. */
  production?: { route: string; prepare?: (page: Page) => Promise<void> }
  viewport?: { width: number; height: number }
}

// The archive is served from an unroutable origin so `page.route` can answer it from disk:
// the exact bytes of the commit, no extra server, no rebuild (#39 notes).
const PROTOTYPE_ORIGIN = 'https://prototype.invalid'
const DEFAULT_VIEWPORT = { width: 1440, height: 1000 }
const CAPTION_HEIGHT = 32
const GUTTER = 16

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

const cacheRoot = () => resolve('.prototype-cache')
const compareRoot = () => resolve('test-results', 'prototype-compare')

/** `<cache>/<commit>/<repo path>`, refusing anything that walks out of the cache. */
function cachedFile(commit: string, repoPath: string): string | null {
  const root = resolve(join(cacheRoot(), commit))
  const file = resolve(join(root, repoPath))
  if (!file.startsWith(root + sep)) throw new Error(`prototype path escapes the cache: ${repoPath}`)
  return existsSync(file) ? file : null
}

function notStaged(commit: string, repoPath: string): string {
  return (
    `${commit}:${repoPath} is not in ${relative(process.cwd(), cacheRoot())}/. ` +
    'Declare it as a `dir:` or `path:` in an e2e source so scripts/run-screenshots.mjs stages it.'
  )
}

/** Renders the prototype on `page`; returns the cached PNG for reference-png sources. */
async function renderPrototype(
  page: Page,
  prototype: PrototypeSource,
  viewport: { width: number; height: number },
): Promise<string | null> {
  await page.setViewportSize(viewport)

  if (prototype.kind === 'reference-png') {
    // Native size, no resize: the PNG the prototype issue committed *is* the capture.
    const file = cachedFile(prototype.commit, prototype.path)
    if (!file) throw new Error(notStaged(prototype.commit, prototype.path))
    return file
  }

  await page.route(`${PROTOTYPE_ORIGIN}/**`, (route) => {
    const repoPath = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '')
    const file = cachedFile(prototype.commit, repoPath)
    if (!file) {
      route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: notStaged(prototype.commit, repoPath) })
      return
    }
    route.fulfill({
      status: 200,
      contentType: CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      body: readFileSync(file),
    })
  })

  await page.goto(`${PROTOTYPE_ORIGIN}/${prototype.entry}${prototype.query ?? ''}`, { waitUntil: 'networkidle' })
  await waitForFonts(page)
  if (prototype.prepare) await prototype.prepare(page)
  return null
}

async function renderProduction(page: Page, production: { route: string; prepare?: (page: Page) => Promise<void> }, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport)
  await page.goto(production.route, { waitUntil: 'networkidle' })
  await waitForFonts(page)
  if (production.prepare) await production.prepare(page)
}

/**
 * The composite is made in the browser — two columns, a 16 px gutter and a caption bar
 * naming the commit and the route — so no image library is needed (#39 §3). Each side is
 * letterboxed inside its column; `prototype.png`/`production.png` stay at native size.
 */
async function compose(
  page: Page,
  outPath: string,
  cells: { caption: string; file: string }[],
  viewport: { width: number; height: number },
): Promise<void> {
  const columns = cells
    .map((cell) => {
      const src = `data:image/png;base64,${readFileSync(cell.file).toString('base64')}`
      return `<div class="cell"><img src="${src}" alt="${escapeHtml(cell.caption)}"></div>`
    })
    .join('')
  const captions = cells.map((cell) => `<span>${escapeHtml(cell.caption)}</span>`).join('')

  await page.setViewportSize(viewport)
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
      html, body { margin: 0; height: 100%; background: #09090b; color: #e4e4e7;
        font: 12px/1.2 ui-sans-serif, system-ui, sans-serif; }
      body { display: flex; flex-direction: column; }
      .bar { height: ${CAPTION_HEIGHT}px; flex: none; display: flex; align-items: center;
        gap: ${GUTTER}px; padding: 0 12px; background: #18181b; border-bottom: 1px solid #27272a; }
      .grid { flex: 1; display: grid; grid-template-columns: repeat(${cells.length}, 1fr);
        gap: ${GUTTER}px; min-height: 0; }
      .cell { min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; }
      .cell img { max-width: 100%; max-height: 100%; object-fit: contain; }
    </style></head><body><div class="bar">${captions}</div><div class="grid">${columns}</div></body></html>`,
  )
  await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0))
  await waitForFonts(page)
  await page.screenshot({ path: outPath })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Render a prototype next to a production route at 1440x1000 and attach the pair plus a
 * side-by-side composite as test artifacts (#39 §3).
 *
 * Review-only by design: this never calls `toHaveScreenshot`, so a prototype is never
 * baselined — the unit check in e2e/screenshots/prototype-compare.spec.ts enforces it.
 */
export async function compareWithPrototype(
  page: Page,
  testInfo: TestInfo,
  { name, prototype, production, viewport = DEFAULT_VIEWPORT }: CompareWithPrototypeOptions,
): Promise<void> {
  const dir = resolve(compareRoot(), name)
  mkdirSync(dir, { recursive: true })
  const attach = async (label: string, path: string) => {
    await testInfo.attach(label, { path, contentType: 'image/png' })
  }

  const cachedPng = await renderPrototype(page, prototype, viewport)
  const prototypePng = join(dir, 'prototype.png')
  if (cachedPng) copyFileSync(cachedPng, prototypePng)
  else await page.screenshot({ path: prototypePng })
  await attach('prototype.png', prototypePng)

  const captions = [
    `prototype ${prototype.commit} ${prototype.kind === 'static-archive' ? `${prototype.entry}${prototype.query ?? ''}` : prototype.path}`,
  ]
  const files = [prototypePng]

  if (production) {
    // The archive's route handler is still installed on this page; a production capture
    // belongs on a clean one so nothing of the prototype can leak into it.
    const productionPage = await page.context().newPage()
    try {
      await renderProduction(productionPage, production, viewport)
      const productionPng = join(dir, 'production.png')
      await productionPage.screenshot({ path: productionPng })
      await attach('production.png', productionPng)
      captions.push(`production ${production.route}`)
      files.push(productionPng)
    } finally {
      await productionPage.close()
    }
  }

  const compositePath = join(dir, 'side-by-side.png')
  const compositePage = await page.context().newPage()
  try {
    await compose(
      compositePage,
      compositePath,
      files.map((file, index) => ({ caption: captions[index], file })),
      viewport,
    )
  } finally {
    await compositePage.close()
  }
  await attach('side-by-side.png', compositePath)
}
