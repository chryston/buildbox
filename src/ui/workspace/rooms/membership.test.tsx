/**
 * Which Room a Placed Item stands in, in the words the inspector shows (#67 §15).
 *
 * `derive` answers per Room — inside, crossing, missing — because the crossing warning asks the
 * same question of the same shapes. The person reads one line, and the acceptance text quotes it:
 * `Inside Kitchen`, `Crosses Kitchen and Bedroom`, `Outside all Rooms`. The sentences are asserted
 * as rendered text, never as key names, because the sentence is the deliverable.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { RoomMembership } from '../../../derive'
import type { DisplayFormat, ItemFootprint } from '../../../domain'
import { MeasurementsTab } from '../shape/MeasurementsTab'
import { roomMembershipSentence } from './membership'

/** A 900 × 600 footprint: a dining chair, standing somewhere on the Floor. */
const FOOTPRINT: ItemFootprint = {
  kind: 'path',
  path: {
    start: { x: 0, y: 0 },
    segments: [
      { kind: 'line', to: { x: 900, y: 0 } },
      { kind: 'line', to: { x: 900, y: 600 } },
      { kind: 'line', to: { x: 0, y: 600 } },
      { kind: 'line', to: { x: 0, y: 0 } },
    ],
  },
}

const FORMAT: DisplayFormat = { unit: 'mm', precision: 0 }

const row = (roomName: string, relation: RoomMembership['relation']): RoomMembership => ({
  roomId: `room-${roomName.toLowerCase()}`,
  roomName,
  relation,
  outsideAreaMm2: relation === 'inside' ? 0 : 120_000,
})

describe('the membership sentence', () => {
  it('names the one Room the item stands in', () => {
    expect(roomMembershipSentence([row('Kitchen', 'inside')])).toBe('Inside Kitchen')
  })

  it('names every Room the item crosses, in the order the Floor holds them', () => {
    expect(roomMembershipSentence([row('Kitchen', 'crosses'), row('Bedroom', 'crosses')]))
      .toBe('Crosses Kitchen and Bedroom')
    // An item standing in one Room with its arm in another is crossing, not inside.
    expect(roomMembershipSentence([row('Kitchen', 'inside'), row('Balcony', 'crosses')]))
      .toBe('Crosses Kitchen and Balcony')
    expect(roomMembershipSentence([row('Kitchen', 'crosses'), row('Bedroom', 'crosses'), row('Hall', 'crosses')]))
      .toBe('Crosses Kitchen, Bedroom, and Hall')
  })

  it('says so when the item stands in none of them', () => {
    // A Room the item misses entirely is absent from the rows, so an empty answer is the whole
    // Floor missed — and a row whose relation is `outside` names nothing on its own.
    expect(roomMembershipSentence([])).toBe('Outside all Rooms')
    expect(roomMembershipSentence(undefined)).toBe('Outside all Rooms')
    expect(roomMembershipSentence([row('Kitchen', 'outside')])).toBe('Outside all Rooms')
  })
})

describe('the Measurements tab', () => {
  it('shows the Room beside the areas', () => {
    render(
      <MeasurementsTab
        footprint={FOOTPRINT}
        format={FORMAT}
        boundsLabel="Floor bounds"
        membership="Inside Kitchen"
      />,
    )
    expect(screen.getByTestId('measurements-room-label').textContent).toBe('Room')
    expect(screen.getByTestId('measurements-room').textContent).toBe('Inside Kitchen')
  })

  it('offers no Room row for an Item Design, which is nowhere', () => {
    render(<MeasurementsTab footprint={FOOTPRINT} format={FORMAT} boundsLabel="Bounds" />)
    expect(screen.queryByTestId('measurements-room')).toBeNull()
    // The rest of the tab is untouched by the extra row.
    expect(screen.getByTestId('measurements-area').textContent).toBe('0.54 m²')
  })
})
