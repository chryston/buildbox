/**
 * The Door / window tool's preset picker (#65 §9).
 *
 * The rows come out of the shipped pack rather than being typed again here: the pack is the
 * one place a number lives, and a picker with its own copy of `900` is a second answer to a
 * question that already has one. Two rows are not pack entries at all — the household shelter
 * door, which is the shelter entry's own door, and the removed wall section, which is not a
 * product with a size — and they are built beside the pack rather than smuggled into it.
 *
 * A placed Opening never points back at a row: `resolveOpeningPreset` reads the millimetres
 * out and the Intent carries those numbers, so editing the pack afterwards changes what a
 * *new* door starts with and nothing that is already in a Wall (#63 §3).
 */
import { getPresetEntry } from '../../../domain'
import { STRINGS } from '../../strings'
import type { OpeningKind, OpeningSwing } from '../../../domain'

/** The one built-in pack (#63). */
const PACK = 'hdb-bto-typical'

/** The three headings the picker lists its rows under, in the order it lists them. */
export type OpeningPresetGroup = 'Doors' | 'Windows' | 'Other'

/** One row of the picker: a plain name, the size it stands for, and how sure it is. */
export interface OpeningPresetRow {
  readonly id: string
  readonly group: OpeningPresetGroup
  /** `Bedroom door` — the words the row shows, with the size after them. */
  readonly name: string
  readonly kind: OpeningKind
  /** Doors only; `sliding` for the kitchen row, `undefined` for anything that is not a door. */
  readonly swing: OpeningSwing | undefined
  readonly width: number
  /** Millimetres above the Floor Datum. */
  readonly sill: number
  /** Millimetres above the Floor Datum, or `null` for the host Wall's own height. */
  readonly head: number | null
  /** A `fixed` pack row: its numbers are shown and never edited (#65 §9). */
  readonly fixed: boolean
  /** The pack's own note, on the rows whose numbers are typical rather than measured. */
  readonly hint: string | null
}

/** A door row: the pack's `width × height`, standing on the floor. */
function doorRow(entryId: string, swing: OpeningSwing | undefined, name?: string): OpeningPresetRow {
  const entry = getPresetEntry(PACK, entryId)
  if (entry.kind !== 'door') throw new Error(`${entryId} is not a door entry`)
  return {
    id: entry.id,
    group: 'Doors',
    name: name ?? entry.name,
    kind: 'door',
    swing,
    width: entry.values.width,
    sill: 0,
    head: entry.values.height,
    fixed: entry.fixed,
    hint: entry.hint ?? null,
  }
}

/** A window row: the pack's sill, head and width, with the sill the row leads with. */
function windowRow(entryId: string): OpeningPresetRow {
  const entry = getPresetEntry(PACK, entryId)
  if (entry.kind !== 'window') throw new Error(`${entryId} is not a window entry`)
  return {
    id: entry.id,
    group: 'Windows',
    name: entry.name,
    kind: 'window',
    swing: undefined,
    width: entry.values.width,
    sill: entry.values.sill,
    head: entry.values.head,
    fixed: entry.fixed,
    hint: entry.hint ?? null,
  }
}

/**
 * The shelter door is the shelter entry's own door: 700 × 1900, from the row whose numbers
 * cannot be changed because they are what the shelter *is*.
 */
function shelterDoorRow(): OpeningPresetRow {
  const entry = getPresetEntry(PACK, 'shelter.household')
  if (entry.kind !== 'shelter') throw new Error('shelter.household is not a shelter entry')
  return {
    id: 'shelter.household.door',
    group: 'Doors',
    name: STRINGS.householdShelterDoor,
    kind: 'door',
    swing: 'left',
    width: entry.values.doorWidth,
    sill: 0,
    head: entry.values.doorHeight,
    fixed: true,
    hint: entry.hint ?? null,
  }
}

/**
 * The removed wall section: an opening with no door and no glass in it, whose height is
 * whatever the Wall it is cut into happens to be.
 */
const REMOVED_ROW: OpeningPresetRow = {
  id: 'other.removed-section',
  group: 'Other',
  name: STRINGS.removedWallSection,
  kind: 'removed_section',
  swing: undefined,
  width: 900,
  sill: 0,
  head: null,
  fixed: false,
  hint: null,
}

/**
 * Every row, grouped. The bedroom door leads the Doors group because it is the row the tool
 * starts on (#65 §9), and the rest follow in the order the pack declares them.
 */
export const OPENING_PRESET_GROUPS: readonly { group: OpeningPresetGroup; rows: readonly OpeningPresetRow[] }[] = [
  {
    group: 'Doors',
    rows: [
      doorRow('door.bedroom', 'left'),
      doorRow('door.main', 'left'),
      doorRow('door.bathroom', 'left'),
      doorRow('door.kitchen-sliding', 'sliding'),
      shelterDoorRow(),
    ],
  },
  {
    group: 'Windows',
    rows: [windowRow('window.standard'), windowRow('window.full-height'), windowRow('window.three-quarter')],
  },
  { group: 'Other', rows: [REMOVED_ROW] },
]

/** The row the tool opens on: the door most people are placing. */
export const DEFAULT_OPENING_PRESET_ID = 'door.bedroom'

const ALL_ROWS = OPENING_PRESET_GROUPS.flatMap((section) => section.rows)

/** The row behind an id, or the default when the id is not one the picker offers. */
export const openingPresetRow = (id: string): OpeningPresetRow =>
  ALL_ROWS.find((row) => row.id === id) ?? ALL_ROWS[0]!

/**
 * The millimetres a row resolves to against one host Wall.
 *
 * Only the removed section asks: its top is the Wall's own height, because a section knocked
 * through a Wall is as tall as that Wall.
 */
export const resolveOpeningPreset = (
  row: OpeningPresetRow,
  hostHeight: number,
): { kind: OpeningKind; swing: OpeningSwing | undefined; width: number; sill: number; head: number } => ({
  kind: row.kind,
  swing: row.swing,
  width: row.width,
  sill: row.sill,
  head: row.head ?? hostHeight,
})

/**
 * The row's label: `Bedroom door · 900 × 2100 mm`, `Standard window · sill 1050 mm`, `Removed
 * wall section`.
 *
 * A door says width by height, because that is how a door is bought. A window leads with its
 * sill, because the height of the glass is what the Wall decides and the sill is what the room
 * feels. The numbers follow the Project's display unit (#13).
 */
export const openingPresetLabel = (
  row: OpeningPresetRow,
  num: (mm: number) => string,
  unit: string,
): string => {
  if (row.kind === 'window') return `${row.name} · sill ${num(row.sill)} ${unit}`
  if (row.head === null) return row.name
  return `${row.name} · ${num(row.width)} × ${num(row.head - row.sill)} ${unit}`
}
