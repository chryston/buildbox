/**
 * The "HDB BTO (typical)" pack, row by row (#63 criteria 1, 2, 4, 6, 7).
 *
 * The table below is the issue's table, and it is the point of the file: every value,
 * alternative, confidence label and source clause is written here a second time, straight
 * from the #33 research, so a value that drifts in the pack has to be drifted here too —
 * and the row that does that is named by its own ID rather than by a diff nobody reads.
 * The `research` column says which section of the research doc the row comes from, which is
 * what makes a reviewer's check a lookup rather than a memory test.
 *
 * Everything else the issue fixes is asserted alongside it: the defaults, the two typed
 * lookup errors, the freeze, the plain-language hint rule, and the display name in each
 * Project display unit.
 */
import { describe, expect, it } from 'vitest'
import {
  FixedPreset,
  UnknownPreset,
  defaultPresetFor,
  getPresetEntry,
  getPresetPack,
  listPresetEntries,
  overridableCopyOf,
  presetDisplayName,
  type PresetAlternative,
  type PresetConfidence,
  type PresetEntry,
  type PresetKind,
  type SourceKey,
} from '../index'

const PACK_ID = 'hdb-bto-typical'

/** One row of the issue's table, with the research section behind it. */
interface Row {
  id: string
  kind: PresetKind
  name: string
  values: Record<string, number>
  alternatives: PresetAlternative[]
  confidence: PresetConfidence
  valueConfidence?: Record<string, PresetConfidence>
  sources: { key: SourceKey; clause: string }[]
  fixed: boolean
  hint?: string
  /** Where #33 gives this row, so a value can be checked against its source. */
  research: string
}

const MEASURE_YOURS = 'Typical size — measure yours.'

