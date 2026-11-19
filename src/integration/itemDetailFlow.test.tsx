/**
 * Item Detail as the only route between the two editors (#57 §6, §7).
 *
 * The `Cabinet ⇄ Floor Plan` switcher is gone, so this file pins what replaced it: opening a
 * Placed Item's design shows that design on its own, its `Placements` list spans Floors because
 * a Design is Project-wide while a Placed Item is not (#25), and every way out of the view is
 * navigation — it selects a Placed Item and moves the Floor pointer, and never edits anything.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { Floor, PlanView, PlacedItem, Project } from '../domain'
import { openTestView, renderWithBindings as render, type TestView } from '../ui/legacy/testing'
import { testCabinet, testProject } from '../session/testing'
import { workspaceStore } from '../ui'

/** The same Design placed on a second Floor, so `Placements` has to group by Floor. */
function twoFloors(base: Project): Project {
  const cabinet = testCabinet(base)
  const floor: Floor = { id: 'p-1-loft', name: 'Loft', planImage: null }
  const view: PlanView = {
    id: 'p-1-loft-view',
    kind: 'plan',
    floorId: floor.id,
    name: 'Floor Plan',
    isDefault: true,
    showPlanImage: true,
  }
  const placed: PlacedItem = {
    id: 'p-1-loft-place',
    itemDesignId: cabinet.id,
    floorId: floor.id,
    translation: { x: 1200, y: 800 },
    rotationDeg: 90,
    baseElevation: 0,
  }
  return {
    ...base,
    floors: [...base.floors, floor],
    views: [...base.views, view],
    existingModel: { ...base.existingModel, placedItems: [...base.existingModel.placedItems, placed] },
  }
}

describe('Item Detail', () => {
  let view: TestView

  beforeEach(async () => {
    view = await openTestView(twoFloors(testProject('p-1')))
  })

  it('lists every placement of the design, grouped by Floor', async () => {
    render(<App />, view)
    const list = await screen.findByTestId('item-detail-placements')
    expect(screen.getByTestId('placement-group-p-1-floor')).toBeInTheDocument()
    expect(screen.getByTestId('placement-group-p-1-loft')).toBeInTheDocument()
    expect(screen.getByTestId('placement-row-p-1-place')).toBeInTheDocument()
    expect(screen.getByTestId('placement-row-p-1-loft-place')).toBeInTheDocument()
    expect(list).toHaveTextContent('Loft')
  })

  it('choosing a placement leaves Item Detail on that Floor with that item selected', async () => {
    const user = userEvent.setup()
    render(<App />, view)
    await user.click(await screen.findByTestId('placement-row-p-1-loft-place'))

    expect(screen.queryByTestId('item-detail-view')).not.toBeInTheDocument()
    expect(screen.getByTestId('floor-workspace')).toBeInTheDocument()
    expect(screen.getByTestId('placed-object-p-1-loft-place')).toBeInTheDocument()
    expect(screen.getByTestId('selection-inspector')).toBeInTheDocument()
    const state = workspaceStore.getState()
    expect(state.activeFloorId).toBe('p-1-loft')
    expect(state.selection).toBe('p-1-loft-place')
  })

  it('back returns to the Placed Item it was opened from', async () => {
    const user = userEvent.setup()
    render(<App />, view)
    await user.click(await screen.findByTestId('item-detail-back'))
    expect(screen.getByTestId('floor-workspace')).toBeInTheDocument()
    expect(screen.getByTestId('selection-inspector')).toBeInTheDocument()
    expect(workspaceStore.getState().activeFloorId).toBe('p-1-floor')
    expect(workspaceStore.getState().selection).toBe('p-1-place')
  })

  it('offers no control that switches between the two views', async () => {
    const user = userEvent.setup()
    render(<App />, view)
    await screen.findByTestId('item-detail-view')
    expect(screen.queryByRole('button', { name: /^cabinet$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /floor plan/i })).not.toBeInTheDocument()
    await user.click(screen.getByTestId('item-detail-back'))
    await waitFor(() => expect(screen.getByTestId('floor-workspace')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^cabinet$/i })).not.toBeInTheDocument()
  })
})
