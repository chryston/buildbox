import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import pixelmatch from 'pixelmatch'
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

/**
 * What `diffAgainstPrototype` compares and how much disagreement it tolerates (#50
 * criteria 23–24). `masks` and `hideOnPrototype` are required arrays rather than optional
 * ones: a comparison that silently masks nothing is a number nobody should trust, so the
 * spec has to state its exclusions even when they are empty.
 */
export interface DiffAgainstPrototypeOptions {
  /** File-safe, e.g. 'library-28-library'. */
  name: string
  prototype: PrototypeSource
  production: { route: string; prepare?: (page: Page) => Promise<void> }
  /** CSS selector; both sides are cropped to its bounding box. */
  clip?: string
  /** Selectors painted solid on both sides and excluded from the pixel count. */
  masks: string[]
  /** Selectors given `display:none !important` on the prototype side only. */
  hideOnPrototype: string[]
  /** At most this fraction of unmasked pixels may differ. */
  maxDiffRatio: number
  viewport?: { width: number; height: number }
}

/** A rectangle in the page's CSS-pixel space, as `getBoundingClientRect` reports it. */
interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** One captured side of a diff: its PNG, the crop it was taken with, and what was masked. */
interface CapturedSide {
  png: string
  /** Mask boxes in page space, and how many elements each mask selector matched. */
  masks: Box[]
  counts: number[]
  clip?: Box
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

// The archive `@import`s Google's stylesheet for the same two families production bundles
// (#50 named deviation 2). Both hosts are answered from disk: no third-party request ever
// leaves the pinned container, and both sides rasterise the identical woff2 bytes, so a
// diff is a layout or colour difference and never a font difference.
const GOOGLE_FONTS_ORIGIN = 'https://fonts.googleapis.com'
const PROTOTYPE_FONT_ORIGIN = 'https://prototype-fonts.invalid'

// Resolved from this module's own URL, not `process.cwd()`: the specs run with the
// container's working directory, but the fonts belong to the tree the helper is installed in.
const fontSourceRoot = fileURLToPath(new URL('../../node_modules/@fontsource/', import.meta.url))

/** The seven faces the archive asks for: DM Sans 400/500/600/700, Manrope 500/600/700. */
const PROTOTYPE_FONTS = [
  { family: 'DM Sans', weight: 400, file: 'dm-sans/files/dm-sans-latin-400-normal.woff2' },
  { family: 'DM Sans', weight: 500, file: 'dm-sans/files/dm-sans-latin-500-normal.woff2' },
  { family: 'DM Sans', weight: 600, file: 'dm-sans/files/dm-sans-latin-600-normal.woff2' },
  { family: 'DM Sans', weight: 700, file: 'dm-sans/files/dm-sans-latin-700-normal.woff2' },
  { family: 'Manrope', weight: 500, file: 'manrope/files/manrope-latin-500-normal.woff2' },
  { family: 'Manrope', weight: 600, file: 'manrope/files/manrope-latin-600-normal.woff2' },
  { family: 'Manrope', weight: 700, file: 'manrope/files/manrope-latin-700-normal.woff2' },
] as const

// A masked region has to read as a deliberate blank on the composite rather than as
// half-rendered content, so the element is painted over and then hidden; its pixels leave
// the count either way (#50 criteria 23–24).
const MASK_STYLE =
  'background: #000 !important; color: transparent !important; fill: transparent !important; ' +
  'stroke: transparent !important; opacity: 0 !important; box-shadow: none !important; ' +
  'visibility: hidden !important'

// pngjs ships no declarations, and the diff uses exactly two calls, so the surface is typed
// here instead of by a `.d.ts` nothing else in the repo would consult. The require is the
// untyped boundary; this const is where the shape is asserted, once.
interface PngImage {
  width: number
  height: number
  data: Buffer
}
interface PngLibrary {
  sync: {
    read(buffer: Buffer): PngImage
    write(png: { width: number; height: number; data: Buffer }): Buffer
  }
}
const { PNG } = createRequire(import.meta.url)('pngjs') as { PNG: PngLibrary }

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

/** The stylesheet Google would have served: one `@font-face` per face, sourced locally. */
function prototypeFontCss(): string {
  return PROTOTYPE_FONTS.map(
    (font) =>
      `@font-face{font-family:'${font.family}';font-style:normal;font-weight:${font.weight};` +
      `font-display:block;src:url('${PROTOTYPE_FONT_ORIGIN}/${basename(font.file)}') format('woff2')}`,
  ).join('\n')
}

/**
 * Answer the archive's font requests out of `node_modules` (#50 named deviation 2): the
 * `@import` is generated rather than fetched, and the woff2 bytes are the very files
 * production bundles, so the two sides rasterise identical glyphs offline in the pinned
 * container and no third-party request leaves it. `font-display: block` is deliberate — a
 * swap would let a capture land on the fallback while a face is still loading.
 *
 * Install before navigating: the `@import` is resolved while the archive's own stylesheet
 * parses. Only the prototype page gets these routes; production loads its fonts from the
 * preview server like any other asset.
 */
async function routePrototypeFonts(page: Page): Promise<void> {
  // The archive's origin is not the font origin, and Chromium fetches `@font-face` sources in
  // CORS mode, so a fulfilled response without this header is a font that never loads and a
  // capture in the fallback — the exact failure the routing exists to prevent.
  const headers = { 'access-control-allow-origin': '*' }
  await page.route(`${GOOGLE_FONTS_ORIGIN}/**`, (route) => {
    route.fulfill({ status: 200, contentType: CONTENT_TYPES['.css'], headers, body: prototypeFontCss() })
  })
  await page.route(`${PROTOTYPE_FONT_ORIGIN}/**`, (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '')
    const font = PROTOTYPE_FONTS.find((candidate) => basename(candidate.file) === name)
    const file = font ? join(fontSourceRoot, font.file) : null
    if (!file || !existsSync(file)) {
      route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', headers, body: `no bundled font behind ${name}` })
      return
    }
    route.fulfill({ status: 200, contentType: CONTENT_TYPES['.woff2'], headers, body: readFileSync(file) })
  })
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

/** One capture: the whole viewport, or the `clip` rectangle when the spec asked for a crop. */
async function capture(page: Page, outPath: string, clip?: Box): Promise<void> {
  // Neither helper scrolls, so `getBoundingClientRect` coordinates are the viewport
  // coordinates `page.screenshot` clips by, and the same space the mask boxes live in.
  await page.screenshot(clip ? { path: outPath, clip } : { path: outPath })
}

/** Every PNG a comparison produces is an artifact of the run, never a baseline (#39 §3). */
async function attach(testInfo: TestInfo, label: string, path: string): Promise<void> {
  await testInfo.attach(label, { path, contentType: 'image/png' })
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

/**
 * The composite on a page of its own, so neither side's routes, styles or scroll position
 * can appear in it (#39 §3).
 */
async function composeAndAttach(
  page: Page,
  testInfo: TestInfo,
  outPath: string,
  cells: { caption: string; file: string }[],
  viewport: { width: number; height: number },
): Promise<void> {
  const compositePage = await page.context().newPage()
  try {
    await compose(compositePage, outPath, cells, viewport)
  } finally {
    await compositePage.close()
  }
  await attach(testInfo, 'side-by-side.png', outPath)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The crop one side is measured by, in the same page space the mask boxes use. */
async function clipBox(page: Page, name: string, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`${name}: clip selector ${selector} has no bounding box at ${page.url()}`)
  return box
}

/**
 * Paint every mask selector solid and return the boxes it covered plus a per-selector match
 * count. The boxes are read before the paint, and the paint changes no layout, so the
 * regions excluded from the count are the ones the reviewer sees blanked.
 *
 * A selector that matches nothing on one side is legitimate — production shows a
 * `Design Options` count of 0 where the prototype drew a badge — which is why emptiness is
 * only a bug once both sides are known (`assertMasks`).
 */
async function maskRegion(page: Page, selectors: string[]): Promise<{ boxes: Box[]; counts: number[] }> {
  const boxes: Box[] = []
  const counts: number[] = []
  for (const selector of selectors) {
    const found = await page
      .locator(selector)
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect()
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        }),
      )
    counts.push(found.length)
    boxes.push(...found)
  }
  if (selectors.length > 0) {
    await page.addStyleTag({ content: selectors.map((selector) => `${selector} { ${MASK_STYLE} }`).join('\n') })
  }
  return { boxes, counts }
}

