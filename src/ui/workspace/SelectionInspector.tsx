/**
 * The selection inspector (#55 criterion 5, #57 §2–3): the Placed Item first, then the
 * Item Design it references, in the Project's display unit.
 *
 * The split is the whole point. `Position X`, `Position Y` and `Rotation` belong to the
 * Placed Item and commit as they stand; `Width`, `Depth`, `Colour`, the name and the
 * `Item Origin` belong to the Item Design and are shared, so with more than one placement
 * each of them opens the preview (D3) — the text says `Affects N placements` and nothing is
 * written until `Apply`. A Placed Item owns no pivot and no size, so nothing here edits one.
 *
 * Numbers are shown through `displayUnits` — a 605.5 mm width reads `606` at mm / 0 dp — and
 * read back through the same pair, so `60.55` cm is exactly 605.5 mm. Each field keeps the
 * person's text while they type and commits once on Enter or blur.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { designOutline, pathOrigin } from '../../derive'
import type { DisplayUnit, ItemDesign, Point2 } from '../../domain'
import { PLAN_SWATCHES } from './planColors'
import { formatMm, parseToMm } from './displayUnits'
import type { PlanItemView } from './planModel'
import { quarterTurn } from './rotateHandle'
import { ShapeEditor } from './shape/ShapeEditor'
import type { DesignEditPreview } from './workspaceStore'

/**
 * An Item Design edit the Floor workspace can commit: the two fields that belong to the
 * Item Design and not to its shape.
 *
 * `width` and `depth` were here until #58 took them out of `design.update`. A footprint is
 * no longer two numbers, so it is no longer a field — the Shape tab of Item Detail edits it,
 * and the rows here say where it went.
 */
export interface DesignEdit {
  name?: string
  color?: string
}

export interface SelectionInspectorProps {
  item: PlanItemView | null
  /** The Item Design the selected Placed Item references. */
  design: ItemDesign | null
  unit: DisplayUnit
  precision: number
  /** Another Floor exists to send the selection to (#56). */
  canTransfer: boolean
  /** The design edit awaiting `Apply` (D3), or `null`. */
  preview: DesignEditPreview | null
  /** `Pick on canvas` is armed (#57 §5). */
  pickingOrigin: boolean
  onSetPosition: (x: number, y: number) => void
  onSetRotation: (rotationDeg: number) => void
  /** A design-level edit: the workspace previews it or commits it, by placement count. */
  onEditDesign: (edit: DesignEdit) => void
  /** An Item Origin choice: always a preview, never a direct commit (D3). */
  onPreviewOrigin: (origin: Point2) => void
  onApplyPreview: () => void
  onCancelPreview: () => void
  onTogglePick: () => void
  onFork: () => void
  onOpenDetail: () => void
  onDelete: () => void
  onTransfer: () => void
}

export function SelectionInspector(props: SelectionInspectorProps): ReactNode {
  const { item } = props
  // No selection: the rail simply has no inspector, per the issue's layout.
  if (item === null) return null
  return <ItemEditor key={item.id} {...props} item={item} />
}

/** One number field: the person's text while typing, the Project's value otherwise. */
function NumberField(props: {
  label: string
  testId: string
  value: number
  /** `null` reads the value as a Floor distance in the display unit; `'deg'` as degrees. */
  kind: 'mm' | 'deg'
  unit: DisplayUnit
  precision: number
  min?: number
  onCommit: (value: number) => void
}): ReactNode {
  const { label, testId, value, kind, unit, precision, min, onCommit } = props
  const shown = kind === 'mm' ? formatMm(value, unit, precision) : trimNumber(value)
  const [text, setText] = useState<string | null>(null)

  useEffect(() => { setText(null) }, [value])

  const commit = (): void => {
    if (text === null) return
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) {
      setText(null)
      return
    }
    const next = kind === 'mm'
      ? parseToMm(parsed, unit)
      : parsed
    const clamped = min === undefined ? next : Math.max(min, next)
    onCommit(clamped)
    const committed = kind === 'mm' ? formatMm(clamped, unit, precision) : trimNumber(clamped)
    if (committed === shown) setText(null)
  }

  return (
    <>
      <label className="bb-workspace-field-label" htmlFor={`${testId}-label`}>
        {label}
        {kind === 'mm' && <> <span className="bb-workspace-unit-suffix">({unit})</span></>}
      </label>
      <input
        id={`${testId}-label`}
        data-testid={testId}
        className="bb-workspace-input"
        type="number"
        step="any"
        value={text ?? shown}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
      />
    </>
  )
}

