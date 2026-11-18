import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page, TestInfo } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { cardButton } from '../support/libraryApp'
import { seedLegacyStore } from '../support/legacyStore'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForImageDecode, waitForStablePaint } from '../support/stability'

// The two scenes today's app has to keep rendering identically through the migration
// (#39 §2, #20 §13.15): the cabinet editor, and a floor plan with an image, objects and
// annotations. Both come from the untouched v3 legacy fixture, so a baseline is a promise
// about real persisted data, not about a fixture the app invented.
//
// It runs in two projects against two artifacts (#49 criterion 1): `chromium` captures
// today's build seeded through `localStorage`, `projects-v2` captures the flag-on build
// seeded into `buildbox-preview`. Same spec, same clock, same baselines — the snapshot
// template has no project segment, so a difference between the two is a real visual
// difference in the flagged app.
const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const v3 = readFileSync(join(fixturesRoot, 'legacy', 'v3', 'buildbox-store.json'), 'utf8')
const previewSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'legacy-v3.json'), 'utf8'),
) as PreviewSeed

const cabinetCanvas = (page: Page): Locator => page.getByTestId('cabinet-canvas')
const floorPlanCanvas = (page: Page): Locator => page.getByTestId('floor-plan-canvas')

// Persisted text carries timestamps; a frozen clock keeps them out of the diff (#39 notes).
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

/** One legacy sketch: a polyline or rectangle in the floor plan's own millimetre space. */
interface LegacyAnnotation {
  type: string
  points: { x: number; y: number }[]
}

/** The part of the v3 fixture this spec needs; the file is committed, so the shape is known. */
interface LegacyV3Fixture {
  state: { floorPlan: { annotations: LegacyAnnotation[] } }
}

const legacyV3 = JSON.parse(v3) as LegacyV3Fixture

/** The v3 fixture's two sketches: the wall-hack polyline and the tile-zone rectangle. */
const legacyAnnotations = legacyV3.state.floorPlan.annotations

const isPreview = (projectName: string): boolean => projectName === 'projects-v2'

// The flag-on build opens on the Project Library (#50), so the scene lives one card behind;
// the seed's first Project is the one the chromium project lands in, so it is the one opened.
const firstProjectName = previewSeed.library.find((record) => record.id === previewSeed.projects[0]!.id)!.name

test.beforeEach(async ({ page }, testInfo) => {
  await page.clock.setFixedTime(FIXED_NOW)
  // The one thing the two projects do differently: where the saved work lives.
  if (isPreview(testInfo.project.name)) await seedPreviewDb(page, previewSeed)
  else await seedLegacyStore(page, v3)
  await page.goto('./', { waitUntil: 'networkidle' })
  if (isPreview(testInfo.project.name)) await cardButton(page, firstProjectName, 'Open').click()
  await expect(cabinetCanvas(page)).toBeVisible()
  await waitForFonts(page)
  // The first project is active, nothing is selected and the view is at the default
  // zoom — the state a user lands in, and the one S4 has to reproduce.
  await waitForStablePaint(cabinetCanvas(page))
})

test('cabinet scene', async ({ page }) => {
  await expect(cabinetCanvas(page)).toHaveScreenshot('cabinet-scene.png')
})

test('cabinet scene with a void selected', async ({ page }) => {
  const firstVoid = page.getByTestId(/^void-/).first()
  // The space-label rect covers the middle half of every void, so a real click lands in
  // the outer quarter — the same position e2e/smoke/app.spec.ts uses.
  await firstVoid.click({ position: { x: 10, y: 10 } })
  await expect(firstVoid).toHaveAttribute('stroke', '#7c3aed')
  await waitForStablePaint(cabinetCanvas(page))

  await expect(cabinetCanvas(page)).toHaveScreenshot('cabinet-scene-selected.png')
})

