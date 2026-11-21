/**
 * The Measurements tab (#58 §4): what the Item Footprint works out to, with nothing to type.
 *
 * Area is always square metres to two decimals whatever the display unit, because a Project
 * measured in millimetres still has a worktop measured in square metres, and a second unit
 * choice would be a second thing to remember. Perimeter and bounds follow the Project's own
 * unit and precision, like every other number on screen.
 */
import type { ReactNode } from 'react'
import { footprintArea, footprintPerimeter, footprintSize } from '../../../domain'
import { readoutMm, formatSquareMetres } from '../displayUnits'
import { STRINGS } from '../../strings'
import type { DisplayFormat, ItemFootprint } from '../../../domain'

export interface MeasurementsTabProps {
  readonly footprint: ItemFootprint
  readonly format: DisplayFormat
  /** `Bounds` for an Item Design, `Floor bounds` for a Placed Item (#58 §4). */
  readonly boundsLabel: string
  /**
   * Which Room the Placed Item stands in, in one sentence (#67 §15). Absent for an Item Design,
   * which is not anywhere: only a placement on a Floor is inside or outside a Room.
   */
  readonly membership?: string
}

export function MeasurementsTab(props: MeasurementsTabProps): ReactNode {
  const { footprint, format, boundsLabel, membership } = props
  const size = footprintSize(footprint)
  const read = (mm: number): string => readoutMm(mm, format.unit, format.precision)
  return (
    <dl className="bb-measurements" data-testid="measurements-tab">
      <dt data-testid="measurements-area-label">{STRINGS.area}</dt>
      <dd data-testid="measurements-area">{formatSquareMetres(footprintArea(footprint))}</dd>
      <dt data-testid="measurements-perimeter-label">{STRINGS.perimeter}</dt>
      <dd data-testid="measurements-perimeter">{read(footprintPerimeter(footprint))}</dd>
      <dt data-testid="measurements-bounds-label">{boundsLabel}</dt>
      <dd data-testid="measurements-bounds">{`${read(size.width)} × ${read(size.depth)}`}</dd>
      {membership !== undefined && (
        <>
          <dt data-testid="measurements-room-label">{STRINGS.room}</dt>
          <dd data-testid="measurements-room">{membership}</dd>
        </>
      )}
    </dl>
  )
}
