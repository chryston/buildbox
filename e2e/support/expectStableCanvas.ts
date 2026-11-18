import { expect, type Page } from '@playwright/test'

/**
 * The toolbar-stability contract of #55 behaviour 2: no interaction with the toolbar —
 * tool switches, menu open/close, starting and cancelling calibration — may move or
 * resize the toolbar row or the canvas. Everything the toolbar opens is an overlay, so
 * the two boxes are compared exactly, with no tolerance.
 */
export async function expectStableCanvas(page: Page, action: () => Promise<void>): Promise<void> {
  const before = await boxes(page)
  await action()
  expect(await boxes(page)).toEqual(before)
}

async function boxes(page: Page): Promise<Record<string, { x: number; y: number; width: number; height: number } | null>> {
  return {
    toolbar: await page.getByTestId('workspace-toolbar').boundingBox(),
    canvas: await page.getByTestId('floor-plan-canvas').boundingBox(),
  }
}