/** `37.5` reads `37.5`, `90` reads `90` — a rotation is not a distance, so no unit dp. */
function trimNumber(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/** One read-only row: the label the issue names, and the value beside it. */
function ReadOnlyRow(props: { testId: string; label: string; value: string; hint?: string }): ReactNode {
  return (
    <>
      <span className="bb-workspace-field-label" data-testid={`${props.testId}-label`}>{props.label}</span>
      <span className="bb-workspace-static-value" data-testid={props.testId}>{props.value}</span>
      {props.hint !== undefined && (
        <span className="bb-workspace-field-hint" data-testid={`${props.testId}-hint`}>{props.hint}</span>
      )}
    </>
  )
}

/** The four corners of the local bounds plus its centre: the `Item Origin` quick choices. */
function originChoices(design: ItemDesign): readonly { label: string; point: Point2 }[] {
  const path = designOutline(design)
  const points = [path.start, ...path.segments.map((segment) => segment.to)]
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return [
    { label: 'Centre', point: pathOrigin(path) },
    // Named as they appear at 0°, with +Y down: `Bottom-left` is local (minX, maxY).
    { label: 'Top-left', point: { x: minX, y: minY } },
    { label: 'Top-right', point: { x: maxX, y: minY } },
    { label: 'Bottom-right', point: { x: maxX, y: maxY } },
    { label: 'Bottom-left', point: { x: minX, y: maxY } },
  ]
}

function ItemEditor(props: SelectionInspectorProps & { item: PlanItemView }): ReactNode {
  const {
    item, design, unit, precision, canTransfer, preview, pickingOrigin,
    onSetPosition, onSetRotation, onEditDesign, onPreviewOrigin, onApplyPreview,
    onCancelPreview, onTogglePick, onFork, onOpenDetail, onDelete, onTransfer,
  } = props
  const isCabinet = design === null || design.kind === 'cabinet'
  const pending = preview !== null && preview.itemDesignId === item.designId ? preview : null
  const count = item.placementCount
  const size = (mm: number): string => formatMm(mm, unit, precision)

  return (
    <section className="bb-workspace-card" data-testid="selection-inspector">
      <h3 className="bb-workspace-card-title">Placed Item</h3>
      <ReadOnlyRow testId="inspector-name" label="Name" value={item.label} />
      <span className="bb-workspace-field-label" data-testid="inspector-design-label">
        Item Design: {item.label}
      </span>
      <NumberField
        label="Position X"
        testId="inspector-position-x"
        kind="mm"
        value={item.translation.x}
        unit={unit}
        precision={precision}
        onCommit={(x) => onSetPosition(x, item.translation.y)}
      />
      <NumberField
        label="Position Y"
        testId="inspector-position-y"
        kind="mm"
        value={item.translation.y}
        unit={unit}
        precision={precision}
        onCommit={(y) => onSetPosition(item.translation.x, y)}
      />
      <NumberField
        label="Rotation"
        testId="inspector-rotation"
        kind="deg"
        value={item.rotationDeg}
        unit={unit}
        precision={precision}
        onCommit={onSetRotation}
      />
      <div className="bb-workspace-button-row">
        <button
          type="button"
          data-testid="rotate-minus-90"
          className="bb-workspace-tool-button"
          onClick={() => onSetRotation(quarterTurn(item.rotationDeg, -1))}
        >
          ↺ 90°
        </button>
        <button
          type="button"
          data-testid="rotate-plus-90"
          className="bb-workspace-tool-button"
          onClick={() => onSetRotation(quarterTurn(item.rotationDeg, 1))}
        >
          ↻ 90°
        </button>
      </div>
      {/* The Item Footprint's own numbers: they never swap when the item turns. */}
      <ReadOnlyRow
        testId="placed-width"
        label="Width"
        value={size(item.width)}
        hint="Set in the Item Design below"
      />
      <ReadOnlyRow
        testId="placed-depth"
        label="Depth"
        value={size(item.depth)}
        hint="Set in the Item Design below"
      />
      <ReadOnlyRow
        testId="floor-bounds"
        label="Floor bounds"
        value={`${size(item.boundsWidth)} × ${size(item.boundsDepth)}`}
      />
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          data-testid="transfer-to-floor"
          className="bb-workspace-tool-button"
          disabled={!canTransfer}
          onClick={onTransfer}
        >
          Copy or Move to Floor…
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          data-testid="fork-design"
          className="bb-workspace-tool-button"
          onClick={onFork}
        >
          Fork design…
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          data-testid="delete-object"
          className="bb-workspace-danger-button"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>

      {design !== null && (
        <div className="bb-workspace-design-section" data-testid="item-design-section">
          <h4 className="bb-workspace-card-title" data-testid="item-design-title">
            {`Item Design · ${design.name} — shared by ${count} ${count === 1 ? 'placement' : 'placements'}`}
          </h4>
          <label className="bb-workspace-field-label" htmlFor="design-name-input">Name</label>
          <input
            id="design-name-input"
            data-testid="design-name"
            className="bb-workspace-input"
            type="text"
            value={pending?.name ?? design.name}
            onChange={(event) => onEditDesign({ name: event.target.value })}
          />
          {/* #58 §2: the Item Footprint is read here and written only in the Item Design editor,
              because a footprint change moves every placement of the design. The same three tabs
              as that editor, read-only, leading with the way there — for a cabinet too, whose
              Shape tab says the size comes from the construction (criterion 18). */}
          <button
            type="button"
            data-testid="open-item-detail"
            className="bb-workspace-tool-button"
            onClick={onOpenDetail}
          >
            Edit Item Design
          </button>
          <div className="bb-inspector-shape" data-testid="inspector-shape">
            <ShapeEditor
              itemDesignId={item.designId}
              design={design}
              layout="stacked"
              readOnly
            />
          </div>
          {/* A cabinet's footprint, origin and colour are its construction (#42 §2), so the
              rows that would edit them are not offered — Item Detail edits the cabinet. */}
          {!isCabinet && (
            <>
              <label className="bb-workspace-field-label">Colour</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PLAN_SWATCHES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    data-testid={`swatch-${color}`}
                    aria-label={`Colour ${color}`}
                    aria-pressed={(pending?.color ?? design.color) === color ? 'true' : 'false'}
                    className="bb-workspace-swatch"
                    style={{ background: color }}
                    onClick={() => onEditDesign({ color })}
                  />
                ))}
              </div>
              <label className="bb-workspace-field-label">Item Origin</label>
              <div className="bb-workspace-button-row" data-testid="origin-choices">
                {originChoices(design).map((choice) => (
                  <button
                    key={choice.label}
                    type="button"
                    data-testid={`origin-${choice.label.toLowerCase()}`}
                    className="bb-workspace-tool-button"
                    aria-pressed={
                      pending?.origin != null &&
                      pending.origin.x === choice.point.x &&
                      pending.origin.y === choice.point.y
                        ? 'true'
                        : 'false'
                    }
                    onClick={() => onPreviewOrigin(choice.point)}
                  >
                    {choice.label}
                  </button>
                ))}
                <button
                  type="button"
                  data-testid="origin-pick"
                  className="bb-workspace-tool-button"
                  aria-pressed={pickingOrigin ? 'true' : 'false'}
                  onClick={onTogglePick}
                >
                  Pick on canvas
                </button>
              </div>
            </>
          )}
          {pending && (
            <div className="bb-workspace-preview" data-testid="design-preview">
              <span data-testid="affects-count">{`Affects ${count} ${count === 1 ? 'placement' : 'placements'}`}</span>
              <div className="bb-workspace-button-row">
                <button
                  type="button"
                  data-testid="preview-apply"
                  className="bb-workspace-tool-button"
                  onClick={onApplyPreview}
                >
                  Apply
                </button>
                <button
                  type="button"
                  data-testid="preview-cancel"
                  className="bb-workspace-tool-button"
                  onClick={onCancelPreview}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
