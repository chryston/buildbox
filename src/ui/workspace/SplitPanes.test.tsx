/**
 * The split workspace, as the shell draws it (#75 §2, criteria 1, 3, 4).
 *
 * Three things are worth a test each, because each is a rule a screenshot cannot settle: the rule
 * between the panes answers to a drag and to the arrow keys with the same clamped number; a host under
 * `STACK_BELOW_PX` wide puts one pane above the other instead of two unreadable strips side by side; and
 * `Show alone` takes the other pane — and the rule — off the screen entirely, rather than leaving a
 * collapsed one behind.
 *
 * The panes are filled with words, not with canvases: what a pane holds is its caller's business, and
 * these assertions are only about the frame around it. Widths are stubbed because jsdom lays nothing out
 * — the mapping from a pointer to a share, and from a host width to a stack, is what is under test.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { STRINGS } from '../strings'
import { STACK_BELOW_PX, SplitPanes } from './SplitPanes'
import type { PaneSlot, SplitPanesProps } from './SplitPanes'

const VIEW_ID = 'el-004'

const planSlot = (over: Partial<PaneSlot> = {}): PaneSlot => ({
  id: 'plan',
  header: 'Floor 1',
  body: 'the plan canvas',
  active: true,
  onFocus: () => undefined,
  onShowAlone: () => undefined,
  ...over,
})

const elevationSlot = (over: Partial<PaneSlot> = {}): PaneSlot => ({
  id: VIEW_ID,
  header: 'Kitchen elevation · No Design Option · Existing',
  body: 'the elevation canvas',
  active: false,
  onFocus: () => undefined,
  onShowAlone: () => undefined,
  onClose: () => undefined,
  ...over,
})

/**
 * jsdom has no `PointerEvent`, so a drag is dispatched as the mouse event it stands in for, and lays out
 * nothing, so the host is handed the box the share is measured against: 1 000 px wide and 700 px tall,
 * starting at the window's own top-left corner.
 */
const open = (over: Partial<SplitPanesProps> = {}) => {
  const onRatio = vi.fn()
  render(
    <SplitPanes
      plan={planSlot()}
      elevation={elevationSlot()}
      ratio={0.5}
      onRatio={onRatio}
      alone={null}
      onAlone={() => undefined}
      {...over}
    />,
  )
  const host = screen.getByTestId('split-host')
  host.getBoundingClientRect = (): DOMRect => ({
    top: 0, left: 0, right: 1000, bottom: 700, width: 1000, height: 700, x: 0, y: 0, toJSON: () => ({}),
  })
  // The rule keeps the pointer between the press and the release, which is what lets a drag leave the
  // 6 px of hit area behind without losing the gesture. jsdom has no pointer capture to keep with.
  const divider = screen.queryByTestId('split-divider')
  if (divider !== null) divider.setPointerCapture = () => undefined
  /** Every share the drag has written, in the order the gesture wrote them. */
  const ratioShares = (): number[] => onRatio.mock.calls.map((call) => call[0] as number)
  return { ratioShares }
}

const pointer = (el: Element, type: string, clientX: number, clientY = 10): void => {
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }))
}

/** A press on the rule and the moves of a drag, in the order the gesture happens. */
const dragDivider = (positions: readonly [number, ...number[]], axis: 'x' | 'y' = 'x'): void => {
  const divider = screen.getByTestId('split-divider')
  const at = (value: number): [number, number] => (axis === 'x' ? [value, 10] : [500, value])
  const [first, ...rest] = positions
  const last = rest.length === 0 ? first! : rest[rest.length - 1]!
  pointer(divider, 'pointerdown', ...at(first!))
  for (const value of rest) pointer(divider, 'pointermove', ...at(value))
  pointer(divider, 'pointerup', ...at(last))
}

