/**
 * The split workspace (#75 §2, criteria 1, 3, 4): the Plan pane and — when an Elevation View is open —
 * its pane beside it, with one draggable rule between them and `Show alone` on each.
 *
 * The component is presentational and knows nothing about what a pane holds: the caller hands over two
 * {@link PaneSlot}s whose `header` and `body` it renders as they arrive. That is what lets the Elevation
 * pane be #75's while the Plan pane stays the canvas #55 shipped, and what keeps the split out of
 * `FloorWorkspace`'s 2 300 lines of wiring.
 *
 * Three things are owned here because they are the split's own:
 *
 * - **The rule.** A pointer drag sets the Plan pane's share of the host's measured width; `ArrowLeft`
 *   and `ArrowRight` nudge the same number by 2%. It is a focusable `role="separator"`, so the keyboard
 *   reaches the split exactly as the pointer does. The share is clamped to 0.2..0.8 — a pane that can be
 *   dragged to nothing is a pane that can only be found again by guessing.
 * - **The stack.** Below `STACK_BELOW_PX` of host width two side-by-side panes are two narrow strips, so
 *   the host is marked `data-stacked="true"` and CSS puts one above the other with the rule turned
 *   horizontal. The number is measured, never read from the window: the split lives inside the canvas
 *   host, whose width is what the rail and the notes slot leave it.
 * - **Alone.** `Show alone` asks the caller for one pane in the centre; the other is not rendered at all,
 *   and neither is the rule, so a lone pane is the whole host rather than a wide pane with a gap in it.
 *
 * The ratio is reported on every move and once more on release, because the caller writes the device
 * preference fire-and-forget and a drag that ends without a final write leaves the next session at a
 * width nobody chose.
 */
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { STRINGS } from '../strings'
import './workspace.css'

/** One pane as the caller describes it: what it is called, what it holds, and what its controls do. */
export interface PaneSlot {
  /** Stable key (the view id); appears in data-testid suffixes. */
  id: string
  /** The pane's header content, already worded by the caller. */
  header: ReactNode
  body: ReactNode
  /** True = the active view: this pane gets the focus-border token. */
  active: boolean
  onFocus(): void
  /** `Show alone`: make this the only pane in the centre. */
  onShowAlone(): void
  /** Absent = no Close button (the Plan pane has none; the Elevation pane does). */
  onClose?(): void
}

export interface SplitPanesProps {
  plan: PaneSlot
  elevation: PaneSlot | null
  /** The plan pane's share of the host width, 0..1. Clamped by the component to 0.2..0.8. */
  ratio: number
  onRatio(ratio: number): void
  /** Which pane is shown alone; `null` shows both side by side (or stacked). */
  alone: 'plan' | 'elevation' | null
  onAlone(alone: 'plan' | 'elevation' | null): void
  children?: never
}

/** Below this host width the two panes stack instead of standing side by side (#75 criterion 3). */
export const STACK_BELOW_PX = 960

/** The narrowest share either pane may be dragged to, and its mirror. */
const RATIO_MIN = 0.2
const RATIO_MAX = 0.8

/** One `ArrowLeft` / `ArrowRight` press, as a share of the host. */
const KEY_NUDGE = 0.02

const clampRatio = (ratio: number): number => Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio))

/**
 * One pane: its header (title, `Show alone`, and `Close` when the caller gave it a way to close), then
 * its body. The header carries `data-active` because that is where the eye checks which pane it is in,
 * and the CSS focus border hangs off the same attribute.
 *
 * `onShowAlone` is resolved by the parent rather than read off the slot, because the same button means
 * the opposite thing once its pane is the only one on screen: pressed again, it asks for both.
 */
function PaneFrame(props: { slot: PaneSlot; grow: number; stacked: boolean; onShowAlone(): void }): ReactNode {
  const { slot, grow, stacked, onShowAlone } = props
  return (
    <div
      className="bb-split-pane"
      data-testid={`split-pane-${slot.id}`}
      data-active={slot.active ? 'true' : 'false'}
      data-stacked={stacked ? 'true' : 'false'}
      style={{ flexGrow: grow, flexShrink: 1, flexBasis: 0 }}
      onPointerDown={slot.onFocus}
    >
      <header
        className="bb-split-pane-header"
        data-testid={`split-pane-header-${slot.id}`}
        data-active={slot.active ? 'true' : 'false'}
      >
        <span className="bb-split-pane-title" data-testid={`split-pane-title-${slot.id}`}>{slot.header}</span>
        <div className="bb-split-pane-actions">
          <button
            type="button"
            className="bb-workspace-tool-button bb-split-pane-button"
            data-testid={`split-alone-${slot.id}`}
            onClick={onShowAlone}
          >
            {STRINGS.showAlone}
          </button>
          {slot.onClose !== undefined && (
            <button
              type="button"
              className="bb-workspace-tool-button bb-split-pane-button"
              data-testid={`split-close-${slot.id}`}
              onClick={slot.onClose}
            >
              {STRINGS.closePane}
            </button>
          )}
        </div>
      </header>
      <div className="bb-split-pane-body" data-testid={`split-pane-body-${slot.id}`}>{slot.body}</div>
    </div>
  )
}

