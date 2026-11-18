/**
 * The workspace toolbar (#55 criteria 3, 4): one row, one fixed height, no wrapping.
 *
 * Groups are declared with the width they need; a `ResizeObserver` on the row decides
 * which groups fit inline, and the rest move *whole* into a `More ▾` overlay — a group
 * is never split, and the row's height never changes, whatever opens. Tool state and
 * selection changes never add or remove groups, so nothing shifts under the pointer;
 * the only group that comes and goes is `View & selection`, which exists only below
 * 1024 px where the rail is a drawer.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/** One toolbar control or control cluster, with the slot width it claims. */
export interface ToolbarGroup {
  readonly id: string
  /** Measured worst-case width in px, including the gap it sits in. */
  readonly width: number
  /** The label `More ▾` shows above the group when it overflows. */
  readonly label: string
  readonly content: ReactNode
}

/** The `More ▾` button itself: reserved whenever any group overflows. */
const MORE_WIDTH = 90

export function WorkspaceToolbar({ groups }: { groups: readonly ToolbarGroup[] }): ReactNode {
  const rowRef = useRef<HTMLDivElement>(null)
  const [rowWidth, setRowWidth] = useState(0)

  useLayoutEffect(() => {
    const el = rowRef.current
    if (el === null) return
    setRowWidth(el.clientWidth)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setRowWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const padding = 24
  const gap = 8
  const available = Math.max(0, rowWidth - padding)
  const total = groups.reduce((sum, group) => sum + group.width, 0)
    + Math.max(0, groups.length - 1) * gap
  const overflowIndex = total <= available
    ? groups.length
    : (() => {
      let used = MORE_WIDTH
      let index = 0
      for (; index < groups.length; index += 1) {
        const next = used + groups[index].width + (index > 0 ? gap : 0)
        if (next > available) break
        used = next
      }
      return index
    })()

  const inline = groups.slice(0, overflowIndex)
  const overflowed = groups.slice(overflowIndex)

  return (
    <div ref={rowRef} className="bb-workspace-toolbar" data-testid="workspace-toolbar">
      {inline.map((group) => (
        <div key={group.id} className="bb-workspace-toolbar-group" data-testid={`toolbar-group-${group.id}`}>
          {group.content}
        </div>
      ))}
      {overflowed.length > 0 && (
        <ToolbarMenu label="More" testId="toolbar-more">
          {overflowed.map((group) => (
            <div key={group.id} data-testid={`toolbar-more-${group.id}`}>
              <div className="bb-workspace-menu-heading">{group.label}</div>
              {group.content}
            </div>
          ))}
        </ToolbarMenu>
      )}
    </div>
  )
}

/**
 * A toolbar dropdown: the panel is an absolutely-positioned overlay, so opening it
 * changes neither the row's height nor the position of any other control.
 */
export function ToolbarMenu(props: {
  label: string
  testId: string
  disabled?: boolean
  align?: 'left' | 'right'
  children: ReactNode
}): ReactNode {
  const { label, testId, disabled = false, align = 'left', children } = props
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="bb-workspace-menu-anchor" ref={anchorRef}>
      <button
        type="button"
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        disabled={disabled}
        className="bb-workspace-tool-button"
        onClick={() => setOpen((current) => !current)}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          data-testid={`${testId}-menu`}
          className="bb-workspace-menu"
          style={align === 'right' ? { left: 'auto', right: 0 } : undefined}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** A menu row that acts. `onSelect` runs after the menu has closed itself. */
export function ToolbarMenuItem(props: {
  label: string
  testId?: string
  disabled?: boolean
  onSelect: () => void
}): ReactNode {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={props.testId}
      disabled={props.disabled}
      className="bb-workspace-menu-item"
      onClick={props.onSelect}
    >
      {props.label}
    </button>
  )
}