const ROWS: Row[] = [
  {
    id: 'height.ceiling',
    kind: 'height',
    name: 'Ceiling height',
    values: { height: 2600 },
    alternatives: [
      { id: 'height.ceiling.clear-to-slab', name: 'Clear height to slab', values: { height: 2625 } },
      { id: 'height.ceiling.under-false-ceiling', name: 'Under a false ceiling', values: { height: 2400 } },
    ],
    confidence: 'high',
    sources: [
      { key: 'H1', clause: '§1.5 + Figure 1A' },
      { key: 'B2', clause: 'C.3.3.1' },
    ],
    fixed: false,
    research: '#33 §1.1, §2',
  },
  {
    id: 'wall.internal',
    kind: 'wall',
    name: 'Inside wall',
    values: { thickness: 100 },
    alternatives: [
      { id: 'wall.internal.hollow-block', name: 'Hollow block wall', values: { thickness: 63 } },
      { id: 'wall.internal.glass-block', name: 'Glass block wall', values: { thickness: 80 } },
    ],
    confidence: 'medium',
    sources: [
      { key: 'H3', clause: 'Walls' },
      { key: 'H1', clause: 'Figure 2A' },
    ],
    fixed: false,
    research: '#33 §1.1, §3',
  },
  {
    id: 'wall.kitchen',
    kind: 'wall',
    name: 'Kitchen wall',
    values: { thickness: 120 },
    alternatives: [],
    confidence: 'high',
    sources: [{ key: 'H1', clause: 'Figure 2A' }],
    fixed: false,
    research: '#33 §1.1, §3',
  },
  {
    id: 'wall.outside',
    kind: 'wall',
    name: 'Outside wall',
    values: { thickness: 150 },
    alternatives: [
      {
        id: 'wall.outside.bathroom-yard-corridor',
        name: 'Outside wall at bathroom, service yard or corridor',
        values: { thickness: 100 },
      },
    ],
    confidence: 'high',
    sources: [{ key: 'H1', clause: 'Figure 2A' }],
    fixed: false,
    research: '#33 §1.1, §3',
  },
  {
    id: 'wall.block-end',
    kind: 'wall',
    name: 'End wall of the block',
    values: { thickness: 175 },
    alternatives: [],
    confidence: 'high',
    sources: [{ key: 'H1', clause: 'Figure 2A' }],
    fixed: false,
    research: '#33 §1.1, §3',
  },
  {
    id: 'door.main',
    kind: 'door',
    name: 'Main door',
    values: { width: 1000, height: 2190 },
    alternatives: [],
    confidence: 'high',
    sources: [{ key: 'H6', clause: 'item 0202' }],
    fixed: false,
    research: '#33 §1.2, §4.2',
  },
  {
    id: 'door.bedroom',
    kind: 'door',
    name: 'Bedroom door',
    values: { width: 900, height: 2100 },
    alternatives: [],
    confidence: 'high',
    sources: [
      { key: 'B3', clause: 'Table 2C' },
      { key: 'H6', clause: 'item 0196' },
    ],
    fixed: false,
    research: '#33 §1.2, §4.2',
  },
  {
    id: 'door.bathroom',
    kind: 'door',
    name: 'Bathroom door',
    values: { width: 800, height: 2100 },
    alternatives: [],
    confidence: 'low_medium',
    sources: [{ key: 'H8', clause: 'Toilet entrance width criterion' }],
    fixed: false,
    hint: MEASURE_YOURS,
    research: '#33 §1.2, §4.2, §9',
  },
  {
    id: 'door.kitchen-sliding',
    kind: 'door',
    name: 'Kitchen sliding door',
    values: { width: 850, height: 2190 },
    alternatives: [],
    confidence: 'high',
    sources: [{ key: 'H6', clause: 'item 0203' }],
    fixed: false,
    research: '#33 §1.2, §4.2',
  },
  {
    id: 'window.standard',
    kind: 'window',
    name: 'Standard window',
    values: { sill: 1050, head: 2300, width: 1200 },
    alternatives: [],
    confidence: 'high',
    valueConfidence: { width: 'low' },
    sources: [{ key: 'H1', clause: 'Figure 1A' }],
    fixed: false,
    hint: MEASURE_YOURS,
    research: '#33 §1.3, §5.1, §5.2',
  },
  {
    id: 'window.full-height',
    kind: 'window',
    name: 'Full-height window',
    values: { sill: 300, head: 2600, width: 1200 },
    alternatives: [],
    confidence: 'high',
    valueConfidence: { head: 'medium', width: 'low' },
    sources: [
      { key: 'H7', clause: 'legend W1' },
      { key: 'H1', clause: 'Figure 1A' },
    ],
    fixed: false,
    hint: MEASURE_YOURS,
    research: '#33 §1.3, §5.1, §5.2',
  },
  {
    id: 'window.three-quarter',
    kind: 'window',
    name: 'Three-quarter-height window',
    values: { sill: 550, head: 2300, width: 1200 },
    alternatives: [],
    confidence: 'high',
    valueConfidence: { width: 'low' },
    sources: [{ key: 'H7', clause: 'legend W2' }],
    fixed: false,
    hint: MEASURE_YOURS,
    research: '#33 §1.3, §5.1, §5.2',
  },
  {
    id: 'shelter.household',
    kind: 'shelter',
    name: 'Household shelter',
    values: { internalWidth: 1450, internalDepth: 1950, wallThickness: 250, doorWidth: 700, doorHeight: 1900 },
    alternatives: [],
    confidence: 'high',
    sources: [
      { key: 'B3', clause: 'Table 2A' },
      { key: 'S3', clause: '2.3.1' },
      { key: 'S3', clause: '2.5.1(a)' },
      { key: 'H1', clause: 'Figure 2A' },
    ],
    fixed: true,
    research: '#33 §1.4, §6.1, §6.2, §6.3',
  },
]

const pack = getPresetPack(PACK_ID)
const entryOf = (id: string): PresetEntry => getPresetEntry(PACK_ID, id)

describe('the pack', () => {
  it('is the one HDB BTO (typical) pack, version 1, with the pack-level hint', () => {
    expect(pack.id).toBe(PACK_ID)
    expect(pack.name).toBe('HDB BTO (typical)')
    expect(pack.version).toBe(1)
    expect(pack.hint).toBe('Starting point — check your HDB floor plan.')
  })

  it('holds exactly the table rows, in the order the table declares them', () => {
    expect(pack.entries.map((entry) => entry.id)).toEqual(ROWS.map((row) => row.id))
  })
})

