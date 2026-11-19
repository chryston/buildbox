/**
 * `Snaps ▾` — the nine object-snap rows (#59 §5, behaviours 22–25).
 *
 * One declarative component, mounted in both the Item Design editor's tool row and the Floor
 * workspace toolbar. Both read and write the same `workspaceStore.snapSettings`, so switching
 * grid spacing on the Floor changes what a draft snaps to a moment later — there is no second
 * copy of the state to fall out of step, and the rotate handle from #57 is reading the same
 * `angle` value it always did.
 *
 * The panel is its own overlay rather than a `ToolbarMenu`, because `ToolbarMenu` closes when
 * anything inside it is clicked. A settings panel that shuts the moment a box is ticked would
 * make the second box impossible to reach.
 *
 * Every row is a `<label>` around its own checkbox with the words straight after it. The
 * prototype hung all nine boxes off one shared label and let the text float to a second grid
 * column, so a click landed on the wrong row and the columns did not line up (#59 D12). The
 * spacing and increment selects sit *outside* the label: a select inside its own label would
 * toggle the box above it every time it was used.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useWorkspace } from './workspaceStore'
import type { SnapToggle } from './workspaceStore'

/** The grid spacings the row offers, in millimetres. */
const GRID_SPACINGS = [10, 50, 100, 500]

/** The angle increments the row offers, in degrees. */
const ANGLE_INCREMENTS = [5, 10, 15, 30, 45, 90]

/**
 * The nine rows, in the order the issue sets.
 *
 * `Wall faces` is here from the start even though it yields nothing until #64 gives Walls
 * faces: the row is the promise that the candidate source will arrive, and a person who
 * switched it off should not have it silently reappear when #64 lands.
 *
 * `angle` is not a `SnapToggle` — it carries an increment beside its switch — so a row names
 * its setting by whichever key of `SnapSettings` it writes.
 */
const ROWS: readonly { toggle: SnapToggle | 'angle'; label: string; testId: string }[] = [
  { toggle: 'grid', label: 'Grid', testId: 'snap-grid' },
  { toggle: 'endpoints', label: 'Endpoints and midpoints', testId: 'snap-endpoints' },
  { toggle: 'centres', label: 'Centres', testId: 'snap-centres' },
  { toggle: 'intersections', label: 'Intersections', testId: 'snap-intersections' },
  { toggle: 'wallFaces', label: 'Wall faces', testId: 'snap-wall-faces' },
  { toggle: 'axis', label: 'Horizontal and vertical', testId: 'snap-axis' },
  { toggle: 'angle', label: 'Angle', testId: 'snap-angle' },
  { toggle: 'perpendicular', label: 'Perpendicular', testId: 'snap-perpendicular' },
  { toggle: 'tangent', label: 'Tangent', testId: 'snap-tangent' },
]

/**
 * One checkbox and its words.
 *
 * The checkbox is the first child and the text the next, so the gap between them is one CSS
 * value and the Playwright check — the box's right edge within 8 px of the text's left edge,
 * the two vertical centres within 2 px — is testing the layout rather than a coincidence.
 */
function SnapRow(props: {
  toggle: SnapToggle | 'angle'
  label: string
  testId: string
  checked: boolean
  onChange: (enabled: boolean) => void
  children?: ReactNode
}): ReactNode {
  const { toggle, label, testId, checked, onChange, children } = props
  return (
    <div className="bb-snaps-row" data-testid={`snap-row-${toggle}`}>
      <label className="bb-snaps-label">
        <input
          type="checkbox"
          data-testid={testId}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      {children}
    </div>
  )
}

export function SnapsMenu(): ReactNode {
  const settings = useWorkspace((state) => state.snapSettings)
  const setSnapEnabled = useWorkspace((state) => state.setSnapEnabled)
  const setGridSpacing = useWorkspace((state) => state.setGridSpacing)
  const setAngleSnap = useWorkspace((state) => state.setAngleSnap)
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
        data-testid="snaps-menu"
        aria-expanded={open ? 'true' : 'false'}
        className="bb-workspace-tool-button"
        onClick={() => setOpen((current) => !current)}
      >
        Snaps <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="bb-workspace-menu bb-snaps-menu" data-testid="snaps-panel" aria-label="Snaps">
          {ROWS.map((row) => (
            <SnapRow
              key={row.toggle}
              toggle={row.toggle}
              label={row.label}
              testId={row.testId}
              checked={row.toggle === 'angle' ? settings.angle.enabled : settings[row.toggle]}
              onChange={(enabled) => {
                if (row.toggle === 'angle') setAngleSnap(enabled)
                else setSnapEnabled(row.toggle, enabled)
              }}
            >
              {row.toggle === 'grid' && (
                <select
                  data-testid="snap-grid-spacing"
                  className="bb-snaps-select"
                  value={settings.gridSpacingMm}
                  onChange={(event) => setGridSpacing(Number(event.target.value))}
                >
                  {GRID_SPACINGS.map((spacing) => (
                    <option key={spacing} value={spacing}>
                      {spacing} mm
                    </option>
                  ))}
                </select>
              )}
              {row.toggle === 'angle' && (
                <select
                  data-testid="snap-angle-increment"
                  className="bb-snaps-select"
                  value={settings.angle.incrementDeg}
                  onChange={(event) => setAngleSnap(settings.angle.enabled, Number(event.target.value))}
                >
                  {ANGLE_INCREMENTS.map((increment) => (
                    <option key={increment} value={increment}>
                      {increment}°
                    </option>
                  ))}
                </select>
              )}
            </SnapRow>
          ))}
        </div>
      )}
    </div>
  )
}
