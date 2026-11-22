/**
 * The Room inspector (#67 behaviours 3 and 4).
 *
 * A Room is named, and the name is the one thing about it a person types here before they touch
 * its shape: a committed Room arrives as `Room N` and the field is handed over with the text
 * selected, so the first thing they do is rename it. Everything below the field is what the
 * Outline works out to — Area, Perimeter and the Room's own box in Floor coordinates — and none
 * of it is typed: a Room's shape is edited on the canvas with the same tools that edit an Item
 * Footprint, not from a readout.
 *
 * A name that comes back empty or longer than the domain allows is refused and the field shows
 * what the Project holds again, rather than writing a Room the validator would reject.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { DerivedRoom } from '../../../derive'
import type { DisplayUnit, Room } from '../../../domain'
import { STRINGS } from '../../strings'
import { formatSquareMetres, readoutMm } from '../displayUnits'
import { useFieldsLocked } from '../fieldsLock'
import '../shape/shape.css'

/** The longest name the domain allows (#67 §1). */
const MAX_NAME = 80

export interface RoomInspectorProps {
  readonly room: Room
  /** The same Room measured: area, perimeter, box, label anchor. */
  readonly derived: DerivedRoom
  readonly unit: DisplayUnit
  readonly precision: number
  /** The name the Project should hold. Only called with a name the domain accepts. */
  readonly onRename: (name: string) => void
  /** Take the keyboard with the text selected: this Room has just been committed (#67 §4). */
  readonly focusName?: boolean
  /** The Edges section, which is a different question from the name and the area (#67 §10). */
  readonly children?: ReactNode
  /** The renovation action for this Room (#69 §13), when there is an Option to move it to. */
  readonly renovationAction?: ReactNode
}

export function RoomInspector(props: RoomInspectorProps): ReactNode {
  const { room, derived, unit, precision, onRename, focusName = false, children, renovationAction } = props
  const { locked, notice } = useFieldsLocked()
  const [text, setText] = useState(room.name)
  const nameRef = useRef<HTMLInputElement>(null)
  /** The last name handed to the Project, so Enter followed by blur is one write, not two. */
  const sent = useRef<string | null>(null)
  // A rename from anywhere else — the canvas, another tab, an Undo — is what the field shows
  // next, not whatever was half-typed when it happened.
  useEffect(() => {
    setText(room.name)
    sent.current = null
  }, [room.name])
  useEffect(() => {
    if (!focusName) return
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [focusName, room.id])

  const commit = (): void => {
    const next = text.trim()
    if (next === '' || next.length > MAX_NAME) {
      setText(room.name)
      return
    }
    setText(next)
    if (next === room.name || next === sent.current) return
    sent.current = next
    onRename(next)
  }

  const read = (mm: number): string => readoutMm(mm, unit, precision)
  const width = derived.bounds.w
  const depth = derived.bounds.h

  return (
    <section className="bb-workspace-card" data-testid="room-inspector">
      <h3 className="bb-workspace-card-title" data-testid="room-inspector-title">{STRINGS.room}</h3>
      <label className="bb-workspace-field-label" htmlFor="room-name-field">
        {STRINGS.name}
      </label>
      <input
        id="room-name-field"
        ref={nameRef}
        className="bb-workspace-input"
        data-testid="room-name-input"
        type="text"
        disabled={locked}
        title={notice === '' ? undefined : notice}
        value={text}
        maxLength={MAX_NAME}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          // Commit here rather than by blurring: a field that is not the focused element does not
          // fire `blur`, and the write must not depend on where the caret happened to be.
          commit()
          event.currentTarget.blur()
        }}
      />
      <dl className="bb-measurements" data-testid="room-measurements">
        <dt data-testid="room-measurements-area-label">{STRINGS.area}</dt>
        <dd data-testid="room-measurements-area">{formatSquareMetres(derived.areaMm2)}</dd>
        <dt data-testid="room-measurements-perimeter-label">{STRINGS.perimeter}</dt>
        <dd data-testid="room-measurements-perimeter">{read(derived.perimeterMm)}</dd>
        <dt data-testid="room-measurements-bounds-label">{STRINGS.floorBounds}</dt>
        <dd data-testid="room-measurements-bounds">{`${read(width)} × ${read(depth)}`}</dd>
      </dl>
      {children}
      {renovationAction}
    </section>
  )
}
