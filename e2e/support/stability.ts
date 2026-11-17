import type { Locator, Page } from '@playwright/test'

/**
 * Capture-stability helpers shared by the screenshot specs (#39 notes): a baseline is only
 * worth committing if the same commit produces the same pixels twice.
 */

/** Webfonts rasterise differently from their fallback, so never capture before they land. */
export async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

/**
 * Wait until an SVG `<image>` has actually decoded. `decode()` is on `SVGImageElement` in
 * Chromium; where it is missing the caller's stability poll is the only signal, so the
 * capture is taken after a paint the image is part of.
 */
export async function waitForImageDecode(image: Locator): Promise<void> {
  await image.evaluate((element) => {
    // SVG2 puts decode() on <image>; Chromium implements it, the DOM lib types stop at SVGElement.
    if (!('decode' in element) || typeof element.decode !== 'function') return undefined
    return Promise.resolve(element.decode.call(element)).then(() => undefined)
  })
}

/**
 * The floor plan auto-fits whenever the image or its scale changes (FloorPlanCanvas.tsx),
 * so an early capture is a different zoom from the settled one. Poll the probe's client
 * rect across animation frames and settle once it has been identical for two consecutive
 * frames.
 */
export async function waitForStablePaint(probe: Locator, stableFrames = 2): Promise<void> {
  await probe.evaluate(async (element, needed) => {
    const nextFrame = () => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()))
    let previous = ''
    let stable = 0
    while (stable < needed) {
      await nextFrame()
      const rect = element.getBoundingClientRect()
      const current = [rect.x, rect.y, rect.width, rect.height].map((n) => n.toFixed(2)).join(',')
      stable = current === previous ? stable + 1 : 0
      previous = current
    }
  }, stableFrames)
}
