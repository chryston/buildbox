/**
 * The output vocabulary of the legacy → domain converter (#43).
 *
 * These are the shapes the Migration review (S4, #52) consumes: one proposal per legacy
 * `Design`, the global floor plan kept separate because nothing here may guess its owner
 * (#14, #11 finding 4), and the decoded image bytes the asset store will be asked to keep.
 *
 * Nothing in here is a domain type: a proposal is either a strictly valid domain `Project`
 * or the problems that stopped it becoming one. A `Design` is never partially converted.
 */
import type { GenericItemDesign, PlanImage, Point2, Project } from '../../domain'
import type { ValidationProblem } from '../../lib'

export type LegacyConversionSource = 'store' | 'workspace-file' | 'floor-plan-file'

/**
 * Which ID namespace a regenerated ID came from. `cabinet-node` is the whole feature
 * namespace of one Item Design — spaces, dividers and accessories share it (#42 §3) —
 * `unit` is the unit IDs inside one `Design`, and `floor-plan` is every ID inside the
 * floor plan: objects, annotations and saved shapes together.
 */
export type IdRegenerationScope = 'cabinet-node' | 'unit' | 'floor-plan'

/**
 * One duplicate ID replaced by the injected allocator. `path` locates the value whose ID
 * was replaced in the value it came from: the legacy source for a conversion
 * (`projects[0].units[1].root.children[0].id`), and the produced Project for
 * {@link attachFloorPlan} (`itemDesigns[3].id`).
 */
export interface IdRegeneration {
  scope: IdRegenerationScope
  path: string
  oldId: string
  newId: string
}

/** A converted `Design`: a Project that passed the domain v1 validator, or the reasons it did not. */
export type LegacyProjectProposal =
  | {
      designId: string
      name: string
      status: 'ok'
      project: Project
      regeneratedIds: IdRegeneration[]
    }
  | {
      designId: string
      name: string
      status: 'rejected'
      problems: ValidationProblem[]
    }

/**
 * The mapped floor plan, before anyone chooses its owner. A placement carries everything a
 * Placed Item needs except the Floor, which is the choice the user makes (#14).
 */
export interface LegacyFloorPlanContent {
  planImage: PlanImage | null
  itemDesigns: GenericItemDesign[]
  placements: Array<{
    id: string
    itemDesignId: string
    translation: Point2
    rotationDeg: number
    baseElevation: number
  }>
}

/** What the converter threw away, counted per type (#20 §15.5, #22). */
export interface LegacyDiscardedSketches {
  wallHack: number
  tileZone: number
}

export type LegacyFloorPlanConversion =
  | {
      status: 'ok'
      /** No image, no objects, no annotations and no saved shapes: the review offers "skip". */
      isEmpty: boolean
      content: LegacyFloorPlanContent
      discarded: LegacyDiscardedSketches
      regeneratedIds: IdRegeneration[]
    }
  | { status: 'rejected'; problems: ValidationProblem[] }

/** One decoded image: the bytes behind a Plan Image, deduplicated by their SHA-256. */
export interface LegacyAsset {
  sha256: string
  mediaType: string
  bytes: Uint8Array
}

export interface LegacyConversion {
  source: LegacyConversionSource
  legacyVersion: 0 | 1 | 2 | 3
  /** The active `Design` first, then legacy array order (#20 §3). */
  projects: LegacyProjectProposal[]
  /** `null` when the source holds no floor plan at all — a workspace file. */
  floorPlan: LegacyFloorPlanConversion | null
  assets: LegacyAsset[]
}

/**
 * A conversion, or the problems with the source as a whole: unreadable JSON, an envelope
 * with no usable version, a value that is none of the three legacy sources. Anything wrong
 * with one `Design` or with the floor plan is reported inside the conversion instead.
 */
export type LegacyConversionResult =
  | { ok: true; conversion: LegacyConversion }
  | { ok: false; problems: ValidationProblem[] }