describe.each(ROWS)('$id', (row) => {
  const entry = entryOf(row.id)

  it('is the row the issue names, with the research section behind it', () => {
    expect(entry.kind).toBe(row.kind)
    expect(entry.name).toBe(row.name)
    expect(row.research).toMatch(/^#33 §/)
  })

  it('carries the millimetre values of the table', () => {
    expect(entry.values).toEqual(row.values)
  })

  it('offers exactly the alternatives of the table', () => {
    expect(entry.alternatives).toEqual(row.alternatives)
  })

  it('says how sure the research was, per value where the values differ', () => {
    expect(entry.confidence).toBe(row.confidence)
    expect(entry.valueConfidence ?? undefined).toEqual(row.valueConfidence)
  })

  it('cites the source clauses of the table', () => {
    expect(entry.sources).toEqual(row.sources)
  })

  it('is fixed only where the issue says it is', () => {
    expect(entry.fixed).toBe(row.fixed)
  })

  it('says the plain-language line the table says', () => {
    expect(entry.hint).toBe(row.hint)
  })

  it('stores whole millimetres only', () => {
    const everyValue = [entry.values, ...entry.alternatives.map((alternative) => alternative.values)]
    for (const values of everyValue) {
      for (const [field, mm] of Object.entries(values)) {
        expect(Number.isInteger(mm), `${row.id}.${field}`).toBe(true)
      }
    }
  })
})

describe('the hint rule', () => {
  it('is on every soft row and on no firm one', () => {
    const soft = (confidence: PresetConfidence): boolean => confidence === 'low' || confidence === 'low_medium'
    for (const entry of pack.entries) {
      const confidences = [entry.confidence, ...Object.values(entry.valueConfidence ?? {})]
      expect(entry.hint === MEASURE_YOURS, entry.id).toBe(confidences.some(soft))
    }
  })
})

describe('the defaults (#63 criterion 2)', () => {
  it('places a 900 × 2100 bedroom door for a door', () => {
    const door = defaultPresetFor('door')
    expect(door.id).toBe('door.bedroom')
    expect(door.values).toEqual({ width: 900, height: 2100 })
    expect(door).toBe(entryOf('door.bedroom'))
  })

  it('places a 100 mm wall, a 2600 mm ceiling and a standard window', () => {
    expect(defaultPresetFor('wall').values).toEqual({ thickness: 100 })
    expect(defaultPresetFor('height').values).toEqual({ height: 2600 })
    expect(defaultPresetFor('window').id).toBe('window.standard')
  })
})

describe('the lookup (#63 criterion 4)', () => {
  it('lists the doors in declared order', () => {
    expect(listPresetEntries(PACK_ID, 'door').map((entry) => entry.id)).toEqual([
      'door.main',
      'door.bedroom',
      'door.bathroom',
      'door.kitchen-sliding',
    ])
  })

  it('lists every kind the pack has rows for, and nothing for one it has none of', () => {
    for (const kind of ['height', 'wall', 'door', 'window', 'shelter'] as const) {
      expect(listPresetEntries(PACK_ID, kind).every((entry) => entry.kind === kind)).toBe(true)
    }
    expect(listPresetEntries(PACK_ID, 'height')).toHaveLength(1)
    expect(listPresetEntries(PACK_ID, 'shelter')).toHaveLength(1)
  })

  it('refuses an unknown entry with a typed error naming both halves', () => {
    expect(() => getPresetEntry(PACK_ID, 'door.loft')).toThrow(UnknownPreset)
    try {
      getPresetEntry(PACK_ID, 'door.loft')
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownPreset)
      expect((error as UnknownPreset).packId).toBe(PACK_ID)
      expect((error as UnknownPreset).entryId).toBe('door.loft')
    }
  })

  it('refuses an unknown pack, and an unknown entry of an unknown pack', () => {
    expect(() => getPresetPack('hdb-resale')).toThrow(UnknownPreset)
    expect(() => getPresetEntry('hdb-resale', 'door.bedroom')).toThrow(UnknownPreset)
    try {
      getPresetPack('hdb-resale')
    } catch (error) {
      expect((error as UnknownPreset).entryId).toBeNull()
    }
  })
})