/** The host's own width, which is the only number the stack is decided by, set before the render. */
const withHostWidth = (width: number, run: () => void): void => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => width })
  try {
    run()
  } finally {
    if (descriptor !== undefined) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', descriptor)
  }
}

describe('the two panes and the rule between them', () => {
  it('puts the Plan pane and the Elevation View pane side by side', () => {
    open()
    expect(screen.getByTestId('split-pane-plan')).toBeTruthy()
    expect(screen.getByTestId(`split-pane-${VIEW_ID}`)).toBeTruthy()
    expect(screen.getByTestId('split-pane-body-plan').textContent).toBe('the plan canvas')
    expect(screen.getByTestId(`split-pane-body-${VIEW_ID}`).textContent).toBe('the elevation canvas')
    // The header carries the words the caller wrote: the view, the Option it looks through, the Display.
    expect(screen.getByTestId(`split-pane-title-${VIEW_ID}`).textContent)
      .toBe('Kitchen elevation · No Design Option · Existing')
  })

  it('is a separator the keyboard can reach, and says where the rule stands', () => {
    open({ ratio: 0.62 })
    const divider = screen.getByTestId('split-divider')
    expect(divider.getAttribute('role')).toBe('separator')
    expect(divider.getAttribute('aria-label')).toBe(STRINGS.splitDivider)
    expect(divider.getAttribute('aria-orientation')).toBe('vertical')
    expect(divider.getAttribute('aria-valuenow')).toBe('62')
    expect(divider.getAttribute('tabindex')).toBe('0')
  })

  it('marks the active pane in its header', () => {
    open({ elevation: elevationSlot({ active: true }) })
    expect(screen.getByTestId('split-pane-header-plan').getAttribute('data-active')).toBe('true')
    expect(screen.getByTestId(`split-pane-header-${VIEW_ID}`).getAttribute('data-active')).toBe('true')
  })

  it('marks the pane that is not active as not active', () => {
    open()
    expect(screen.getByTestId(`split-pane-header-${VIEW_ID}`).getAttribute('data-active')).toBe('false')
  })

  it('hands the focus to a pane as the pointer enters it', () => {
    const onFocus = vi.fn()
    open({ plan: planSlot({ onFocus }) })
    pointer(screen.getByTestId('split-pane-plan'), 'pointerdown', 200)
    expect(onFocus).toHaveBeenCalledTimes(1)
  })

  it('gives `Close` to the Elevation pane and withholds it from the Plan one', () => {
    open()
    expect(screen.getByTestId(`split-close-${VIEW_ID}`)).toBeTruthy()
    // The Plan pane is never closed, only switched away from: a Close that could empty the workspace
    // of every picture is a dead end with a label on it.
    expect(screen.queryByTestId('split-close-plan')).toBeNull()
  })

  it('closes the Elevation View when its `Close` is pressed', () => {
    const onClose = vi.fn()
    open({ elevation: elevationSlot({ onClose }) })
    fireEvent.click(screen.getByTestId(`split-close-${VIEW_ID}`))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('the rule', () => {
  it('follows the pointer and reports the share on every move and once more on release', () => {
    const { ratioShares } = open()
    dragDivider([500, 300, 700])
    expect(ratioShares()).toEqual([0.5, 0.3, 0.7, 0.7])
  })

  it('keeps either pane from being dragged to nothing', () => {
    const { ratioShares } = open()
    dragDivider([500, 0, 500, 1000])
    // 0 px is a fifth of the host and 1 000 px is four fifths: both panes survive the drag.
    expect(ratioShares()).toEqual([0.5, 0.2, 0.5, 0.8, 0.8])
  })

  it('answers the arrow keys with the same number a drag writes', () => {
    const { ratioShares } = open()
    const divider = screen.getByTestId('split-divider')
    fireEvent.keyDown(divider, { key: 'ArrowLeft' })
    fireEvent.keyDown(divider, { key: 'ArrowRight' })
    expect(ratioShares()).toEqual([0.48, 0.52])
  })

  it('stops nudging at the clamp instead of running past it', () => {
    const { ratioShares } = open({ ratio: 0.8 })
    fireEvent.keyDown(screen.getByTestId('split-divider'), { key: 'ArrowRight' })
    expect(ratioShares()).toEqual([0.8])
  })

  it('ignores a key that is not its own', () => {
    const { ratioShares } = open()
    fireEvent.keyDown(screen.getByTestId('split-divider'), { key: 'PageDown' })
    expect(ratioShares()).toEqual([])
  })
})

describe('a host too narrow for two panes side by side', () => {
  it('stacks them below the threshold and turns the rule horizontal', () => {
    withHostWidth(STACK_BELOW_PX - 160, () => {
      open()
      expect(screen.getByTestId('split-host').getAttribute('data-stacked')).toBe('true')
      expect(screen.getByTestId('split-divider').getAttribute('aria-orientation')).toBe('horizontal')
      // The panes are told too, because a pane that draws its own ruler has to know it is now lying
      // across the picture rather than beside it.
      expect(screen.getByTestId('split-pane-plan').getAttribute('data-stacked')).toBe('true')
    })
  })

  it('keeps them side by side above the threshold', () => {
    withHostWidth(STACK_BELOW_PX + 240, () => {
      open()
      expect(screen.getByTestId('split-host').getAttribute('data-stacked')).toBe('false')
      expect(screen.getByTestId('split-divider').getAttribute('aria-orientation')).toBe('vertical')
    })
  })

  it('measures the share down the host once the rule lies across it', () => {
    withHostWidth(STACK_BELOW_PX - 160, () => {
      const { ratioShares } = open()
      // The stacked case is the one the axis matters in: a vertical drag is the only gesture the
      // picture offers, and reading `clientX` there would leave the rule stuck.
      dragDivider([350, 210], 'y')
      // The release writes the share once more, which is where the caller's device preference is saved.
      expect(ratioShares()).toEqual([0.5, 0.3, 0.3])
    })
  })
})

describe('one pane alone', () => {
  it('takes the other pane and the rule off the screen', () => {
    open({ alone: 'elevation' })
    expect(screen.queryByTestId('split-pane-plan')).toBeNull()
    expect(screen.queryByTestId('split-divider')).toBeNull()
    expect(screen.getByTestId(`split-pane-${VIEW_ID}`)).toBeTruthy()
  })

  it('does the same from the other side', () => {
    open({ alone: 'plan' })
    expect(screen.queryByTestId(`split-pane-${VIEW_ID}`)).toBeNull()
    expect(screen.queryByTestId('split-divider')).toBeNull()
    expect(screen.getByTestId('split-pane-plan')).toBeTruthy()
  })

  it('asks for both again when the lone pane is told to show alone once more', () => {
    const onAlone = vi.fn()
    open({ alone: 'plan', onAlone })
    fireEvent.click(screen.getByTestId('split-alone-plan'))
    expect(onAlone).toHaveBeenCalledWith(null)
  })

  it('asks the pane for itself when both are on screen', () => {
    const onShowAlone = vi.fn()
    const onAlone = vi.fn()
    open({ elevation: elevationSlot({ onShowAlone }), onAlone })
    fireEvent.click(screen.getByTestId(`split-alone-${VIEW_ID}`))
    expect(onShowAlone).toHaveBeenCalledTimes(1)
    expect(onAlone).not.toHaveBeenCalled()
  })
})

describe('a workspace with nothing to split', () => {
  it('leaves the rule out and gives the Plan pane the whole host', () => {
    open({ elevation: null })
    expect(screen.queryByTestId('split-divider')).toBeNull()
    expect(screen.queryByTestId(`split-pane-${VIEW_ID}`)).toBeNull()
    expect(screen.getByTestId('split-pane-plan').getAttribute('data-stacked')).toBe('false')
  })
})