/** The Plan pane and the Elevation View pane, with the rule between them. */
export function SplitPanes(props: SplitPanesProps): ReactNode {
  const { plan, elevation, ratio, onRatio, alone, onAlone } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const [hostWidth, setHostWidth] = useState(0)
  const dragging = useRef(false)
  const dragged = useRef(clampRatio(ratio))

  // The host's own width, because the split is inside the canvas host and the window's width is not it.
  // `ResizeObserver` is what a real host reports with; where there is none — jsdom lays nothing out and
  // measures nothing — `offsetWidth` is read once, which is the number a test gives it.
  useEffect(() => {
    const el = hostRef.current
    if (el === null) return
    const measure = (): void => setHostWidth(el.offsetWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const stacked = hostWidth > 0 && hostWidth < STACK_BELOW_PX
  const share = clampRatio(ratio)
  const shown = elevation !== null && alone !== 'plan'
  const sideBySide = shown && alone !== 'elevation'

  /**
   * The share the pointer is standing on, measured against the host it is inside.
   *
   * The axis is the host's, not the pointer's habit: stacked, the divider lies across the panes and
   * the share is how far down it sits, so a vertical drag is what grows the Plan pane. Reading
   * `clientX` there would make the divider draggable only sideways, which is the gesture the picture
   * does not show.
   */
  const shareAt = (clientX: number, clientY: number): number => {
    const el = hostRef.current
    if (el === null) return dragged.current
    const rect = el.getBoundingClientRect()
    const extent = stacked ? rect.height : rect.width
    if (extent <= 0) return dragged.current
    return clampRatio(((stacked ? clientY : clientX) - (stacked ? rect.top : rect.left)) / extent)
  }

  const onDividerPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    dragging.current = true
    dragged.current = shareAt(event.clientX, event.clientY)
    event.currentTarget.setPointerCapture(event.pointerId)
    onRatio(dragged.current)
  }

  const onDividerPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    const next = shareAt(event.clientX, event.clientY)
    if (next === dragged.current) return
    dragged.current = next
    onRatio(next)
  }

  // The gesture's last word: the caller writes the device preference here, once, rather than on every
  // pixel of the drag.
  const onDividerPointerUp = (): void => {
    if (!dragging.current) return
    dragging.current = false
    onRatio(dragged.current)
  }

  // The keys follow the divider's own orientation, which is what `aria-orientation` tells a screen
  // reader to expect: a separator that lies across the panes answers to up and down.
  const onDividerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const back = stacked ? 'ArrowUp' : 'ArrowLeft'
    const on = stacked ? 'ArrowDown' : 'ArrowRight'
    const step = event.key === back ? -KEY_NUDGE : event.key === on ? KEY_NUDGE : 0
    if (step === 0) return
    event.preventDefault()
    onRatio(clampRatio(share + step))
  }

  return (
    <div className="bb-split-host" data-testid="split-host" data-stacked={stacked ? 'true' : 'false'} ref={hostRef}>
      {alone !== 'elevation' && (
        <PaneFrame
          slot={plan}
          stacked={stacked}
          grow={sideBySide ? share : 1}
          onShowAlone={alone === 'plan' ? () => onAlone(null) : plan.onShowAlone}
        />
      )}
      {sideBySide && (
        <div
          className="bb-split-divider"
          data-testid="split-divider"
          role="separator"
          tabIndex={0}
          aria-label={STRINGS.splitDivider}
          aria-orientation={stacked ? 'horizontal' : 'vertical'}
          aria-valuemin={Math.round(RATIO_MIN * 100)}
          aria-valuemax={Math.round(RATIO_MAX * 100)}
          aria-valuenow={Math.round(share * 100)}
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerUp}
          onPointerCancel={onDividerPointerUp}
          onKeyDown={onDividerKeyDown}
        />
      )}
      {shown && elevation !== null && (
        <PaneFrame
          slot={elevation}
          stacked={stacked}
          grow={sideBySide ? 1 - share : 1}
          onShowAlone={alone === 'elevation' ? () => onAlone(null) : elevation.onShowAlone}
        />
      )}
    </div>
  )
}
