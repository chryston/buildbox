/**
 * The identity of a warning, and of the acknowledgement that closes it (#66 §2, §5).
 *
 * One warning is identified by *what it is about*, never by a number: `wall_crossing` between
 * the same two Walls is the same warning before and after either Wall moves, which is what
 * lets an acknowledgement survive a save, a Backup, an ID remap and a second tab. The key is
 * therefore three parts — the producer's type code, the involved entity IDs sorted, and the
 * Design Option — joined with `|`.
 *
 * It lives in `domain` rather than in `derive` because three modules have to agree on it
 * exactly: the engine builds it for every warning it produces, `validateProject` builds it to
 * refuse two acknowledgements of one warning, and `edit` builds it to prune or replace one.
 * Two spellings of one key is a warning that is `Seen ✓` in one place and open in another.
 *
 * The separator is `|` and the subject list is joined with `,`. An `EntityId` may hold either
 * character (#42 §3 forbids only whitespace and control characters), so in principle one ID
 * could spell out another entity's key. It is accepted here because the key is a published
 * contract — it is what a Backup stores and what the Warnings List CSV (#68) will print — and
 * because every ID this build mints is a UUID. The consequence is that the key is *opaque*:
 * nothing parses a key back into its parts, and every caller holds the parts beside it.
 */
import { compareCodePoints } from '../lib'
import type { EntityId } from './project'

/** The note's ceiling, in characters (#66 §6). The field and the validator read this one value. */
export const ACKNOWLEDGEMENT_NOTE_MAX_LENGTH = 500

/**
 * The key of the warning `warningType` says about `subjectIds` under `designOptionId`.
 *
 * The subject IDs are sorted here rather than trusted: the engine has already sorted them,
 * and a Backup that has not is refused by `validateProject` for the unsorted list — but the
 * key must still be the canonical one, or the duplicate check would miss the pair it exists
 * to catch.
 */
export const warningKey = (
  warningType: string,
  subjectIds: readonly EntityId[],
  designOptionId: EntityId | null,
): string => `${warningType}|${[...subjectIds].sort(compareCodePoints).join(',')}|${designOptionId ?? 'existing'}`
