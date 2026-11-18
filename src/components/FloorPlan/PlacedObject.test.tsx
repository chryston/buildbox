import type { ReactElement } from 'react'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FloorPlanObject } from '../../types'
import { projectFloorPlan } from '../../ui/legacy/projectView'
import { uiStore } from '../../ui/legacy/uiStore'
import { openTestView, renderWithBindings as render, type TestView } from '../../ui/legacy/testing'
import PlacedObject from './PlacedObject'

// jsdom doesn't implement setPointerCapture; silence the unhandled error
Element.prototype.setPointerCapture = vi.fn()

describe('PlacedObject', () => {
  let view: TestView
  beforeEach(async () => {
    view = await openTestView()
    // One placement, written the way the sidebar writes it: an Intent, not a seeded object, so
    // the fixture is a Project the converter would accept (#49).
    await view.dispatch('plan.addObject', { floorId: 'p-1-floor', catalogKey: 'sofa-2' })
  })

  /** The one placement on the Floor, read the way the view reads it. */
  function placed(): FloorPlanObject {
    const [object] = projectFloorPlan(view.project(), null).objects
    if (object === undefined) throw new Error('the Floor holds no placement')
    return object
  }

  function renderInSvg(ui: ReactElement): void {
    render(<svg viewBox="0 0 3000 2000">{ui}</svg>, view)
  }

  it('renders the label of the placement it shows', () => {
    const object = placed()
    renderInSvg(<PlacedObject id={object.id} zoom={1} />)
    expect(screen.getByText(object.label)).toBeInTheDocument()
  })

  it('clicking object selects it', async () => {
    const user = userEvent.setup()
    const { id } = placed()
    renderInSvg(<PlacedObject id={id} zoom={1} />)
    await user.click(screen.getByTestId(`placed-object-${id}`))
    expect(uiStore.getState().floorPlanSelectedId).toBe(id)
  })

  it('shows resize handles when selected', () => {
    const { id } = placed()
    act(() => uiStore.getState().selectFloorPlanObject(id))
    renderInSvg(<PlacedObject id={id} zoom={1} />)
    expect(screen.getAllByTestId(/^resize-handle-/)).toHaveLength(8)
  })

  it('hides resize handles when not selected', () => {
    renderInSvg(<PlacedObject id={placed().id} zoom={1} />)
    expect(screen.queryAllByTestId(/^resize-handle-/)).toHaveLength(0)
  })
})
