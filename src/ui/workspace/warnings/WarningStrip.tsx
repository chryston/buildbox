/**
 * The Warning strip (#66 §11–§13, #29 behaviour 22–24 as amended by D10).
 *
 * It sits in the shell's `warningStrip` slot, overlaid on the bottom edge of the canvas host,
 * so it never resizes the canvas (#55). It is HTML, not part of the drawing: a warning is
 * chrome about the Floor rather than something on it, and the same sentence has to be readable
 * at 1:200 and at 10:1 without the drawing carrying a screen-space object.
 *
 * Three rules hold here, and they are the three defects the range prototype shipped:
 *
 * - **Every row locates.** The row itself is the click target, with a `Locate` button beside it
 *   for the keyboard. Navigation is never an Edit Transaction (#20 §4).
 * - **Acknowledging always offers a note.** The field opens with the button, empty, and `Save`
 *   commits whatever is in it — including nothing, because a note is optional and refusing to
 *   record a decision that was made would be worse.
 * - **`Acknowledge` is the action; `Seen ✓` is only the status.** A button labelled `Seen`
 *   reads as a claim about the thing rather than about having looked at it.
 *
 * Nothing here knows what a Wall is. The sentence comes from `warningSentence`, which reads the
 * engine's `messageKey`, so a later producer adds a row to that table and no line to this file.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Warning } from '../../../derive'
import { ACKNOWLEDGEMENT_NOTE_MAX_LENGTH } from '../../../domain'
import { STRINGS, warningSentence } from '../../strings'

export interface WarningStripProps {
  /** The active Floor and option's warnings, in engine order. */
  warnings: readonly Warning[]
  /** Select the primary subject and reveal every subject (#66 §13). */
  onLocate(warning: Warning): void
  /** One Edit Transaction: record the decision, its signature and the note (#66 §6). */
  onAcknowledge(warning: Warning, note: string): void
  /** One Edit Transaction: change the note and nothing else, least of all the signature. */
  onEditNote(warning: Warning, note: string): void
  /**
   * A badge on the canvas was clicked: open the strip and bring this row into view (#66 §14).
   *
   * The nonce is what makes it work twice. Clicking the same badge again has to scroll there
   * again, and a prop that compared equal to the last one would leave the effect asleep — which
   * is the same reason a "scroll to comment" link in every other app carries a counter.
   */
  focus?: { key: string; nonce: number } | null
}

/** Open and reopened rows come first; within each group the engine's order stands (#66 §11). */
const inRowOrder = (warnings: readonly Warning[]): Warning[] => [
  ...warnings.filter((warning) => warning.status !== 'acknowledged'),
  ...warnings.filter((warning) => warning.status === 'acknowledged'),
]

/** The primary subject's name, for the accessible name of a row's `Locate`. */
const subjectLabel = (warning: Warning): string =>
  String(warning.params.a ?? warning.subjects[0]?.id ?? '')

