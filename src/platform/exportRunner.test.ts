/**
 * The export host's two promises: it never throws at the caller, and it never pretends to have
 * drawn something it did not (#61 criterion 14).
 *
 * jsdom has no `Worker` and no `OffscreenCanvas`, which is exactly the environment the fallback
 * exists for — so the interesting assertions here are that a host with nowhere to send the work
 * says so as data, and that the rasterizer says it cannot rather than handing back a blank sheet.
 */
import { describe, expect, it } from 'vitest'
import { createExportRunner } from './exportRunner'
import { createRasterizer } from './rasterizer'
import type { ExportRunRequest } from './exportRunner'
import type { ExportSnapshot, Recipe } from '../export'

const snapshot = { project: { id: 'p' }, revision: 1 } as unknown as ExportSnapshot

const recipe: Recipe = {
  views: [{ kind: 'plan', viewId: 'view-1' }],
  format: 'svg',
  pageSize: 'A4',
  orientation: 'auto',
  scale: 'fit',
  pngLongEdge: 2048,
  titleBlock: true,
  grid: false,
  unit: 'mm',
  precision: 0,
}

const request: ExportRunRequest = {
  snapshot,
  recipe,
  deps: { clock: { now: () => '2026-03-04T09:30:00.000Z', localDate: () => '2026-03-04' }, buildboxVersion: 'test' },
  assets: [],
}

describe('createExportRunner', () => {
  it('declines when it was built without a Worker', async () => {
    const runner = createExportRunner({ available: false })
    expect(await runner.run(request)).toEqual({ kind: 'unavailable' })
  })

  it('declines rather than throwing where the browser has no Worker', async () => {
    // jsdom: `new Worker` is not a function, which is the real failure this host must absorb.
    const runner = createExportRunner()
    expect(await runner.run(request)).toEqual({ kind: 'unavailable' })
    // And it stays declined: a second run does not try to resurrect the dead thread.
    expect(await runner.run(request)).toEqual({ kind: 'unavailable' })
  })

  it('cancelling with nothing in flight changes nothing', async () => {
    const runner = createExportRunner({ available: false })
    runner.cancel()
    expect(await runner.run(request)).toEqual({ kind: 'unavailable' })
  })
})

describe('createRasterizer', () => {
  it('says there is no rasterizer where there is no canvas', () => {
    expect(createRasterizer()).toBeNull()
  })
})