/** A mask that matched nothing anywhere is a stale selector in the spec, not a visual difference. */
function assertMasks(name: string, masks: string[], prototypeCounts: number[], productionCounts: number[]): void {
  const dead = masks.filter((selector, index) => prototypeCounts[index] === 0 && productionCounts[index] === 0)
  if (dead.length > 0) {
    throw new Error(`${name}: mask selector ${dead.join(', ')} matches nothing on either side — the spec is wrong, not the pixels.`)
  }
}

/**
 * Page-space boxes → the cropped image's pixel space: subtract the crop origin, scale by the
 * capture's own factor, clip to the image and drop what falls outside it. The factor is
 * derived from the PNG rather than assumed, so a `deviceScaleFactor` change cannot quietly
 * misalign every mask.
 */
function toImageBoxes(boxes: Box[], origin: { x: number; y: number }, scale: number, image: { width: number; height: number }): Box[] {
  return boxes.flatMap((box) => {
    const left = Math.round((box.x - origin.x) * scale)
    const top = Math.round((box.y - origin.y) * scale)
    const right = Math.round((box.x + box.width - origin.x) * scale)
    const bottom = Math.round((box.y + box.height - origin.y) * scale)
    const x = Math.max(0, left)
    const y = Math.max(0, top)
    const width = Math.min(image.width, right) - x
    const height = Math.min(image.height, bottom) - y
    return width > 0 && height > 0 ? [{ x, y, width, height }] : []
  })
}

