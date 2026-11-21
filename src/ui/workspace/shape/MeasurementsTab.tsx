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
import { readoutMm } from '../displayUnits'
import { STRINGS } from '../../strings'
import type { DisplayFormat, ItemFootprint } from '../../../domain'

export interface MeasurementsTabProps {
  readonly footprint: ItemFootprint
  readonly format: DisplayFormat
  /** `Bounds` for an Item Design, `Floor bounds` for a Placed Item (#58 §4). */
  readonly boundsLabel: string
}

/** Square metres, two decimals, always: the one measurement that does not follow the unit. */
function squareMetres(squareMillimetres: number): string {
  return `${(squareMillimetres / 1_000_000).toFixed(2)} m²`
}

export function MeasurementsTab(props: MeasurementsTabProps): ReactNode {
  const { footprint, format, boundsLabel } = props
  const size = footprintSize(footprint)
  const read = (mm: number): string => readoutMm(mm, format.unit, format.precision)
  return (
    <dl className="bb-measurements" data-testid="measurements-tab">
      <dt data-testid="measurements-area-label">{STRINGS.area}</dt>
      <dd data-testid="measurements-area">{squareMetres(footprintArea(footprint))}</dd>
      <dt data-testid="measurements-perimeter-label">{STRINGS.perimeter}</dt>
      <dd data-testid="measurements-perimeter">{read(footprintPerimeter(footprint))}</dd>
      <dt data-testid="measurements-bounds-label">{boundsLabel}</dt>
      <dd data-testid="measurements-bounds">{`${read(size.width)} × ${read(size.depth)}`}</dd>
    </dl>
  )
}