/**
 * The sketch layer is the one part of the floor-plan scene domain v1 does not carry (#49
 * deviation 1: the sketch tools are gone, so nothing draws them). Two invisible `<rect>`s
 * are appended to the scene in the flag-on run, at the fixture's own annotation boxes:
 * `zoomUntilSceneFits` then stops at the same zoom the annotations made it stop at, and each
 * rect becomes the mask over the pixels that no longer exist. They are test-side DOM — the
 * app has no test hook and renders nothing for them.
 */
async function sketchProbes(canvas: Locator): Promise<Locator[]> {
  await canvas.evaluate((svg, annotations) => {
    const scene = svg.querySelector('g')
    if (scene === null) throw new Error('the floor-plan scene group is missing')
    for (const [index, annotation] of annotations.entries()) {
      const xs = annotation.points.map((point) => point.x)
      const ys = annotation.points.map((point) => point.y)
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      rect.setAttribute('x', String(Math.min(...xs)))
      rect.setAttribute('y', String(Math.min(...ys)))
      rect.setAttribute('width', String(Math.max(...xs) - Math.min(...xs)))
      rect.setAttribute('height', String(Math.max(...ys) - Math.min(...ys)))
      rect.setAttribute('fill', 'none')
      rect.setAttribute('stroke', 'none')
      rect.dataset.testid = `sketch-probe-${index}`
      scene.appendChild(rect)
    }
  }, legacyAnnotations)
  return legacyAnnotations.map((_, index) => canvas.getByTestId(`sketch-probe-${index}`))
}

/**
 * Auto-fit fits the calibrated image, not the scene: the v3 fixture's image is 1024 mm wide
 * while its placed objects reach 2300 mm, so the fitted view clips five of the seven
 * objects and both annotation shapes. The baseline has to contain them — that is the scene
 * S4 must reproduce — so zoom out with the app's own control until the whole scene is
 * inside the canvas, the same way a user would to see the whole plan.
 */
async function zoomUntilSceneFits(page: Page, canvas: Locator): Promise<void> {
  const zoomOut = page.getByRole('button', { name: 'Zoom out' })
  for (let attempt = 0; attempt < 10; attempt++) {
    const clipped = await canvas.evaluate((svg) => {
      const box = svg.getBoundingClientRect()
      const probes = document.querySelectorAll(
        '[data-testid^="placed-object-"], [data-layer="annotations"] > *, [data-testid^="sketch-probe-"]',
      )
      return [...probes].some((element) => {
        const rect = element.getBoundingClientRect()
        return (
          rect.left < box.left || rect.top < box.top || rect.right > box.right || rect.bottom > box.bottom
        )
      })
    })
    if (!clipped) return
    await zoomOut.click()
    await waitForStablePaint(canvas.locator('g').first())
  }
  throw new Error('the floor-plan scene never fitted inside the canvas')
}

/**
 * Grow each probe to its bounding box plus 4 px, measured in the scene's own units at the
 * zoom the view has settled on — the mask the issue allows, and nothing more (#49).
 */
async function padProbes(probes: readonly Locator[]): Promise<void> {
  for (const probe of probes) {
    await probe.evaluate((node) => {
      const rect = node as SVGRectElement
      const ctm = rect.getScreenCTM()
      if (ctm === null || ctm.a === 0) throw new Error('the sketch probe has no screen transform')
      const pad = 4 / ctm.a
      rect.setAttribute('x', String(Number(rect.getAttribute('x')) - pad))
      rect.setAttribute('y', String(Number(rect.getAttribute('y')) - pad))
      rect.setAttribute('width', String(Number(rect.getAttribute('width')) + pad * 2))
      rect.setAttribute('height', String(Number(rect.getAttribute('height')) + pad * 2))
    })
  }
}

/** A box in the canvas's own whole pixels, which is the only place a screenshot has any. */
interface PixelBox {
  x: number
  y: number
  width: number
  height: number
}

