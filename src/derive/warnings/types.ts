/**
 * The shapes of the warnings engine (#66 §1).
 *
 * Two families live here. A **candidate** is what a producer answers: one suspected warning,
 * with the entities it is about, what was measured, which sentence says so, and the model
 * fields the measurement came from. A **warning** is what the engine answers: the same thing
 * after it has been given a key, a signature and a status — the only form the rest of the
 * app ever reads.
 *
 * The split is what keeps producers thin. A producer decides *whether* something is worth
 * telling the user about and *what was measured*; it never mints a key, never hashes a
 * signature and never reads an acknowledgement, because those three are the same for every
 * warning there is or will be, and a producer that got one of them wrong would be a warning
 * that silently never reopens.
 */
import type { Acknowledgement, EntityId, WallJustification, WallRefLine } from '../../domain'
import type { ClosedPath } from '../../geometry'

/** What kind of entity a warning is about. Later issues extend this list (#67, #76–#79). */
export type WarningSubjectKind = 'wall' | 'opening' | 'placedItem'

/** One entity a warning involves. The primary subject is always first (#66 §1). */
export interface WarningSubject {
  readonly type: WarningSubjectKind
  readonly id: EntityId
}

/**
 * What was measured, in the unit the sentence needs.
 *
 * Every field is optional because not every warning is a length: a Room warning will report
 * square metres, a vertical one a percentage of a Clearance Envelope. A warning with no
 * measurement at all carries `{}` — the sentence then names the entities and stops.
 */
export interface WarningMeasured {
  readonly mm?: number
  readonly m2?: number
  readonly pct?: number
}

/**
 * The values a sentence is built from: `{ a: 'W-2', b: 'W-5', mm: 100 }` for the copy
 * `{a} crosses {b} without a join: {mm} mm overlap.`
 *
 * Values are strings or numbers, never pre-formatted sentences. A number is a measurement and
 * the table rounds it the same way every time; a producer that wrote `'100 mm'` would put a
 * display rule in the engine and take it away from every later surface — the strip, the
 * Warnings List CSV (#68) and whatever a print of the same warning becomes.
 */
export type WarningParams = Readonly<Record<string, string | number>>

/** What a producer answers for one suspected warning (#66 §1). */
export interface WarningCandidate {
  readonly subjects: readonly WarningSubject[]
  readonly measured: WarningMeasured
  /** The key of the `ui/strings` warning-copy table; a stable ID, never the sentence. */
  readonly messageKey: string
  readonly params: WarningParams
  /**
   * Every model field this warning is a function of, for every entity involved.
   *
   * Model fields only — never a measured number, never a formatted string. The signature is
   * the hash of this value, so it must change when the geometry changes and must not change
   * when only the *words* would. That distinction is the whole fix for the prototype bug where
   * a warning reopened only if its text happened to change (#29 D10).
   */
  readonly signatureInputs: unknown
}

/**
 * One Wall as a producer may read it (#66 §1).
 *
 * The stored fields, plus the tidied outline `deriveWalls` computed. Nothing else: no
 * Renovation State, no Layer, no view. A producer that could read a Layer could produce a
 * warning that disappears when the Layer is hidden, which #32 forbids.
 */
export interface WarningWall {
  readonly id: EntityId
  readonly ref: string
  readonly floorId: EntityId
  readonly line: WallRefLine
  readonly thickness: number
  readonly justification: WallJustification
  /** The tidied outline: faces cut at every Junction this Wall takes part in (#64 §5). */
  readonly outline: ClosedPath
}

/** One Junction as a producer may read it: which Walls meet at it. */
export interface WarningJunction {
  readonly id: EntityId
  /** Member ends plus the host, in no particular order. */
  readonly wallIds: readonly EntityId[]
}

/**
 * Everything a producer is given: one Floor's model, and nothing else (#66 §1, criterion 2).
 *
 * This type is the guarantee that a view change cannot reopen a warning. Producers are not
 * *told* to ignore Plan View Range, panes, viewports, saved views or Layers — they cannot
 * name them, because the value handed them has no such field and the compiler refuses the
 * attempt. `warnings.test.ts` asserts it at the type and at runtime.
 */
export interface WarningFloor {
  readonly floorId: EntityId
  readonly walls: readonly WarningWall[]
  readonly junctions: readonly WarningJunction[]
}

/**
 * One registered producer (#66 §1).
 *
 * `type` is a contract code: it becomes a `warning_type` value in the Warnings List CSV
 * (#68) and half of every acknowledgement key ever stored, so it is lower_snake_case and it
 * never changes once shipped.
 */
export interface WarningProducer {
  readonly type: string
  /**
   * The suspected warnings of one Floor.
   *
   * `optionId` arrives separately because it is not part of the model the producer reads:
   * Walls belong to the Existing Model until #69, and a producer that branched on the Option
   * would be a producer that produced different warnings for one model.
   */
  produce(floor: WarningFloor, optionId: EntityId | null): WarningCandidate[]
}

/** Whether the user has dealt with a warning (#66 §3). */
export type WarningStatus = 'open' | 'acknowledged' | 'reopened'

/** A warning as the engine answers it: a candidate plus key, signature and status. */
export interface Warning {
  /** `type | sorted(subject IDs).join(',') | optionId ?? 'existing'` (#66 §2). */
  readonly key: string
  readonly type: string
  readonly floorId: EntityId
  readonly optionId: EntityId | null
  readonly subjects: readonly WarningSubject[]
  readonly measured: WarningMeasured
  readonly messageKey: string
  readonly params: WarningParams
  /** `stableHash` of the canonical JSON of the producer's signature inputs. */
  readonly signature: string
  readonly status: WarningStatus
  /**
   * The acknowledgement this warning was matched to, or `null` when it is open.
   *
   * Kept for `reopened` too: the note the user wrote stays visible beside
   * `Reopened after change` (#66 §3), because a note that vanishes on a model change is a
   * note that was never read.
   */
  readonly acknowledgement: Acknowledgement | null
}

/** Every warning of one Floor under one Design Option, in engine order (#66 §2). */
export interface FloorWarnings {
  readonly floorId: EntityId
  readonly optionId: EntityId | null
  readonly warnings: readonly Warning[]
}
