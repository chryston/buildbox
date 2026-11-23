/**
 * `Snaps ▾` for an Elevation View (#75 §7): three labelled rows, all on until switched off.
 *
 * The plan's own `SnapsMenu` holds nine rows and two selects; this one holds three checkboxes and
 * nothing else, because a vertical drag has no grid to snap to and no angle to step by. It follows the
 * same two rules that menu learned the hard way (#59 D12): the panel is its own overlay rather than a
 * `ToolbarMenu`, which closes the moment anything inside it is clicked, and every row is a `<label>`
 * wrapped around its own box with the words straight after it, so a click lands on the row it was
 * aimed at.
 *
 * These are UI-session settings — not undoable, not saved in the Project — so the rows write
 * `workspaceStore.verticalSnapSettings` and nothing else. A snap writes a number and keeps no link to
 * what it was taken from, which is exactly why switching one off cannot change a height set last week.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { STRINGS } from '../../strings'
import { useWorkspace } from '../workspaceStore'
import type { VerticalSnapSettings } from '../workspaceStore'

/** The three rows, in the order the issue lists them. */
const ROWS: readonly { key: keyof VerticalSnapSettings, label: string, testId: string }[] = [
  { key: 'floorHeights', label: STRINGS.elevationSnapFloorHeights, testId: 'elevation-snap-floor-heights' },
  { key: 'entities', label: STRINGS.elevationSnapEntities, testId: 'elevation-snap-entities' },
  { key: 'presetHeights', label: STRINGS.elevationSnapMounting, testId: 'elevation-snap-mounting' },
]

export function ElevationSnapsMenu(): ReactNode {
  const settings = useWorkspace((state) => state.verticalSnapSettings)
  const setEnabled = useWorkspace((state) => state.setVerticalSnapEnabled)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current?.contains(event.target as Node) ?? false) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="bb-toolbar-menu" ref={rootRef}>
      <button
        type="button"
        className="bb-toolbar-menu-trigger"
        data-testid="elevation-snaps-toggle"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((current) => !current)}
      >
        {`${STRINGS.snaps} ▾`}
      </button>
      {open && (
        <div className="bb-toolbar-menu-panel bb-snaps-panel" data-testid="elevation-snaps-menu" role="menu">
          {ROWS.map((row) => (
            <label key={row.key} className="bb-snaps-row" data-testid={row.testId}>
              <input
                type="checkbox"
                checked={settings[row.key]}
                onChange={(event) => setEnabled(row.key, event.target.checked)}
              />
              {row.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
