import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import type { StoredStateFailure } from './guardedStorage'

const settings = {
  unit: 'mm',
  height: 720,
  width: 600,
  depth: 560,
  thickness: 18,
  backThickness: 12,
  toeKick: null,
  material: 'oak',
}
const design = {
  id: 'p1',
  name: 'Kitchen',
  units: [{ type: 'cabinet', id: 'u1', label: 'Unit 1', x: 0, y: 0, settings, root: { id: 'r', fixedSize: 300 } }],
}
const floorPlan = { image: null, pixelsPerMm: null, objects: [], annotations: [], customTemplates: [] }
const validRaw = JSON.stringify({ state: { projects: [design], activeProjectId: 'p1', floorPlan }, version: 3 })
const corruptRaw = JSON.stringify({
  state: { projects: [{ ...design, units: {} }], activeProjectId: 'p1', floorPlan },
  version: 3,
})

/**
 * The failure slot is module state on purpose — `main.tsx` reads it once, at import time
 * — so each test needs the module evaluated again.
 */
interface Guard {
  guardedStorage: StateStorage
  getStoredStateFailure: () => StoredStateFailure | null
  STORE_KEY: string
}

async function freshGuard(): Promise<Guard> {
  localStorage.clear()
  vi.resetModules()
  return import('./guardedStorage')
}

describe('guardedStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('hands the stored string back untouched when it can be opened', async () => {
    const { guardedStorage, getStoredStateFailure, STORE_KEY } = await freshGuard()
    localStorage.setItem(STORE_KEY, validRaw)
    expect(await guardedStorage.getItem?.(STORE_KEY)).toBe(validRaw)
    expect(getStoredStateFailure()).toBeNull()
  })

  it('writes normally when nothing was refused', async () => {
    const { guardedStorage, STORE_KEY } = await freshGuard()
    guardedStorage.setItem(STORE_KEY, validRaw)
    expect(localStorage.getItem(STORE_KEY)).toBe(validRaw)
    guardedStorage.removeItem(STORE_KEY)
    expect(localStorage.getItem(STORE_KEY)).toBeNull()
  })

  it('says nothing at all when there is no stored value', async () => {
    const { guardedStorage, getStoredStateFailure, STORE_KEY } = await freshGuard()
    expect(await guardedStorage.getItem?.(STORE_KEY)).toBeNull()
    expect(getStoredStateFailure()).toBeNull()
  })

  it('refuses a value it cannot open and keeps the bytes', async () => {
    const { guardedStorage, getStoredStateFailure, STORE_KEY } = await freshGuard()
    localStorage.setItem(STORE_KEY, corruptRaw)
    expect(await guardedStorage.getItem?.(STORE_KEY)).toBeNull()
    const failure = getStoredStateFailure()
    expect(failure?.raw).toBe(corruptRaw)
    expect(failure?.problems).toEqual([
      { path: 'state.projects[0].units', code: 'wrong-type', message: 'Expected a list of cabinets.' },
    ])
  })

  it('drops every later write once the data is blocked', async () => {
    const { guardedStorage, STORE_KEY } = await freshGuard()
    localStorage.setItem(STORE_KEY, corruptRaw)
    await guardedStorage.getItem?.(STORE_KEY)
    guardedStorage.setItem(STORE_KEY, JSON.stringify({ state: { projects: [] }, version: 3 }))
    expect(localStorage.getItem(STORE_KEY)).toBe(corruptRaw)
    guardedStorage.removeItem(STORE_KEY)
    expect(localStorage.getItem(STORE_KEY)).toBe(corruptRaw)
  })

  it('reports a truncated value as bad JSON', async () => {
    const { guardedStorage, getStoredStateFailure, STORE_KEY } = await freshGuard()
    localStorage.setItem(STORE_KEY, validRaw.slice(0, validRaw.length - 20))
    expect(await guardedStorage.getItem?.(STORE_KEY)).toBeNull()
    expect(getStoredStateFailure()?.problems.map((p) => p.code)).toEqual(['bad-json'])
  })
})