export function WarningStrip(props: WarningStripProps): ReactNode {
  const { warnings, onLocate, onAcknowledge, onEditNote, focus = null } = props
  const [expanded, setExpanded] = useState(false)
  // A badge opened the strip; the row is not in the document until it has, so the scroll waits
  // for the render the open causes rather than reaching for an element that is not there yet.
  useEffect(() => {
    if (focus === null) return
    setExpanded(true)
  }, [focus])
  useEffect(() => {
    if (focus === null || !expanded) return
    document.getElementById(`warning-row-${focus.key}`)?.scrollIntoView({ block: 'nearest' })
  }, [focus, expanded])
  // The row whose note field is open and what that field is for. One at a time: two open
  // fields would be two half-written decisions about the same warning. The mode matters
  // because a reopened warning already holds a record and still needs the *acknowledging*
  // Intent — re-acknowledging is what stores the new signature (#66 criterion 4), and the
  // note-editing Intent never touches a signature.
  const [drafting, setDrafting] = useState<{ key: string; mode: 'ack' | 'note' } | null>(null)
  const [note, setNote] = useState('')

  const openCount = warnings.filter((warning) => warning.status !== 'acknowledged').length
  const seenCount = warnings.length - openCount
  const rows = inRowOrder(warnings)

  const commit = (warning: Warning): void => {
    if (drafting?.mode === 'note') onEditNote(warning, note.trim())
    else onAcknowledge(warning, note.trim())
    setDrafting(null)
    setNote('')
  }

  return (
    <div className="bb-warnings" data-expanded={expanded ? 'true' : 'false'} data-testid="warning-strip">
      <div className="bb-warnings-bar">
        <span className="bb-warnings-mark" aria-hidden="true">
          ⚠
        </span>
        <span className="bb-warnings-count" data-testid="warning-count">
          {STRINGS.warningCount(openCount, seenCount)}
        </span>
        <button
          type="button"
          className="bb-workspace-tool-button"
          data-testid="warning-toggle"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((was) => !was)
            setDrafting(null)
          }}
        >
          {expanded ? STRINGS.warningHide : STRINGS.warningShow}
        </button>
      </div>
      {expanded && (
        <ul className="bb-warnings-list" data-testid="warning-list">
          {rows.map((warning) => (
            <li
              key={warning.key}
              className="bb-warnings-row"
              data-status={warning.status}
              id={`warning-row-${warning.key}`}
              data-testid={`warning-row-${warning.key}`}
              onClick={() => {
                onLocate(warning)
              }}
            >
              <span className="bb-warnings-sentence" data-testid={`warning-sentence-${warning.key}`}>
                {warningSentence(warning.messageKey, warning.params)}
              </span>
              {warning.status === 'reopened' && (
                <span className="bb-warnings-status" data-testid={`warning-status-${warning.key}`}>
                  {STRINGS.warningReopened}
                </span>
              )}
              {warning.status === 'acknowledged' && drafting?.key !== warning.key && (
                <span className="bb-warnings-status" data-testid={`warning-status-${warning.key}`}>
                  {STRINGS.warningSeenNote(warning.acknowledgement?.note ?? '')}
                </span>
              )}
              <span className="bb-warnings-actions" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="bb-workspace-tool-button"
                  data-testid={`warning-locate-${warning.key}`}
                  aria-label={`${STRINGS.warningLocate} ${subjectLabel(warning)}`}
                  onClick={() => {
                    onLocate(warning)
                  }}
                >
                  {STRINGS.warningLocate}
                </button>
                {warning.status !== 'acknowledged' && drafting?.key !== warning.key && (
                  <button
                    type="button"
                    className="bb-workspace-tool-button"
                    data-testid={`warning-acknowledge-${warning.key}`}
                    onClick={() => {
                      // The note field opens with the button: acknowledging always offers one,
                      // so the choice to write nothing is made in the open.
                      setNote(warning.acknowledgement?.note ?? '')
                      setDrafting({ key: warning.key, mode: 'ack' })
                    }}
                  >
                    {STRINGS.warningAcknowledge}
                  </button>
                )}
                {warning.status === 'acknowledged' && drafting?.key !== warning.key && (
                  <button
                    type="button"
                    className="bb-workspace-tool-button"
                    data-testid={`warning-edit-note-${warning.key}`}
                    aria-label={STRINGS.warningNote}
                    onClick={() => {
                      setNote(warning.acknowledgement?.note ?? '')
                      setDrafting({ key: warning.key, mode: 'note' })
                    }}
                  >
                    {STRINGS.warningNote}
                  </button>
                )}
                {/* `Create linked Comment` (#80) will take its own button here, independent of
                    Acknowledge: a comment is a note on the drawing, an acknowledgement is a
                    decision about the model, and neither implies the other. */}
              </span>
              {drafting?.key === warning.key && (
                <span className="bb-warnings-note" onClick={(event) => event.stopPropagation()}>
                  <label className="bb-warnings-note-label" htmlFor={`warning-note-${warning.key}`}>
                    {STRINGS.warningNoteOptional}
                  </label>
                  <input
                    id={`warning-note-${warning.key}`}
                    className="bb-warnings-note-input"
                    data-testid={`warning-note-${warning.key}`}
                    value={note}
                    maxLength={ACKNOWLEDGEMENT_NOTE_MAX_LENGTH}
                    autoFocus
                    onChange={(event) => {
                      setNote(event.target.value)
                    }}
                    // Enter commits and blur commits, Esc cancels (#66 §6): a note typed into a
                    // field nobody confirms is a note that was written and lost.
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commit(warning)
                      if (event.key === 'Escape') {
                        setDrafting(null)
                        setNote('')
                      }
                    }}
                    onBlur={() => {
                      commit(warning)
                    }}
                  />
                  <button
                    type="button"
                    className="bb-workspace-tool-button"
                    data-testid={`warning-save-${warning.key}`}
                    // The button takes the click itself, so the field's blur does not commit a
                    // second time behind it.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      commit(warning)
                    }}
                  >
                    {STRINGS.warningSave}
                  </button>
                  <button
                    type="button"
                    className="bb-workspace-tool-button"
                    data-testid={`warning-cancel-${warning.key}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setDrafting(null)
                      setNote('')
                    }}
                  >
                    {STRINGS.cancel}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
