/**
 * The Room producer: a Placed Item that straddles a Room boundary (#67 §16, D7).
 *
 * Rooms are drawn, not inferred, and furniture is placed without reference to them, so an item
 * that sits half in the Bedroom and half in the corridor is a fact about the drawing the user
 * probably wants to know about — and one they may well have meant. The warning is therefore
 * measured and non-blocking: it never stops a commit, it only says what the overlap costs.
 *
 * The measure is the analytic area of the footprint lying **outside** the Room, and its share
 * of the footprint's own area. Both come from `geometry.overlap`, arcs included, so turning the
 * item a further 15° moves both numbers — the prototype's measure was sampled vertices times
 * perimeter and printed the identical figure for a 37° and a 52° rotation of the same Base 600,
 * which is the defect this producer exists not to repeat.
 *
 * An item wholly outside every Room gets nothing at all (#67 D7): `Outside all Rooms` is a
 * membership, shown in the Placed Item's Measurements tab, not a warning. An item that crosses
 * two Rooms gets two warnings, because the two areas are different facts and the user may
 * dismiss one of them.
 */
import { area } from '../../../geometry'
import { roomMembershipOf } from '../../rooms'
import type { WarningCandidate, WarningFloor, WarningProducer } from '../types'

/**
 * One crossing: an item, the Room it straddles, and what lies outside.
 *
 * `footprintAreaMm2` travels with it because the percentage is read against it, and a producer
 * that recomputed it per Room would be a producer that could disagree with itself.
 */
interface Crossing {
  readonly placement: WarningFloor['placements'][number]
  readonly room: WarningFloor['rooms'][number]
  /**
   * Square millimetres of the footprint outside the Room, and of the footprint altogether.
   *
   * The two travel together because the percentage is read against the second, and a producer
   * that recomputed it per Room would be a producer that could disagree with itself.
   */
  readonly outsideAreaMm2: number
  readonly footprintAreaMm2: number
}

/**
 * Every crossing of one Floor, in a canonical order.
 *
 * `floor.placements` and `floor.rooms` both arrive sorted by ID, so the list does not depend
 * on the order the entities were inserted (#66 criterion 10).
 */
const crossingsOf = (floor: WarningFloor): Crossing[] => {
  const rooms = floor.rooms.map((room) => ({ id: room.id, name: room.name, path: room.outline }))
  const crossings: Crossing[] = []
  for (const placement of floor.placements) {
    const footprintAreaMm2 = area(placement.worldPath)
    for (const row of roomMembershipOf(placement.worldPath, rooms)) {
      if (row.relation !== 'crosses') continue
      const room = floor.rooms.find((candidate) => candidate.id === row.roomId)
      if (room === undefined) continue
      crossings.push({ placement, room, outsideAreaMm2: row.outsideAreaMm2, footprintAreaMm2 })
    }
  }
  return crossings
}

/**
 * Every model field one crossing is a function of (#67 §16).
 *
 * The placement's translation and rotation, the Item Design's footprint and Item Origin, and
 * the Room Outline — the four the issue names, in the form the model stores them. Not the
 * measured area: a warning reopens when the drawing moved, not when the sentence about it did.
 */
const signatureInputsOf = (crossing: Crossing): unknown => ({
  placement: {
    translation: crossing.placement.translation,
    rotationDeg: crossing.placement.rotationDeg,
  },
  design: {
    footprint: crossing.placement.footprint,
    origin: crossing.placement.origin,
  },
  room: crossing.room.source,
})

/** `Base 600 #2 crosses Bedroom: 0.05 m² (21%) of its footprint is outside.` (#67 §16) */
export const itemCrossesRoom: WarningProducer = {
  type: 'item_crosses_room',
  produce(floor) {
    return crossingsOf(floor).map((crossing): WarningCandidate => {
      const outside = crossing.footprintAreaMm2 === 0 ? 0 : crossing.outsideAreaMm2 / crossing.footprintAreaMm2
      return {
        // The Placed Item leads: it is the thing the user moved, and the thing the strip has to
        // select when the row is clicked.
        subjects: [
          { type: 'placedItem', id: crossing.placement.id },
          { type: 'room', id: crossing.room.id },
        ],
        measured: {
          m2: crossing.outsideAreaMm2 / 1_000_000,
          pct: outside * 100,
        },
        messageKey: 'item_crosses_room',
        params: {
          a: crossing.placement.label,
          b: crossing.room.name,
          m2: crossing.outsideAreaMm2 / 1_000_000,
          pct: outside * 100,
        },
        signatureInputs: signatureInputsOf(crossing),
      }
    })
  },
}

/** The Room producers, in the order the engine runs them. */
export const ROOM_PRODUCERS: readonly WarningProducer[] = [itemCrossesRoom]
