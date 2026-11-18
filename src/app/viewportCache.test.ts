/**
 * The viewport cache is device-local view state (#55 criterion 10): it round-trips
 * through the preferences port and leaves the Project record alone — the same guarantee
 * the downloaded `.buildbox` gets by the field simply not existing in the domain.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryAdapter } from '../persistence'
import { createViewportCache } from './viewportCache'

const open = () => {
  const ports = createMemoryAdapter()
  return { ports, cache: createViewportCache(ports.prefs, 'project-1') }
}

describe('createViewportCache', () => {
  it('round-trips a viewport under the view-state key', async () => {
    const { cache } = open()
    await cache.write('plan:floor-1', { zoom: 2.5, panX: -40, panY: 12 })
    await expect(cache.read('plan:floor-1')).resolves.toEqual({ zoom: 2.5, panX: -40, panY: 12 })
  })

  it('keeps one entry per project and per view', async () => {
    const a = open()
    const otherProject = createViewportCache(a.ports.prefs, 'project-2')
    await a.cache.write('plan:floor-1', { zoom: 1, panX: 0, panY: 0 })
    await otherProject.write('plan:floor-1', { zoom: 3, panX: 5, panY: 6 })
    await a.cache.write('plan:floor-2', { zoom: 2, panX: 1, panY: 1 })
    await expect(a.cache.read('plan:floor-1')).resolves.toEqual({ zoom: 1, panX: 0, panY: 0 })
    await expect(otherProject.read('plan:floor-1')).resolves.toEqual({ zoom: 3, panX: 5, panY: 6 })
    await expect(a.cache.read('plan:floor-2')).resolves.toEqual({ zoom: 2, panX: 1, panY: 1 })
  })

  it('reads undefined for a view never written', async () => {
    const { cache } = open()
    await expect(cache.read('plan:floor-9')).resolves.toBeUndefined()
  })

  it('writes nothing to the Project record', async () => {
    const { ports, cache } = open()
    await cache.write('plan:floor-1', { zoom: 4, panX: 8, panY: 9 })
    const loaded = await ports.projects.load('project-1')
    expect(loaded.ok).toBe(false)
  })
})
