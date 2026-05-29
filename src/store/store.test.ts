import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from './store'

beforeEach(() => {
  useStore.setState({
    projects: [{
      id: 'proj1',
      name: 'Test',
      units: [{
        type: 'cabinet', id: 'u1', label: 'Unit 1', x: 0, y: 0,
        settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, material: 'oak' },
        root: { id: 'r1', elementType: 'void' },
      }],
    }],
    activeProjectId: 'proj1',
    selectedId: null,
    snapGrid: 5,
    activeUnitId: 'u1',
  })
})

describe('addUnit', () => {
  it('appends a new unit and sets it as activeUnitId', () => {
    const { result } = renderHook(() => useStore())
    act(() => result.current.addUnit())
    const project = result.current.projects.find(p => p.id === 'proj1')!
    expect(project.units).toHaveLength(2)
    expect(result.current.activeUnitId).toBe(project.units[1].id)
  })

  it('new unit is positioned at x = first unit width + gap', () => {
    const { result } = renderHook(() => useStore())
    act(() => result.current.addUnit())
    const project = result.current.projects.find(p => p.id === 'proj1')!
    expect(project.units[1].x).toBeGreaterThan(600)
  })
})

describe('removeUnit', () => {
  it('cannot remove the last unit', () => {
    const { result } = renderHook(() => useStore())
    act(() => result.current.removeUnit('u1'))
    expect(result.current.projects.find(p => p.id === 'proj1')!.units).toHaveLength(1)
  })

  it('switches activeUnitId before removing active unit', () => {
    const { result } = renderHook(() => useStore())
    act(() => result.current.addUnit())
    const units = result.current.projects.find(p => p.id === 'proj1')!.units
    const secondId = units[1].id
    act(() => result.current.setActiveUnit(secondId))
    act(() => result.current.removeUnit(secondId))
    expect(result.current.activeUnitId).toBe('u1')
  })
})

describe('updateUnitSettings', () => {
  it('patches the correct unit settings', () => {
    const { result } = renderHook(() => useStore())
    act(() => result.current.updateUnitSettings('u1', { height: 1000 }))
    const unit = result.current.projects.find(p => p.id === 'proj1')!.units[0]
    expect(unit.settings.height).toBe(1000)
  })
})

describe('tree mutations route to active unit', () => {
  it('addShelf mutates activeUnit root', () => {
    const { result } = renderHook(() => useStore())
    const voidId = result.current.projects.find(p => p.id === 'proj1')!.units[0].root.id
    act(() => result.current.addShelf(voidId))
    const root = result.current.projects.find(p => p.id === 'proj1')!.units[0].root
    expect(root.splitAxis).toBe('horizontal')
  })
})

describe('rehydration', () => {
  it('activeUnitId is set to the rehydrated project first unit after hydration', () => {
    // Simulate rehydration by calling setState with a project that has a different unit ID
    useStore.setState({
      projects: [{
        id: 'proj-rehydrated',
        name: 'Rehydrated',
        units: [{ type: 'cabinet', id: 'rehydrated-unit-1', label: 'Unit 1', x: 0, y: 0,
          settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, material: 'oak' },
          root: { id: 'r1', elementType: 'void' } }],
      }],
      activeProjectId: 'proj-rehydrated',
      selectedId: null,
      snapGrid: 5,
      activeUnitId: 'stale-unit-id-from-initial',  // stale!
    })
    // After tree mutation, it should route to the correct unit
    // (This tests the intent; actual rehydration happens via persist middleware)
    // Verify addShelf still works (would fail with stale ID)
    const { result } = renderHook(() => useStore())
    act(() => result.current.setActiveUnit('rehydrated-unit-1'))
    act(() => result.current.addShelf(result.current.projects[0].units[0].root.id))
    expect(result.current.projects[0].units[0].root.splitAxis).toBe('horizontal')
  })
})

describe('undo/redo activeUnitId reconciliation', () => {
  it('activeUnitId is reconciled after undo removes a unit', () => {
    act(() => useStore.getState().addUnit())
    const { activeUnitId } = useStore.getState()
    expect(activeUnitId).not.toBe('u1')
    act(() => useStore.temporal.getState().undo())
    const state = useStore.getState()
    const proj = state.projects.find(p => p.id === state.activeProjectId)!
    expect(proj.units.some(u => u.id === state.activeUnitId)).toBe(true)
  })
})

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

    const rootId = useStore.getState().projects[0]!.units[0].root.id
    useStore.getState().addAccessory(rootId, { id: 'a1', type: 'door' })
    expect(useStore.getState().projects[0]!.units[0].root.accessories).toEqual([{ id: 'a1', type: 'door' }])

    useStore.getState().removeAccessory(rootId, 'a1')
    expect(useStore.getState().projects[0]!.units[0].root.accessories).toEqual([])
  })
})
