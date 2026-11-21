/**
 * The Door / window tool's controls (#65 §9, §10).
 *
 * It is an HTML layer over the canvas and it touches nothing the canvas needs: the pointer is
 * reported by the canvas itself (`PlanViewCanvas`'s `onCursorChange`), because a layer drawn above
 * the canvas never sees the moves that land on the canvas under it — a ghost that waited for them
 * here would never appear, and the clicks meant to place an Opening would be swallowed on the way.
 * So this layer is `pointer-events: none` except for its own controls, and everything it shows is
 * an answer the Floor workspace already has.
 *
 * Where the Opening would go, whether it fits and what to say when it does not are answered from
 * the live Project, and the ghost it stands for is drawn by the Plan View's own Wall list rather
 * than by a copy of the symbol here: one rendering path means the preview and the placed Opening
 * cannot disagree about what a door looks like, and the ghost sits in the same layer as the Walls
 * it is cut into.
 */
import { formatMm, parseToMm } from '../displayUnits'
import { withEnd, withPreset, withTypedDistance } from './openingDraft'
import type { OpeningAim, OpeningDraft } from './openingDraft'
import { OPENING_PRESET_GROUPS, openingPresetLabel, openingPresetRow } from './openingPresets'
import type { DisplayUnit } from '../../../domain'
import { STRINGS } from '../../strings'

export interface OpeningDraftOverlayProps {
  /** The row picked and the number typed, held by the Floor workspace so a re-render keeps it. */
  draft: OpeningDraft
  onDraft: (draft: OpeningDraft) => void
  /**
   * What the pointer over the canvas means: `null` over empty canvas or over a Wall too far to
   * reach, where a click does nothing.
   */
  aim: OpeningAim | null
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
      className="pointer-events-auto absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-2"
      onClick={(event) => {
        // Choosing a row is not a click that places an Opening.
        event.stopPropagation()
      }}
    >
      <label className="flex items-center gap-1">
        {STRINGS.openingDraftTitle}
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
          {STRINGS.openingDraftFixedSize}
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
  draft,
  onDraft,
  aim,
  onCancel,
  unit,
  precision,
}: OpeningDraftOverlayProps) {
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
      data-testid="opening-draft-layer"
      className="pointer-events-none absolute inset-0"
    >
      <PresetPicker draft={draft} onDraft={onDraft} unit={unit} precision={precision} />
      <div
        data-testid="opening-draft-bar"
        className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2"
        onClick={(event) => {
          // The bar floats over the canvas; typing a distance is not a click that places one.
          event.stopPropagation()
        }}
      >
        <span>{STRINGS.openingDistanceFrom}</span>
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
          aria-label={STRINGS.openingDraftDistance}
          value={draft.typed === null ? '' : formatMm(draft.typed, unit, precision)}
          onChange={(event) => commitDistance(event.target.value)}
        />
        {aim !== null && aim.message !== null && (
          <span data-testid="opening-fit-message" role="status" className="text-[var(--bb-danger-text)]">
            {aim.message}
          </span>
        )}
        <button type="button" data-testid="opening-cancel" className="bb-workspace-tool-button" onClick={onCancel}>
          {STRINGS.openingCancelEsc}
        </button>
      </div>
    </div>
  )
}