/** One flag per pixel: inside at least one mask box, so overlapping masks count once. */
function coverage(width: number, height: number, boxes: Box[]): Uint8Array {
  const covered = new Uint8Array(width * height)
  for (const box of boxes) {
    for (let y = box.y; y < box.y + box.height; y++) {
      covered.fill(1, y * width + box.x, y * width + box.x + box.width)
    }
  }
  return covered
}

/** Blank the masked pixels identically on both sides, so they cannot differ and are not counted. */
function blankCovered(data: Buffer, covered: Uint8Array): void {
  for (let index = 0; index < covered.length; index++) {
    if (covered[index] === 0) continue
    const pos = index * 4
    data[pos] = 0
    data[pos + 1] = 0
    data[pos + 2] = 0
    data[pos + 3] = 255
  }
}

/**
 * pixelmatch over the two captures (#50 criteria 23–24). The return value is differing
 * pixels over unmasked pixels: masking a region takes it out of the numerator by blanking it
 * identically on both sides and out of the denominator by the coverage count, so a masked
 * region cannot move the number in either direction.
 */
function diffCaptures(
  name: string,
  prototype: CapturedSide,
  production: CapturedSide,
  diffPath: string,
  viewport: { width: number; height: number },
): number {
  const a = PNG.sync.read(readFileSync(prototype.png))
  const b = PNG.sync.read(readFileSync(production.png))
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `${name}: the two sides captured at different sizes — prototype ${a.width}x${a.height}, ` +
        `production ${b.width}x${b.height}. Give the spec a \`clip\` both sides share.`,
    )
  }

  const crop = prototype.clip ?? { x: 0, y: 0, width: viewport.width, height: viewport.height }
  const scale = a.width / crop.width
  const covered = coverage(a.width, a.height, [
    ...toImageBoxes(prototype.masks, crop, scale, a),
    ...toImageBoxes(production.masks, production.clip ?? crop, scale, b),
  ])
  blankCovered(a.data, covered)
  blankCovered(b.data, covered)

  const diff = Buffer.alloc(a.width * a.height * 4)
  const differing = pixelmatch(a.data, b.data, diff, a.width, a.height, { threshold: 0.1 })
  writeFileSync(diffPath, PNG.sync.write({ width: a.width, height: a.height, data: diff }))

  let unmasked = a.width * a.height
  for (const flag of covered) unmasked -= flag
  if (unmasked === 0) throw new Error(`${name}: every pixel of the capture is masked, so there is nothing left to compare.`)
  return differing / unmasked
}

/**
 * Render the production route on a fresh page of the same context and capture it. Fresh,
 * because the archive's route handler is installed on the prototype page and must not answer
 * one request the app makes (#39 §3).
 */
async function captureProduction(
  page: Page,
  name: string,
  production: { route: string; prepare?: (page: Page) => Promise<void> },
  masks: string[],
  clip: string | undefined,
  outPath: string,
  viewport: { width: number; height: number },
): Promise<CapturedSide> {
  const productionPage = await page.context().newPage()
  try {
    await renderProduction(productionPage, production, viewport)
    await waitForFonts(productionPage)
    const region = await maskRegion(productionPage, masks)
    const box = clip ? await clipBox(productionPage, name, clip) : undefined
    await capture(productionPage, outPath, box)
    return { png: outPath, masks: region.boxes, counts: region.counts, clip: box }
  } finally {
    await productionPage.close()
  }
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

  const cachedPng = await renderPrototype(page, prototype, viewport)
  const prototypePng = join(dir, 'prototype.png')
  if (cachedPng) copyFileSync(cachedPng, prototypePng)
  else await capture(page, prototypePng)
  await attach(testInfo, 'prototype.png', prototypePng)

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
      await capture(productionPage, productionPng)
      await attach(testInfo, 'production.png', productionPng)
      captions.push(`production ${production.route}`)
      files.push(productionPng)
    } finally {
      await productionPage.close()
    }
  }

  await composeAndAttach(
    page,
    testInfo,
    join(dir, 'side-by-side.png'),
    files.map((file, index) => ({ caption: captions[index], file })),
    viewport,
  )
}

