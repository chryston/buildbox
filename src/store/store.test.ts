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

  it('does not delete the last remaining project', async () => {
    const { useStore } = await import('./store')

    const onlyProjectId = useStore.getState().activeProjectId!
    useStore.getState().deleteProject(onlyProjectId)

    expect(useStore.getState().projects).toHaveLength(1)
    expect(useStore.getState().activeProjectId).toBe(onlyProjectId)
  })

  it('adds and removes accessories on the selected node', async () => {
    const { useStore } = await import('./store')

    const rootId = useStore.getState().projects[0]!.root.id
    useStore.getState().addAccessory(rootId, { id: 'a1', type: 'door' })
    expect(useStore.getState().projects[0]!.root.accessories).toEqual([{ id: 'a1', type: 'door' }])

    useStore.getState().removeAccessory(rootId, 'a1')
    expect(useStore.getState().projects[0]!.root.accessories).toEqual([])
  })
})
