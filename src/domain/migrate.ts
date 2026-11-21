/**
 * The domain schema version and its migrator chain (#42 §5).
 *
 * `DOMAIN_SCHEMA_VERSION` is one of three independent version constants (#20 §12): the
 * workspace file version and the IndexedDB `schemaVersion` say nothing about it. It says
 * what shape a Project has.
 *
 * Migration is explicit and sequential (#14): one pure migrator per version bump, never
 * a best-effort cast, always on a copy, and a version this build does not know is
 * refused before anything is mutated. `MIGRATIONS.md` next door is the rule for the
 * issue that adds the next one.
 */
import type { ValidationProblem } from '../lib'
import type { IdAllocator } from './remapIds'
import type { Floor, PlanView, Project } from './project'
import { validateProject } from './validate'

/** The domain schema this build writes and understands at the top of the chain. */
export const DOMAIN_SCHEMA_VERSION = 7

/**
 * One pure vN → vN+1 step. Its input is already a copy; it never reads the clock, and a
 * step that needs new IDs is handed an allocator rather than minting one (#42 §3).
 */
export type Migrator = (data: unknown, allocateId: IdAllocator) => unknown

/**
 * `MIGRATORS[i]` migrates v(i+1) → v(i+2), so index 0 is v1 → v2.
 */
export const MIGRATORS: readonly Migrator[] = [migrateV1toV2, migrateV2toV3, migrateV3toV4, migrateV4toV5, migrateV5toV6, migrateV6toV7]

/**
 * v1 → v2 (#56): the Project gains `views`, and each Floor gains the one default Plan
 * View that shows it.
 *
 * Nothing else moves. `Floor.limits` is absent rather than defaulted — a Floor whose
 * extent nobody typed has no limits, and inventing `0` would be a claim about the
 * building. The view takes its name from the Floor it shows, because that is the label
 * the switcher would otherwise have to invent per render, and it shows the Plan Image,
 * which is what every v1 Plan View did. IDs come from `allocateId`, called once with the
 * number of Floors, so a migrated Project is fully determined by its input plus the IDs
 * the caller brought.
 *
 * A value that is not a Project shape comes back with `views: []` added and is left for
 * `validateProject` to refuse: a migrator repairs versions, it never repairs data.
 */
export function migrateV1toV2(data: unknown, allocateId: IdAllocator): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  const floors: readonly unknown[] = Array.isArray(record.floors) ? record.floors : []
  const shaped = floors.filter(
    (floor): floor is Floor =>
      floor !== null && typeof floor === 'object' && typeof (floor as Floor).id === 'string',
  )
  const ids = allocateId(shaped.length)
  const views: PlanView[] = shaped.map((floor, index) => ({
    id: ids[index] as string,
    kind: 'plan',
    floorId: floor.id,
    name: typeof floor.name === 'string' ? floor.name : '',
    isDefault: true,
    showPlanImage: true,
  }))
  return { ...record, views }
}

/**
 * v2 → v3 (#58): an Item Footprint becomes a shape rather than a pair of numbers.
 *
 * Every v2 footprint is the same Rectangle preset, placed so that it draws exactly what v2
 * drew: local corners `(0,0)` to `(width,depth)`, which is what a Rectangle centred at
 * `(width / 2, depth / 2)` with no turn evaluates to. The geometry is therefore identical,
 * which is the whole point — a Project that never opens the shape editor keeps the outline,
 * the measurements and the Item Origin it had, and only the *description* of the shape has
 * changed.
 *
 * A footprint this build cannot read is left exactly as it is for `validateProject` to
 * refuse: a migrator repairs versions, it never repairs data. Nothing else moves, and no ID
 * is spent.
 */
export function migrateV2toV3(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  if (!Array.isArray(record.itemDesigns)) return data
  return {
    ...record,
    itemDesigns: record.itemDesigns.map((design) => {
      if (design === null || typeof design !== 'object' || Array.isArray(design)) return design
      const entry = design as Record<string, unknown>
      const footprint = entry.footprint
      if (footprint === null || typeof footprint !== 'object' || Array.isArray(footprint)) return design
      const shape = footprint as Record<string, unknown>
      if (shape.kind !== 'rectangle') return design
      const { width, depth } = shape
      if (typeof width !== 'number' || typeof depth !== 'number') return design
      return {
        ...entry,
        footprint: {
          kind: 'preset',
          preset: { kind: 'rectangle', width, depth },
          centre: { x: width / 2, y: depth / 2 },
          orientationDeg: 0,
        },
      }
    }),
  }
}

