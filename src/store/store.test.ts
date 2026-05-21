import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('useStore temporal history', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('does not create undo history entries for UI-only state changes', async () => {
    const { useStore } = await import('./store')

    useStore.temporal.getState().clear()

    useStore.getState().setSelectedId('node-1')
    useStore.getState().setSnapGrid(10)

    expect(useStore.getState().selectedId).toBe('node-1')
    expect(useStore.getState().snapGrid).toBe(10)
    expect(useStore.temporal.getState().pastStates).toHaveLength(0)
  })

  it('still tracks project changes in undo history', async () => {
    const { useStore } = await import('./store')

    useStore.temporal.getState().clear()

    useStore.getState().renameProject(useStore.getState().activeProjectId!, 'Renamed cabinet')

    expect(useStore.getState().projects[0]?.name).toBe('Renamed cabinet')
    expect(useStore.temporal.getState().pastStates).toHaveLength(1)
  })
})
