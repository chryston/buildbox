/**
 * The preset lookup (#63 §3).
 *
 * Tools refer to a preset **by ID** and nothing else. `getPresetEntry` hands out the frozen
 * row; the tool's Intent builder reads the millimetres out of it and puts those numbers in
 * the Intent, so an Intent payload holds values rather than a live link and replaying an
 * old Intent gives the same result whatever this file says now. `overridableCopyOf` is the
 * one writable door into a row, for a tool option panel that lets the homeowner change a
 * size before placing; a `fixed` row refuses it.
 *
 * Nothing here draws, places, locks or warns. The pack is data, and the consuming issues
 * (#64, #65, #67, #75) own every behaviour around it.
 */
import type { DisplayUnit } from '../project'
import { formatLength } from '../units/unitConversion'
import { HDB_BTO_TYPICAL } from './hdbBtoTypical'
import type { PresetEntry, PresetKind, PresetPack } from './types'

export type {
  DoorPreset,
  DoorValues,
  HeightPreset,
  HeightValues,
  PresetAlternative,
  PresetConfidence,
  PresetEntry,
  PresetKind,
  PresetPack,
  PresetValueMap,
  PresetValues,
  ShelterPreset,
  ShelterValues,
  SourceKey,
  SourceRef,
  ValueConfidence,
  WallPreset,
  WallValues,
  WindowPreset,
  WindowValues,
} from './types'

/** Thrown when a pack or entry ID names nothing. `entryId` is `null` for an unknown pack. */
export class UnknownPreset extends Error {
  readonly packId: string
  readonly entryId: string | null

  constructor(packId: string, entryId: string | null) {
    super(entryId === null ? `No preset pack is named ${packId}` : `Preset pack ${packId} has no entry ${entryId}`)
    this.name = 'UnknownPreset'
    this.packId = packId
    this.entryId = entryId
  }
}

/**
 * Thrown when an overridable copy is asked for of a row whose values come as they are —
 * the household shelter. A panel shows such a row read-only; the elements it creates stay
 * ordinary and editable.
 */
export class FixedPreset extends Error {
  readonly entryId: string

  constructor(entry: PresetEntry) {
    super(`Preset ${entry.id} comes with its own values, so there is nothing to override`)
    this.name = 'FixedPreset'
    this.entryId = entry.id
  }
}

/** Every pack this build ships, by ID. One for now (#33 §7.1). */
const PACKS: Readonly<Record<string, PresetPack>> = { [HDB_BTO_TYPICAL.id]: HDB_BTO_TYPICAL }

/** The kinds that have a default. `shelter` has none: there is one shelter and it is named. */
export type DefaultableKind = Exclude<PresetKind, 'shelter'>

/** The entry each defaultable kind starts from (#63 §3). */
const DEFAULT_ENTRY_ID: Readonly<Record<DefaultableKind, string>> = {
  height: 'height.ceiling',
  wall: 'wall.internal',
  door: 'door.bedroom',
  window: 'window.standard',
}

/** The entry of `kind` a tool starts with, typed as that kind. */
export type DefaultPresetOf<K extends DefaultableKind> = Extract<PresetEntry, { kind: K }>

/** The entries of one kind, typed as that kind. */
export type PresetOf<K extends PresetKind> = Extract<PresetEntry, { kind: K }>

/**
 * The pack named by `id`, or `UnknownPreset`.
 *
 * The returned object is frozen: it is the one shared copy, and a tool that wants to write
 * takes `overridableCopyOf` of the entry it means to change.
 */
export function getPresetPack(id: string): PresetPack {
  const pack = PACKS[id]
  if (pack === undefined) throw new UnknownPreset(id, null)
  return pack
}

/**
 * One entry by pack and entry ID, or `UnknownPreset` for either half.
 *
 * This is the only way a tool reaches a row: it holds the ID, never the object, so a pack
 * change can never reach into a placed element.
 */
export function getPresetEntry(packId: string, entryId: string): PresetEntry {
  const pack = getPresetPack(packId)
  const entry = pack.entries.find((candidate) => candidate.id === entryId)
  if (entry === undefined) throw new UnknownPreset(packId, entryId)
  return entry
}

/** Every entry of `kind`, in the order the pack declares them — the order a picker lists. */
export function listPresetEntries<K extends PresetKind>(packId: string, kind: K): PresetOf<K>[] {
  return getPresetPack(packId).entries.filter((entry) => entry.kind === kind) as PresetOf<K>[]
}

/**
 * The entry a tool of this kind starts with: a bedroom door, a 100 mm inside wall, a 2600 mm
 * ceiling, a standard window. The 900 × 2100 bedroom door supersedes the interim door default
 * #22 carried while the research was open; that value was never shipped, so nothing migrates.
 */
export function defaultPresetFor<K extends DefaultableKind>(kind: K): DefaultPresetOf<K> {
  return getPresetEntry(HDB_BTO_TYPICAL.id, DEFAULT_ENTRY_ID[kind]) as DefaultPresetOf<K>
}

/**
 * A writable copy of an entry, for a tool option panel that changes a size before placing.
 *
 * The copy is deep — `values`, `alternatives` and `sources` included — so writing to it
 * cannot reach the pack, and the pack cannot reach it afterwards. A `fixed` entry has no
 * writable copy: asking for one throws `FixedPreset`, which is what keeps the household
 * shelter read-only without a lock concept (#87).
 */
export function overridableCopyOf<E extends PresetEntry>(entry: E): E {
  if (entry.fixed) throw new FixedPreset(entry)
  return structuredClone(entry)
}

/**
 * What an entry is called, with its dimensions after it: `Bedroom door · 900 × 2100 mm`.
 *
 * The numbers follow the Project's display unit and precision (#13) rather than any unit
 * this file knows, so the same entry reads `0.900 × 2.100 m` in a Project set to metres.
 * Each kind says what it measures in the order a homeowner reads it: a door is width by
 * height, a window is width by glass height with its sill, a shelter is the inside rectangle
 * with its door.
 */
export function presetDisplayName(entry: PresetEntry, unit: DisplayUnit, precision: number): string {
  const n = (mm: number): string => formatLength(mm, unit, precision)
  const named = (dimensions: string): string => `${entry.name} · ${dimensions}`
  switch (entry.kind) {
    case 'height':
      return named(`${n(entry.values.height)} ${unit}`)
    case 'wall':
      return named(`${n(entry.values.thickness)} ${unit}`)
    case 'door':
      return named(`${n(entry.values.width)} × ${n(entry.values.height)} ${unit}`)
    case 'window': {
      const { sill, head, width } = entry.values
      return named(`${n(width)} × ${n(head - sill)} ${unit} · sill ${n(sill)} ${unit}`)
    }
    case 'shelter': {
      const { internalWidth, internalDepth, doorWidth, doorHeight } = entry.values
      return named(
        `${n(internalWidth)} × ${n(internalDepth)} ${unit} · door ${n(doorWidth)} × ${n(doorHeight)} ${unit}`,
      )
    }
  }
}
