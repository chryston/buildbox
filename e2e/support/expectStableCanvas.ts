import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The toolbar-stability contract of #55 behaviour 2: no interaction with the toolbar —
 * tool switches, menu open/close, starting and cancelling calibration — may move or
 * resize the toolbar row or the canvas. Everything the toolbar opens is an overlay, so
 * the two boxes are compared exactly, with no tolerance.
 *
 * The two boxes are the ones named here by default, because #55 was about the Floor
 * toolbar. #59 criterion 7 makes the same promise about the shape editor, whose toolbar is
 * `shape-toolbar` and whose canvas host is `shape-canvas-host` — and the failure it
 * regresses (the `A-custom` ribbon reflowing into three rows) is exactly a box that grew.
 * Which boxes matter is a property of the screen under test, so the caller names them.
 */
export async function expectStableCanvas(
  page: Page,
  action: () => Promise<void>,
  targets: Record<string, Locator> = {
    toolbar: page.getByTestId('workspace-toolbar'),
    canvas: page.getByTestId('floor-plan-canvas'),
  },
): Promise<void> {
  const before = await boxes(targets)
  await action()
  expect(await boxes(targets)).toEqual(before)
}

async function boxes(targets: Record<string, Locator>): Promise<Record<string, { x: number; y: number; width: number; height: number } | null>> {
  const entries = await Promise.all(
    Object.entries(targets).map(async ([name, locator]) => [name, await locator.boundingBox()] as const),
  )
  return Object.fromEntries(entries)
}
