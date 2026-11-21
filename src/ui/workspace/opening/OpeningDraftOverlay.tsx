/**
 * The Door / window tool's gesture layer (#65 §9, §10).
 *
 * It owns the pointer the way the Wall tool's layer does — a press that began on a control
 * belongs to that control, a press that slid across the canvas is a gesture and not a click —
 * and it owns nothing else. Where the Opening would go, whether it fits and what to say when it
 * does not are answered by the Floor workspace from the live Project, and the ghost it stands
 * for is drawn by the Plan View's own Wall list rather than by a copy of the symbol here: one
 * rendering path means the preview and the placed Opening cannot disagree about what a door
 * looks like, and the ghost sits in the same layer as the Walls it is cut into.
 *
 * The controls are an HTML layer over the canvas, not the canvas's SVG `overlay` slot — the
 * shape editor learned in #64 what mounting HTML inside the scene's own element tree costs.
 */
import { useRef } from 'react'
import type { Pt } from '../../../derive'
import type { DisplayUnit } from '../../../domain'
import { formatMm, parseToMm } from '../displayUnits'
import type { Viewport } from '../viewport'
import { withEnd, withPreset, withTypedDistance } from './openingDraft'
import type { OpeningAim, OpeningDraft } from './openingDraft'
import { OPENING_PRESET_GROUPS, openingPresetLabel, openingPresetRow } from './openingPresets'

export interface OpeningDraftOverlayProps {
  viewport: Viewport
  /** The row picked and the number typed, held by the Floor workspace so a re-render keeps it. */
  draft: OpeningDraft
  onDraft: (draft: OpeningDraft) => void
  /**
   * Where the pointer stands on the Floor, or `null` when it has left the canvas. The Floor
   * workspace answers it — the aim needs the Walls, the junctions and the fit rule, none of
   * which belong here.
   */
  onCursor: (cursor: Pt | null) => void
  /** What that pointer position means: `null` over empty canvas, where a click does nothing. */
  aim: OpeningAim | null
  /** The same answer for a point, so a click can aim for itself instead of trusting a move. */
  aimAt: (cursor: Pt | null) => OpeningAim | null
  /** The click that lands on a valid preview. One Opening, one Intent, one undo step (#26). */
  onPlace: (aim: OpeningAim) => void
  onCancel: () => void
  unit: DisplayUnit
  precision: number
}

/** The tool's options row: the preset picker, grouped, with the pack's own note. */
function PresetPicker({ draft, onDraft, unit, precision }: {
  draft: OpeningDraft
  onDraft: (draft: OpeningDraft) => void
  unit: DisplayUnit
  precision: number
}) {
  const row = openingPresetRow(draft.presetId)
  const num = (mm: number): string => formatMm(mm, unit, precision)
  return (
    <div
      data-testid="opening-tool-options"
      className="absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-2"
      onClick={(event) => {
        // Choosing a row is not a click that places an Opening.
        event.stopPropagation()
      }}
    >
      <label className="flex items-center gap-1">
        Door / window
        <select
          data-testid="opening-preset-picker"
          value={draft.presetId}
          onChange={(event) => onDraft(withPreset(draft, event.target.value))}
        >
          {OPENING_PRESET_GROUPS.map((section) => (
            <optgroup key={section.group} label={section.group}>
              {section.rows.map((entry) => (
                <option key={entry.id} value={entry.id}>{openingPresetLabel(entry, num, unit)}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {row.fixed && (
        <span data-testid="opening-preset-fixed" className="bb-workspace-chip">
          Fixed size
        </span>
      )}
      {row.hint !== null && (
        <span data-testid="opening-preset-hint" className="bb-workspace-chip">
          {row.hint}
        </span>
      )}
    </div>
  )
}

export function OpeningDraftOverlay({
  viewport,
  draft,
  onDraft,
  onCursor,
  aim,
  aimAt,
  onPlace,
  onCancel,
  unit,
  precision,
}: OpeningDraftOverlayProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const press = useRef<{ x: number; y: number } | null>(null)

  const toFloor = (clientX: number, clientY: number): Pt | null => {
    const rect = layerRef.current?.getBoundingClientRect()
    if (rect === undefined || rect === null) return null
    return {
      x: (clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (clientY - rect.top - viewport.panY) / viewport.zoom,
    }
  }

  const commitDistance = (text: string): void => {
    if (text === '') {
      onDraft(withTypedDistance(draft, null))
      return
    }
    const value = Number(text)
    if (Number.isFinite(value) && value >= 0) onDraft(withTypedDistance(draft, parseToMm(value, unit)))
  }

  return (
    <div
      ref={layerRef}
      data-testid="opening-draft-layer"
      className="absolute inset-0"
      style={{ cursor: 'crosshair', outline: 'none' }}
      tabIndex={-1}
      onPointerDown={(event) => {
        const control = (event.target as HTMLElement).closest('button, select, input, label')
        press.current = control === null ? { x: event.clientX, y: event.clientY } : null
      }}
      onPointerUp={(event) => {
        const started = press.current
        press.current = null
        if (started === null) return
        if (Math.abs(event.clientX - started.x) > 3 || Math.abs(event.clientY - started.y) > 3) return
        // The click aims for itself rather than trusting the last pointermove: a move is a
        // continuous event, so its state update can still be pending when a click on the same
        // spot is already being handled, and a click that lands before the ghost arrives would
        // place nothing.
        const aimed = aimAt(toFloor(event.clientX, event.clientY))
        if (aimed !== null && aimed.fits) onPlace(aimed)
      }}
      onPointerMove={(event) => {
        if ((event.target as HTMLElement).closest('button, select, input, label') !== null) return
        onCursor(toFloor(event.clientX, event.clientY))
      }}
      onPointerLeave={() => onCursor(null)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        } else if (event.key === 'Enter') {
          event.preventDefault()
          if (aim !== null && aim.fits) onPlace(aim)
        }
      }}
    >
      <PresetPicker draft={draft} onDraft={onDraft} unit={unit} precision={precision} />
      <div
        data-testid="opening-draft-bar"
        className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2"
        onClick={(event) => {
          // The bar is inside the layer that places Openings; its clicks are not clicks on canvas.
          event.stopPropagation()
        }}
      >
        <span>Distance from</span>
        <button
          type="button"
          data-testid="opening-distance-start"
          aria-pressed={draft.from === 'start' ? 'true' : 'false'}
          className="bb-workspace-tool-button tabular-nums"
          onClick={() => onDraft(withEnd(draft, 'start'))}
        >
          {aim?.chip.fromStart ?? '—'}
        </button>
        <span aria-hidden="true">|</span>
        <button
          type="button"
          data-testid="opening-distance-end"
          aria-pressed={draft.from === 'end' ? 'true' : 'false'}
          className="bb-workspace-tool-button tabular-nums"
          onClick={() => onDraft(withEnd(draft, 'end'))}
        >
          {aim?.chip.fromEnd ?? '—'}
        </button>
        <input
          data-testid="opening-distance-field"
          type="number"
          min={0}
          aria-label="Distance from the highlighted end"
          value={draft.typed === null ? '' : formatMm(draft.typed, unit, precision)}
          onChange={(event) => commitDistance(event.target.value)}
        />
        {aim !== null && aim.message !== null && (
          <span data-testid="opening-fit-message" role="status" className="text-[var(--bb-danger-text)]">
            {aim.message}
          </span>
        )}
        <button type="button" data-testid="opening-cancel" className="bb-workspace-tool-button" onClick={onCancel}>
          Cancel (Esc)
        </button>
      </div>
    </div>
  )
}