describe('the freeze (#63 criterion 4)', () => {
  it('holds the pack, every entry and every nested record', () => {
    expect(Object.isFrozen(pack)).toBe(true)
    expect(Object.isFrozen(pack.entries)).toBe(true)
    for (const entry of pack.entries) {
      expect(Object.isFrozen(entry), entry.id).toBe(true)
      expect(Object.isFrozen(entry.values), entry.id).toBe(true)
      expect(Object.isFrozen(entry.sources), entry.id).toBe(true)
      for (const alternative of entry.alternatives) {
        expect(Object.isFrozen(alternative), alternative.id).toBe(true)
        expect(Object.isFrozen(alternative.values), alternative.id).toBe(true)
      }
    }
  })

  it('throws when a test writes to an entry, because a test file is strict mode', () => {
    expect(() => {
      defaultPresetFor('door').values.width = 42
    }).toThrow(TypeError)
    expect(entryOf('door.bedroom').values).toEqual({ width: 900, height: 2100 })
  })
})

describe('an overridable copy (#63 criterion 6)', () => {
  it('refuses the household shelter, which comes with its own values', () => {
    expect(() => overridableCopyOf(entryOf('shelter.household'))).toThrow(FixedPreset)
    try {
      overridableCopyOf(entryOf('shelter.household'))
    } catch (error) {
      expect((error as FixedPreset).entryId).toBe('shelter.household')
    }
    expect(entryOf('shelter.household').fixed).toBe(true)
    for (const entry of pack.entries.filter((candidate) => !candidate.fixed)) {
      expect(() => overridableCopyOf(entry)).not.toThrow()
    }
  })

  it('hands out a deep copy that leaves the pack alone', () => {
    const door = defaultPresetFor('door')
    const copy = overridableCopyOf(door)
    expect(copy).not.toBe(door)
    expect(copy.values).not.toBe(door.values)
    expect(copy.sources).not.toBe(door.sources)

    copy.values.width = 760
    copy.name = 'My bedroom door'
    copy.sources.push({ key: 'H1', clause: 'measured' })

    expect(entryOf('door.bedroom').values).toEqual({ width: 900, height: 2100 })
    expect(entryOf('door.bedroom').name).toBe('Bedroom door')
    expect(entryOf('door.bedroom').sources).toHaveLength(2)
  })

  it('copies the alternatives of a row that has them', () => {
    const wall = defaultPresetFor('wall')
    const copy = overridableCopyOf(wall)
    expect(copy.alternatives).toHaveLength(2)
    expect(copy.alternatives[0]).not.toBe(wall.alternatives[0])
    copy.alternatives[0].values.thickness = 1
    expect(wall.alternatives[0].values.thickness).toBe(63)
  })
})

describe('the display name (#63 criterion 7)', () => {
  const door = entryOf('door.bedroom')

  it('says the millimetres it means at mm / 0 dp', () => {
    expect(presetDisplayName(door, 'mm', 0)).toBe('Bedroom door · 900 × 2100 mm')
  })

  it('follows the Project unit at cm / 1 dp', () => {
    expect(presetDisplayName(door, 'cm', 1)).toBe('Bedroom door · 90.0 × 210.0 cm')
  })

  it('follows the Project unit at m / 3 dp', () => {
    expect(presetDisplayName(door, 'm', 3)).toBe('Bedroom door · 0.900 × 2.100 m')
  })

  it('says each kind in the order a homeowner reads it', () => {
    expect(presetDisplayName(entryOf('height.ceiling'), 'mm', 0)).toBe('Ceiling height · 2600 mm')
    expect(presetDisplayName(entryOf('wall.internal'), 'mm', 0)).toBe('Inside wall · 100 mm')
    expect(presetDisplayName(entryOf('window.standard'), 'mm', 0)).toBe(
      'Standard window · 1200 × 1250 mm · sill 1050 mm',
    )
    expect(presetDisplayName(entryOf('shelter.household'), 'm', 3)).toBe(
      'Household shelter · 1.450 × 1.950 m · door 0.700 × 1.900 m',
    )
  })
})