/** Each probe's box in canvas pixels, grown outward to whole pixels so no mask edge is blended. */
function probeBoxes(canvas: Locator): Promise<PixelBox[]> {
  return canvas.evaluate((svg) => {
    const host = svg.getBoundingClientRect()
    const originX = Math.round(host.left)
    const originY = Math.round(host.top)
    return [...svg.querySelectorAll('[data-testid^="sketch-probe-"]')].map((probe) => {
      const box = probe.getBoundingClientRect()
      const x0 = Math.max(0, Math.floor(box.left - originX))
      const y0 = Math.max(0, Math.floor(box.top - originY))
      const x1 = Math.min(Math.round(host.width), Math.ceil(box.right - originX))
      const y1 = Math.min(Math.round(host.height), Math.ceil(box.bottom - originY))
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    })
  })
}

const MASK_COLOR = '#ff00ff'

/**
 * Cover each box in the live page with the mask colour, so the capture shows it there.
 *
 * Playwright's own `mask` option only ever paints the *captured* image, and the baseline is
 * the S0 PNG, which has the sketches in it and must stay as it is. Painting the page instead
 * lets the same boxes be painted on the baseline's pixels (`maskedBaseline`) and the two
 * compared like for like.
 */
async function paintMask(canvas: Locator, boxes: readonly PixelBox[]): Promise<void> {
  await canvas.evaluate((svg, { boxList, color }) => {
    const host = svg.getBoundingClientRect()
    for (const box of boxList) {
      const cover = document.createElement('div')
      cover.dataset.testid = 'sketch-mask'
      cover.style.cssText =
        `position:fixed;z-index:2147483647;pointer-events:none;background:${color};` +
        `left:${Math.round(host.left) + box.x}px;top:${Math.round(host.top) + box.y}px;` +
        `width:${box.width}px;height:${box.height}px`
      document.body.appendChild(cover)
    }
  }, { boxList: boxes, color: MASK_COLOR })
}

/**
 * The S0 baseline with the same boxes painted over it, written beside it (gitignored) under
 * the name the masked comparison reads. The committed baseline is only ever read.
 */
async function maskedBaseline(page: Page, testInfo: TestInfo, boxes: readonly PixelBox[]): Promise<string> {
  const source = readFileSync(testInfo.snapshotPath('floor-plan-scene.png')).toString('base64')
  const masked = await page.evaluate(async ({ png, boxList, color }) => {
    const picture = new Image()
    picture.src = `data:image/png;base64,${png}`
    await picture.decode()
    const surface = document.createElement('canvas')
    surface.width = picture.naturalWidth
    surface.height = picture.naturalHeight
    const context = surface.getContext('2d')
    if (context === null) throw new Error('no 2d context to paint the baseline mask on')
    context.drawImage(picture, 0, 0)
    context.fillStyle = color
    for (const box of boxList) context.fillRect(box.x, box.y, box.width, box.height)
    return surface.toDataURL('image/png').split(',')[1]
  }, { png: source, boxList: boxes, color: MASK_COLOR })
  const name = 'floor-plan-scene-masked.png'
  const target = testInfo.snapshotPath(name)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, Buffer.from(masked, 'base64'))
  return name
}

test('floor plan scene', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: /floor plan/i }).click()

  const canvas = floorPlanCanvas(page)
  await expect(canvas).toBeVisible()
  const image = canvas.locator('image')
  await expect(image).toHaveCount(1)
  await waitForImageDecode(image)
  // Auto-fit runs on image and scale change; watch the transformed group, because the
  // canvas host itself never changes size.
  await waitForStablePaint(canvas.locator('g').first())
  const probes = isPreview(testInfo.project.name) ? await sketchProbes(canvas) : []
  await zoomUntilSceneFits(page, canvas)

  // Calibrated image, placed objects in all four rotations, the custom shape, the
  // wall-hack polyline and the tile-zone rectangle — the last two only in the build that
  // still has sketch tools, so only there are they unmasked.
  if (probes.length === 0) {
    await expect(canvas).toHaveScreenshot('floor-plan-scene.png')
    return
  }
  await padProbes(probes)
  const boxes = await probeBoxes(canvas)
  await paintMask(canvas, boxes)
  await expect(canvas).toHaveScreenshot(await maskedBaseline(page, testInfo, boxes))
})
