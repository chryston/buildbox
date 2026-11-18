/**
 * What a Floor or Plan View move does to the selection (#56).
 *
 * The rule is one sentence: a selection belongs to the pair it was made on. Opening another
 * pair drops it — the Placed Item is drawn on the Floor that was left behind — while arriving
 * back at the pair already open keeps it, which is exactly what undo and redo do: they
 * navigate to the item they just changed, and a selection lost there cannot be edited back.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { workspaceStore } from './workspaceStore'

const state = (): ReturnType<typeof workspaceStore.getState> => workspaceStore.getState()

describe('the selection across a Floor or Plan View move', () => {
  beforeEach(() => {
    workspaceStore.getState().reset()
  })

  it('survives arriving back at the pair already open, which is what undo and redo do (#26)', () => {
    state().setActiveFloor('floor-1', 'view-1')
    state().select('placed-1')
    state().setActiveFloor('floor-1', 'view-1')
    expect(state().selection).toBe('placed-1')
    state().setActiveView('floor-1', 'view-1')
    expect(state().selection).toBe('placed-1')
  })

  it('survives a locator that names no view, meaning the Floor it is already on', () => {
    state().setActiveFloor('floor-1', 'view-1')
    state().select('placed-1')
    state().setActiveFloor('floor-1', null)
    expect(state().selection).toBe('placed-1')
  })

  it('is dropped when another Floor opens, because its drawing is on the one left behind', () => {
    state().setActiveFloor('floor-1', 'view-1')
    state().select('placed-1')
    state().setActiveFloor('floor-2', 'view-2')
    expect(state().selection).toBeNull()
  })

  it('is dropped when a named view opens on the same Floor', () => {
    state().setActiveFloor('floor-1', 'view-1')
    state().select('placed-1')
    state().setActiveView('floor-1', 'view-3')
    expect(state().selection).toBeNull()
  })

  it('is dropped when no Floor was open yet', () => {
    state().select('placed-1')
    state().setActiveFloor('floor-1', 'view-1')
    expect(state().selection).toBeNull()
  })
})
