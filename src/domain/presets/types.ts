/**
 * The shape of a built-in preset pack (#63).
 *
 * A pack is code-shipped data: a named, versioned list of starting-point dimensions a
 * homeowner can place from. It is never stored in a Project or a Backup, and a placed
 * element keeps the numbers it was given rather than a reference back here — so these
 * types hold values only, and nothing here describes behaviour. What a door swings like,
 * how a shelter is drawn or what may be edited belongs to the tool that places the
 * element (#64, #65, #67), not to the row that names its size.
 *
 * Every length is an integer in millimetres, the same canonical unit the rest of `domain`
 * stores (#13). Display conversion is the caller's, through `domain`'s own formatting.
 */

/** What kind of thing an entry sizes; also the key `defaultPresetFor` is asked with. */
export type PresetKind = 'height' | 'wall' | 'door' | 'window' | 'shelter'

/**
 * How sure the research was of a value (#33): `high` is stated outright in a primary
 * document, `medium` is derived from one or given only as a range, `low` is industry
 * convention, and `low_medium` sits between the last two. These labels are data for the
 * UI's "Typical size — measure yours." hint; they are never shown as verified.
 */
export type PresetConfidence = 'high' | 'medium' | 'low_medium' | 'low'

/**
 * A source document, keyed as the research doc keys it (#33 §8): H1 the HDB Precast
 * Pictorial Guide, H3 the HDB renovation guidelines for building works, H6 the HDB
 * Standard Schedule of Rates, H7 an HDB BTO sales brochure, H8 the HDB EASE programme,
 * B2 the BCA Approved Document, B3 the BCA Code of Practice on Buildability and S3 the
 * SCDF Technical Requirements for Household Shelters.
 */
export type SourceKey = 'H1' | 'H3' | 'H6' | 'H7' | 'H8' | 'B2' | 'B3' | 'S3'

/** One source behind a value: the document and the clause, figure or item inside it. */
export interface SourceRef {
  key: SourceKey
  /** As the document numbers it, e.g. `Figure 2A`, `C.3.3.1`, `item 0202`, `2.5.1(a)`. */
  clause: string
}

// The five value records are type aliases, not interfaces, on purpose: an alias gets an
// implicit index signature, so a caller can read or scale `entry.values` field by field —
// which is what a tool that offers the values as numbers has to do.

/** The whole flat's floor-to-ceiling height. */
export type HeightValues = {
  height: number
}

/** One wall, by its thickness. */
export type WallValues = {
  thickness: number
}

/** A door opening: the gap in the wall, which is what the plan needs. */
export type DoorValues = {
  width: number
  height: number
}

/** A window: where the glass starts and stops, and how wide it is. */
export type WindowValues = {
  /** Millimetres from the finished floor to the bottom of the glass. */
  sill: number
  /** Millimetres from the finished floor to the top of the glass. */
  head: number
  width: number
}

/** The household shelter: an internal rectangle, its walls and its door. */
export type ShelterValues = {
  internalWidth: number
  internalDepth: number
  wallThickness: number
  doorWidth: number
  doorHeight: number
}

/** The mm record each `kind` carries. */
export interface PresetValueMap {
  height: HeightValues
  wall: WallValues
  door: DoorValues
  window: WindowValues
  shelter: ShelterValues
}

/** The values of any entry, whatever its kind. */
export type PresetValues = PresetValueMap[PresetKind]

/**
 * Another size for the same thing, offered beside the entry's own value: the 2625 mm clear
 * height to the slab, the 63 mm hollow-block wall. It is a name and a value, never a
 * second entry, so a tool lists one row per thing the homeowner is picking.
 */
export interface PresetAlternative<K extends PresetKind = PresetKind> {
  /** `<entry id>.<name>`, so it is unique in the pack and addressable like an entry. */
  id: string
  name: string
  values: PresetValueMap[K]
}

/** Per-value confidence, for an entry whose values were researched to different degrees. */
export type ValueConfidence<K extends PresetKind = PresetKind> = Partial<
  Record<keyof PresetValueMap[K] & string, PresetConfidence>
>

interface PresetEntryBase<K extends PresetKind> {
  /** Stable kebab-case ID, `<kind>.<name>`: the only way a tool refers to this row. */
  id: string
  kind: K
  /** What a homeowner would call it, in plain words (#63 criterion 6). */
  name: string
  values: PresetValueMap[K]
  alternatives: PresetAlternative<K>[]
  /** The entry's own confidence; `valueConfidence` narrows it per value. */
  confidence: PresetConfidence
  /**
   * Confidence for individual values when they differ from the entry's — a window's sill
   * is high-confidence while its width is not. A value absent here takes `confidence`.
   */
  valueConfidence?: ValueConfidence<K>
  sources: SourceRef[]
  /**
   * `true` for a row whose values cannot be overridden: the household shelter. A fixed
   * entry is shown read-only and refuses an overridable copy; the elements it creates stay
   * ordinary and editable.
   */
  fixed: boolean
  /** A plain-language line for the option panel, e.g. `Typical size — measure yours.` */
  hint?: string
}

/** The whole flat's floor-to-ceiling height. */
export type HeightPreset = PresetEntryBase<'height'>

/** One wall, by its thickness. */
export type WallPreset = PresetEntryBase<'wall'>

/** A door opening. */
export type DoorPreset = PresetEntryBase<'door'>

/** A window. */
export type WindowPreset = PresetEntryBase<'window'>

/** The household shelter. */
export type ShelterPreset = PresetEntryBase<'shelter'>

/** One row of a pack: one thing a homeowner can place, and the sizes it comes in. */
export type PresetEntry = HeightPreset | WallPreset | DoorPreset | WindowPreset | ShelterPreset

/**
 * One versioned list of entries, shipped in code. `version` rises when a value changes,
 * which is what lets a later issue say "this Project was placed from pack v1".
 */
export interface PresetPack {
  id: string
  name: string
  version: number
  /** Said above the whole list wherever it is picked from (#33 §7.1). */
  hint: string
  /** Declared order is display order; `listPresetEntries` keeps it. */
  entries: PresetEntry[]
}