/**
 * Measure a production route against the published prototype (#50 criteria 23–24): the same
 * two renders `compareWithPrototype` makes, plus the fraction of unmasked pixels that
 * differ, and a failure when that fraction exceeds what the spec allows.
 *
 * A number and a review artifact are different promises, and this one still honours #39 §3:
 * it writes only under `test-results/prototype-compare/<name>/`, never under
 * `e2e/screenshots/__snapshots__`, and it never calls `toHaveScreenshot`. What makes the
 * number worth trusting is decided before a pixel is compared:
 *
 * - both sides rasterise the same woff2 bytes (`routePrototypeFonts`, #50 named deviation
 *   2), so a difference is the app's and never the font host's;
 * - `hideOnPrototype` removes the prototype's own chrome — the scenario bar, the notice
 *   strip — after its state is driven and before capture, so chrome the app never had
 *   cannot count;
 * - `masks` excludes the regions the two sides are *meant* to disagree about, and says so on
 *   the composite instead of hiding it.
 *
 * #51 and #52 call this for their own states. All four PNGs are attached before any verdict
 * is thrown, because the red run is exactly when a reviewer needs to see them.
 */
export async function diffAgainstPrototype(
  page: Page,
  testInfo: TestInfo,
  {
    name,
    prototype,
    production,
    clip,
    masks,
    hideOnPrototype,
    maxDiffRatio,
    viewport = DEFAULT_VIEWPORT,
  }: DiffAgainstPrototypeOptions,
): Promise<void> {
  if (prototype.kind !== 'static-archive') {
    throw new Error(
      `${name}: diffAgainstPrototype re-renders the prototype, and a ${prototype.kind} source has nothing to ` +
        `render. Compare ${prototype.kind} sources with compareWithPrototype instead.`,
    )
  }

  // `diff-` namespaces this helper's artifacts away from `compareWithPrototype`'s: both
  // specs may name the same state, and parallel workers writing one directory overwrite
  // each other's captures mid-test.
  const dir = resolve(compareRoot(), `diff-${name}`)
  mkdirSync(dir, { recursive: true })

  // --- the prototype side -------------------------------------------------------
  await routePrototypeFonts(page)
  // `renderPrototype` drives `prepare` itself, before any style of ours existed, so the
  // preparer is deferred here and runs exactly once — on the page the capture sees. The
  // preparer drives the archive's own controls, so it runs while they are still clickable;
  // the chrome is hidden only afterwards, so it cannot count in the pixels.
  await renderPrototype(page, { ...prototype, prepare: undefined }, viewport)
  if (prototype.prepare) await prototype.prepare(page)
  if (hideOnPrototype.length > 0) {
    const hide = hideOnPrototype.map((selector) => `${selector} { display: none !important; }`).join('\n')
    await page.addStyleTag({ content: hide })
  }
  await waitForFonts(page)
  const prototypeRegion = await maskRegion(page, masks)
  const prototypePng = join(dir, 'prototype.png')
  const prototypeClip = clip ? await clipBox(page, name, clip) : undefined
  await capture(page, prototypePng, prototypeClip)
  await attach(testInfo, 'prototype.png', prototypePng)
  const prototypeSide: CapturedSide = {
    png: prototypePng,
    masks: prototypeRegion.boxes,
    counts: prototypeRegion.counts,
    clip: prototypeClip,
  }

  // --- the production side ------------------------------------------------------
  const productionPng = join(dir, 'production.png')
  const productionSide = await captureProduction(page, name, production, masks, clip, productionPng, viewport)
  await attach(testInfo, 'production.png', productionPng)
  assertMasks(name, masks, prototypeSide.counts, productionSide.counts)

  // --- the verdict --------------------------------------------------------------
  const diffPath = join(dir, 'diff.png')
  const ratio = diffCaptures(name, prototypeSide, productionSide, diffPath, viewport)
  await attach(testInfo, 'diff.png', diffPath)
  await composeAndAttach(
    page,
    testInfo,
    join(dir, 'side-by-side.png'),
    [
      { caption: `prototype ${prototype.commit} ${prototype.entry}${prototype.query ?? ''}`, file: prototypePng },
      { caption: `production ${production.route}`, file: productionPng },
      { caption: `diff ${ratio.toFixed(4)} of unmasked pixels, max ${maxDiffRatio.toFixed(4)}`, file: diffPath },
    ],
    viewport,
  )

  if (ratio > maxDiffRatio) {
    throw new Error(
      `${name}: ${ratio.toFixed(4)} of the unmasked pixels differ from prototype ${prototype.commit}, above the ` +
        `${maxDiffRatio.toFixed(4)} the spec allows — see ${relative(process.cwd(), diffPath)}.`,
    )
  }
}
