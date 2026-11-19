/**
 * The two dialogs the inspector and the library open (#57 §2, §3).
 *
 * `New item…` authors an Item Design nobody has placed yet and places one copy of it — the
 * only way to reach the catalogue-free shapes the old `Custom` list held. `Fork design…`
 * copies the selected Placed Item's design so one placement can be changed without touching
 * the others (D11), which is why its copy of the warning says what a fork is for.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { PLAN_SWATCHES } from './planColors'

/**
 * The default fork name: `<name> 2`, or the next number that no design in the Project
 * already uses. The person can type over it; the handler only needs a name.
 */
export function nextDesignName(existing: readonly string[], name: string): string {
  const taken = new Set(existing)
  if (!taken.has(name)) return name
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${name} ${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return `${name} 1000`
}

function DialogShell(props: { testId: string; title: string; children: ReactNode }): ReactNode {
  return (
    <div className="bb-workspace-dialog-backdrop" data-testid={props.testId}>
      <div className="bb-workspace-dialog" role="dialog" aria-modal="true" aria-label={props.title}>
        <h2 className="bb-workspace-dialog-title">{props.title}</h2>
        {props.children}
      </div>
    </div>
  )
}

export function NewItemDialog(props: {
  onConfirm: (label: string, width: number, depth: number, color: string) => void
  onClose: () => void
}): ReactNode {
  const [label, setLabel] = useState('')
  const [width, setWidth] = useState('600')
  const [depth, setDepth] = useState('400')
  const [color, setColor] = useState<string>(PLAN_SWATCHES[0] ?? '')
  const widthMm = Number(width)
  const depthMm = Number(depth)
  const valid = label.trim().length > 0 && Number.isFinite(widthMm) && widthMm >= 50
    && Number.isFinite(depthMm) && depthMm >= 50

  return (
    <DialogShell testId="new-item-dialog" title="New item">
      <label className="bb-workspace-field-label" htmlFor="new-item-name">Name</label>
      <input
        id="new-item-name"
        data-testid="new-item-name"
        className="bb-workspace-input"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
      />
      <label className="bb-workspace-field-label" htmlFor="new-item-width">Width (mm)</label>
      <input
        id="new-item-width"
        data-testid="new-item-width"
        className="bb-workspace-input"
        type="number"
        value={width}
        onChange={(event) => setWidth(event.target.value)}
      />
      <label className="bb-workspace-field-label" htmlFor="new-item-depth">Depth (mm)</label>
      <input
        id="new-item-depth"
        data-testid="new-item-depth"
        className="bb-workspace-input"
        type="number"
        value={depth}
        onChange={(event) => setDepth(event.target.value)}
      />
      <label className="bb-workspace-field-label">Colour</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {PLAN_SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            data-testid={`new-item-swatch-${swatch}`}
            aria-label={`Colour ${swatch}`}
            aria-pressed={color === swatch ? 'true' : 'false'}
            className="bb-workspace-swatch"
            style={{ background: swatch }}
            onClick={() => setColor(swatch)}
          />
        ))}
      </div>
      <div className="bb-workspace-dialog-actions">
        <button
          type="button"
          data-testid="new-item-confirm"
          className="bb-workspace-primary-button"
          disabled={!valid}
          onClick={() => props.onConfirm(label.trim(), widthMm, depthMm, color)}
        >
          Place
        </button>
        <button
          type="button"
          data-testid="new-item-cancel"
          className="bb-workspace-secondary-button"
          onClick={props.onClose}
        >
          Cancel
        </button>
      </div>
    </DialogShell>
  )
}

export function ForkDesignDialog(props: {
  designName: string
  /** Every design name in the Project, so the default never collides. */
  taken: readonly string[]
  onConfirm: (name: string) => void
  onClose: () => void
}): ReactNode {
  const [name, setName] = useState(() => nextDesignName(props.taken, props.designName))
  const valid = name.trim().length > 0

  return (
    <DialogShell testId="fork-design-dialog" title="Fork design">
      <p className="bb-workspace-dialog-note" data-testid="fork-design-note">
        Only this placement will use the new design.
      </p>
      <label className="bb-workspace-field-label" htmlFor="fork-design-name">Name</label>
      <input
        id="fork-design-name"
        data-testid="fork-design-name"
        className="bb-workspace-input"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="bb-workspace-dialog-actions">
        <button
          type="button"
          data-testid="fork-design-confirm"
          className="bb-workspace-primary-button"
          disabled={!valid}
          onClick={() => props.onConfirm(name.trim())}
        >
          Fork
        </button>
        <button
          type="button"
          data-testid="fork-design-cancel"
          className="bb-workspace-secondary-button"
          onClick={props.onClose}
        >
          Cancel
        </button>
      </div>
    </DialogShell>
  )
}