/**
 * The Wall height a Project without one gets: the HDB BTO typical ceiling height from the
 * pack entry `height.ceiling` (#33, #63).
 *
 * The number is written here rather than read from the pack because a migrator is a record
 * of what this release did: if the pack's typical ceiling ever changed, projects migrated
 * from v3 would silently change height. `migrate.test.ts` pins it to the pack entry it came
 * from, so the two cannot drift unnoticed.
 */
export const DEFAULT_WALL_HEIGHT_MM = 2600

/**
 * v3 → v4 (#64): the Existing Model gains the two Wall collections, and the Project gains a
 * default Wall height.
 *
 * `existingModel.walls` and `existingModel.wallJunctions` start empty — no v3 data describes
 * a Wall, and the legacy `wall-hack` sketch stays discarded rather than becoming a Wall
 * (#20 §12) — and `preferences.defaultWallHeight` is the pack's ceiling height, which is what
 * a Wall drawn by this build's Wall tool gets unless the Floor says otherwise. A Floor's own
 * `defaultWallHeight` stays absent: nobody measured a Floor in v3 that had one.
 *
 * Nothing else moves, no ID is spent, and a value that is not a Project shape is left for
 * `validateProject` to refuse. The step is idempotent: a record that already carries Walls,
 * Junctions or a chosen default height keeps them, so running it twice — or running it on a
 * record that only needed the other half of the step — cannot empty a Project of its Walls.
 */
export function migrateV3toV4(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  const next: Record<string, unknown> = { ...record }
  if (record.preferences !== null && typeof record.preferences === 'object' && !Array.isArray(record.preferences)) {
    const preferences = record.preferences as Record<string, unknown>
    // A height already stored is a height somebody chose; a step that adds a field never
    // overwrites the one it was meant to add.
    next.preferences = { ...preferences, defaultWallHeight: preferences.defaultWallHeight ?? DEFAULT_WALL_HEIGHT_MM }
  }
  if (record.existingModel !== null && typeof record.existingModel === 'object' && !Array.isArray(record.existingModel)) {
    const existingModel = record.existingModel as Record<string, unknown>
    const kept = (key: 'walls' | 'wallJunctions'): unknown[] =>
      Array.isArray(existingModel[key]) ? (existingModel[key] as unknown[]) : []
    next.existingModel = {
      ...existingModel,
      walls: kept('walls'),
      wallJunctions: kept('wallJunctions'),
    }
  }
  return next
}

/**
 * v4 → v5 (#65): the Existing Model gains the Opening collection.
 *
 * `existingModel.openings` starts empty — no v4 data describes a door or a window, and an
 * Opening is an absence in a Wall rather than a thing that can be inferred from a floor
 * plan — and nothing else moves. Every v4 field keeps its meaning: an Opening is hosted by
 * a Wall, and Walls arrived with v4, so there is no older shape to carry forward. No ID is
 * spent, and a value that is not a Project shape is left for `validateProject` to refuse.
 */
export function migrateV4toV5(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  if (record.existingModel === null || typeof record.existingModel !== 'object' || Array.isArray(record.existingModel)) {
    return record
  }
  const existingModel = record.existingModel as Record<string, unknown>
  // A record that already carries the collection keeps it: a step that adds a field never
  // overwrites the one it was meant to add.
  return {
    ...record,
    existingModel: {
      ...existingModel,
      openings: Array.isArray(existingModel.openings) ? existingModel.openings : [],
    },
  }
}

