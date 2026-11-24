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
import type {
  Acknowledgement,
  ClearanceEnvelope,
  EntityId,
  ItemFootprint,
  RoomOutline,
  WallJustification,
  WallRefLine,
} from '../../domain'
import type { ClosedPath, Pt, WallSide } from '../../geometry'

/** What kind of entity a warning is about. Later issues extend this list (#76–#79). */
export type WarningSubjectKind = 'wall' | 'opening' | 'placedItem' | 'room' | 'beam' | 'skirting'

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
  /** Vertical Extent (#76 §5): the Floor level it stands on and the height it reaches. */
  readonly baseElevation: number
  readonly height: number
}

/**
 * One Opening as a producer may read it (#76 §5).
 *
 * The stored fields along the host and across the heights — the four numbers that decide whether
 * it stays inside its host Wall — plus the display label. `start` is along the host reference
 * line, so a producer can build the along-wall hole the Opening leaves in the Wall body.
 */
export interface WarningOpening {
  readonly id: EntityId
  readonly hostWallId: EntityId
  /** The Opening's own display name: `Window WND-1`. */
  readonly label: string
  readonly sill: number
  readonly head: number
  readonly start: number
  readonly width: number
}

/** One Junction as a producer may read it: which Walls meet at it. */
export interface WarningJunction {
  readonly id: EntityId
  /** Member ends plus the host, in no particular order. */
  readonly wallIds: readonly EntityId[]
}

/**
 * One Room as a producer may read it (#67 §16).
 *
 * `source` is the stored Outline and `outline` the same thing evaluated, in Floor coordinates.
 * A producer measures on the second and signs the first, which is the same split the Walls
 * above use between `line` and `outline`.
 */
export interface WarningRoom {
  readonly id: EntityId
  readonly floorId: EntityId
  readonly name: string
  readonly source: RoomOutline
  readonly outline: ClosedPath
}

/**
 * One Placed Item as a producer may read it (#67 §16).
 *
 * The four fields the crossing warning's signature is built from are here in the form the
 * model holds them — `translation`, `rotationDeg`, `footprint`, `origin` — and never as a
 * derived path, so rotating an item moves the signature while a new sentence for the same
 * rotation does not.
 */
export interface WarningPlacement {
  readonly id: EntityId
  readonly itemDesignId: EntityId
  /**
   * What the user calls it: the Item Design's name, with ` #N` when that Design has more than
   * one Placed Item on this Floor — `Base 600 #2`. A Placed Item owns no name of its own, so
   * the ordinal is the only thing that tells two of them apart (#67 §16).
   */
  readonly label: string
  /** The Item Footprint through the placement, arcs still arcs. */
  readonly worldPath: ClosedPath
  readonly translation: Pt
  readonly rotationDeg: number
  /** The Design's Item Footprint, or `null` for a cabinet, whose outline is a scene layout. */
  readonly footprint: ItemFootprint | null
  readonly origin: Pt
  /**
   * Vertical Extent (#76 §5): the Base this placement stands at, and the height its Design gives
   * it. The height is the Design's, never the placement's — which is why a shared-height change
   * moves this number for every placement and reopens their warnings.
   */
  readonly baseElevation: number
  readonly height: number
  /**
   * The Design's Clearance Envelope (#76 §4): the stored record for the signature, and the same
   * path through the placement for the measurement — the same split `footprint` and `worldPath`
   * use, so rotating the placement moves the world path while the signed record shows the turn
   * as a rotation.
   */
  readonly clearanceEnvelope: ClearanceEnvelope | null
  readonly envelopeWorldPath: ClosedPath | null
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
  readonly openings: readonly WarningOpening[]
  readonly beams: readonly WarningBeam[]
  readonly skirtings: readonly WarningSkirting[]
  readonly junctions: readonly WarningJunction[]
  readonly rooms: readonly WarningRoom[]
  readonly placements: readonly WarningPlacement[]
  /**
   * The Floor's own Vertical limits (#76 §5), `null` where unset. A limit that is not set warns
   * about nothing — BuildBox invents no height rule for a Floor the person left open.
   */
  readonly limits: { readonly lowerMm: number | null; readonly upperMm: number | null }
}

/**
 * One Beam a producer may read (#77 §2 criterion 5).
 *
 * A Beam carries no outline here: it takes part in no plan-region overlap except a Clearance
 * Envelope, and for that the body is built from the same `linearElement` the Plan View draws with.
 * What it does carry is the two numbers every one of its warnings is measured by.
 */
export interface WarningBeam {
  readonly id: EntityId
  readonly floorId: EntityId
  /** `Beam B-3`, or `Beam` where nobody named it. */
  readonly label: string
  readonly line: { readonly start: Pt; readonly end: Pt }
  readonly width: number
  readonly justification: WallJustification
  readonly underside: number
  readonly top: number
}

/**
 * One Skirting a producer may read (#78 §6).
 *
 * The body arrives already derived — the host's tidied face stood off by `thickness`, with every
 * gap taken out — because a Skirting has no geometry of its own to read: the strip a producer
 * measures against a Placed Item is the same strip the Plan View paints, and a producer that
 * rebuilt it from the record would be answering the question a second way.
 *
 * `hostLine` and `innerOffset` are here because the one measurement this pair makes is a depth
 * perpendicular to the host face: how far the body reaches into a footprint it cannot stand in.
 */
export interface WarningSkirting {
  readonly id: EntityId
  readonly floorId: EntityId
  /** `Skirting SK-1`, or `Skirting` where nobody named it. */
  readonly label: string
  readonly hostWallId: EntityId
  readonly side: WallSide
  readonly bottom: number
  readonly top: number
  readonly thickness: number
  readonly hostLine: WallRefLine
  /** The offset of the host face the body stands off, relative to the host's reference line. */
  readonly innerOffset: number
  /** One body per visible run, gaps taken out; empty when the whole range is gapped. */
  readonly bodies: readonly ClosedPath[]
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
   * The `messageKey`s this producer's candidates can carry.
   *
   * Usually just the `type` — most producers say one sentence. A producer that measures one pair
   * but words it by its shape (the vertical relation says *above*, *below* or *over* depending on
   * how the two extents sit, #76 §3) lists the keys here, and the copy-table test fails if any of
   * them has no row.
   */
  readonly messageKeys?: readonly string[]
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
