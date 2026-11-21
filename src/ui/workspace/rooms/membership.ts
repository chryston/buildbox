/**
 * The one sentence a Placed Item's Room membership makes (#67 §15).
 *
 * `derive` answers the question per Room — inside, crossing, or missing — because the crossing
 * warning needs the same rows and the same areas. What a person reads is one line: the Room the
 * item stands in, the Rooms it straddles, or the fact that it stands in none of them. A Room the
 * item misses entirely is not named: an item in the Kitchen of a five-Room Floor has nothing to
 * say about the other four.
 */
import type { RoomMembership } from '../../../derive'
import { STRINGS } from '../../strings'

/**
 * `Inside Kitchen`, `Crosses Kitchen and Bedroom`, or `Outside all Rooms`.
 *
 * A row whose relation is `outside` is a tolerance artifact — containment called the item inside or
 * crossing while some sliver of it lies beyond the Outline — so it never names a Room on its own.
 */
export function roomMembershipSentence(rows: readonly RoomMembership[] | undefined): string {
  const members = (rows ?? []).filter((row) => row.relation !== 'outside')
  if (members.length === 0) return STRINGS.outsideAllRooms
  if (members.length === 1 && members[0]!.relation === 'inside') return STRINGS.insideRoom(members[0]!.roomName)
  return STRINGS.crossesRooms(members.map((row) => row.roomName))
}