/**
 * v5 → v6 (#66): the Project gains the warning acknowledgement collection.
 *
 * `warningAcknowledgements` starts empty — no v5 data records that a user saw a warning, and
 * inventing one would be inventing a decision nobody made. Nothing else moves: an
 * acknowledgement refers to entities by ID and to a Design Option that does not exist yet, so
 * there is no older shape to carry forward. No ID is spent, and a value that is not a Project
 * shape is left for `validateProject` to refuse.
 *
 * The step is idempotent: a record that already carries the collection keeps it, so running it
 * twice cannot empty a Project of the acknowledgements it was given.
 */
export function migrateV5toV6(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  return {
    ...record,
    warningAcknowledgements: Array.isArray(record.warningAcknowledgements) ? record.warningAcknowledgements : [],
  }
}

/**
 * v6 → v7 (#67): Rooms.
 *
 * `existingModel.rooms` is the only change, and an older file simply has none. Nothing else
 * moves: a Room is a new kind of element rather than a change to one, so no Wall, Opening or
 * Placement is rewritten and no ID is spent.
 *
 * A v6 file cannot already carry the field — the strict validator rejected unknown fields on
 * every write — so an array found here came from a newer build, and is left exactly as it is.
 */
export function migrateV6toV7(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  const existing = record.existingModel
  if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) return data
  const model = existing as Record<string, unknown>
  if (Array.isArray(model.rooms)) return data
  return { ...record, existingModel: { ...model, rooms: [] } }
}

export type MigrateError =
  /** Data from a newer BuildBox: refused, never guessed at (#20 §5). */
  | { kind: 'newer-schema'; found: number; supported: number; message: string }
  /** No usable version on the envelope at all. */
  | { kind: 'unknown-schema'; found: unknown; message: string }
  /** Migrated, but still not a valid Project. */
  | { kind: 'invalid'; problems: ValidationProblem[]; message: string }

export type MigrateResult =
  | { ok: true; project: Project; migratedFrom: number }
  | { ok: false; error: MigrateError }

/**
 * Apply `chain` to `data` from version `from` up to the top, on a copy.
 *
 * Exported separately from {@link migrateProject} so a test can drive a synthetic
 * multi-step chain without shipping fake schema versions. `from` is assumed to be an
 * integer of 1 or more; a chain shorter than `from` applies no steps.
 */
export function runMigrationChain(
  data: unknown,
  from: number,
  chain: readonly Migrator[],
  allocateId: IdAllocator,
): unknown {
  // Migration always runs on a copy: the caller's value is never mutated (#14).
  let current = structuredClone(data)
  for (let index = from - 1; index < chain.length; index += 1) {
    current = (chain[index] as Migrator)(current, allocateId)
  }
  return current
}

/**
 * Bring `data`, recorded as arriving at `fromVersion`, up to {@link DOMAIN_SCHEMA_VERSION}
 * and validate it. `fromVersion` is `unknown` because it comes off an untrusted envelope.
 *
 * `allocateId` is only spent when a step actually runs, but it is always a parameter: the
 * caller decides where new IDs come from, and a Project already at the top of the chain
 * simply never asks (#42 §3).
 */
export function migrateProject(data: unknown, fromVersion: unknown, allocateId: IdAllocator): MigrateResult {
  if (typeof fromVersion !== 'number' || !Number.isInteger(fromVersion) || fromVersion < 1) {
    return {
      ok: false,
      error: {
        kind: 'unknown-schema',
        found: fromVersion,
        message: `This Project's schema version is missing or unreadable — expected a whole number of 1 or more, found ${String(fromVersion)}.`,
      },
    }
  }

  if (fromVersion > DOMAIN_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        kind: 'newer-schema',
        found: fromVersion,
        supported: DOMAIN_SCHEMA_VERSION,
        message: `This Project was saved by a newer BuildBox (schema ${fromVersion}). This version opens schema ${DOMAIN_SCHEMA_VERSION} and older.`,
      },
    }
  }

  const migrated = runMigrationChain(data, fromVersion, MIGRATORS, allocateId)
  const result = validateProject(migrated)
  if (!result.ok) {
    return {
      ok: false,
      error: {
        kind: 'invalid',
        problems: result.problems,
        message: `This Project does not match BuildBox domain schema ${DOMAIN_SCHEMA_VERSION}.`,
      },
    }
  }

  return { ok: true, project: result.project, migratedFrom: fromVersion }
}
