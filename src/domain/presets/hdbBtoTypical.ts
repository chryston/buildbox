/**
 * The one built-in preset pack: **"HDB BTO (typical)"** (#63).
 *
 * Every row is a value the #33 research found in an HDB, BCA or SCDF document, with the
 * clause it came from and how sure the research was of it. Nothing here is a rule: the
 * numbers are where a typical Singapore flat starts, and the flat the homeowner is
 * measuring may differ. That is why each row says what it is (`hint`) and why no row says
 * anything about codes, ratings or obligations (#19 §12) — the research's "constraints
 * worth surfacing" (fire-rated doors, certified locks, what must not be hacked) are
 * deliberately not copied in, because BuildBox has no authority to state them.
 *
 * The pack is data only. It holds no behaviour — no swing, no drawing rule, no lock — and
 * a placed element never points back at a row: the tool resolves an ID to millimetres when
 * the Intent is built, so changing this file changes what a *new* element starts with and
 * nothing that is already placed.
 *
 * Source keys are the research doc's (#33 §8); the clause is what that document numbers.
 */
import { deepFrozen } from './frozen'
import type { PresetPack } from './types'

/** The line every low-confidence row carries: the value is typical, not measured. */
const MEASURE_YOURS = 'Typical size — measure yours.'

/** The pack's own line, said above the list wherever it is picked from (#33 §7.1). */
const PACK_HINT = 'Starting point — check your HDB floor plan.'

/** The shipped pack: `id: 'hdb-bto-typical'`, version 1, thirteen entries. */
export const HDB_BTO_TYPICAL: PresetPack = deepFrozen({
  id: 'hdb-bto-typical',
  name: 'HDB BTO (typical)',
  version: 1,
  hint: PACK_HINT,
  entries: [
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
    },
    {
      id: 'shelter.household',
      kind: 'shelter',
      name: 'Household shelter',
      values: {
        internalWidth: 1450,
        internalDepth: 1950,
        wallThickness: 250,
        doorWidth: 700,
        doorHeight: 1900,
      },
      alternatives: [],
      confidence: 'high',
      sources: [
        { key: 'B3', clause: 'Table 2A' },
        { key: 'S3', clause: '2.3.1' },
        { key: 'S3', clause: '2.5.1(a)' },
        { key: 'H1', clause: 'Figure 2A' },
      ],
      // Read-only in the pack: its numbers cannot be overridden before placing. The Room,
      // Walls and door it creates are ordinary elements, which stay editable (#64, #67).
      fixed: true,
    },
  ],
})
