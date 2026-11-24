/**
 * What a shared height would do before it does anything (#76 §1).
 *
 * The panel that edits an Item Design's height has to say, per Placed Item, what the new number
 * opens and what it clears — across every Floor and the Existing Model and every Design Option.
 * That is exactly one question, and it is answered here, in the open: the Intent is run through
 * the injected `evaluate` (the session's door into `edit`, which commits nothing), the warnings
 * are derived twice per (Floor, Option) — once on the Project as it stands, once on the answer —
 * and the two key sets are subtracted. A key that appears is `+ new`; one that disappears is
 * `− cleared`. A warning whose measurement changed but which stays open is neither, and its row
 * says nothing, because nothing about its existence changed.
 */
import type { Intent } from '../../edit'
import { designHeight } from '../../domain'
import type { Project } from '../../domain'
import {
  designOptionName,
  deriveWarnings,
  effectiveFloor,
  effectiveModel,
  placementLabels,
} from '../../derive'
import { designOptionsOf } from '../../domain'

/** One row of the panel's table: one Placed Item, under one (Floor, Design Option). */
export interface SharedDesignRow {
  readonly placementId: string
  /** The strip's own label for this placement (`Wardrobe #2` when the Floor holds two). */
  readonly label: string
  readonly floorId: string
  readonly floorName: string
  /** `null` is the Existing Model; the column then reads `Existing Model`. */
  readonly optionId: string | null
  readonly optionName: string
  readonly baseMm: number
  readonly currentTopMm: number
  readonly newTopMm: number
  /** The new height opens at least one warning involving this placement. */
  readonly added: boolean
  /** The new height clears at least one warning involving this placement. */
  readonly cleared: boolean
}

/** The warning keys that name one placement among their subjects. */
const keysNaming = (
  warnings: readonly { key: string; subjects: readonly { id: string }[] }[],
  placementId: string,
): Set<string> => {
  const keys = new Set<string>()
  for (const warning of warnings) {
    if (warning.subjects.some((subject) => subject.id === placementId)) keys.add(warning.key)
  }
  return keys
}

/**
 * The table for `heightMm`, or `null` when the edit layer would refuse the height (the panel then
 * marks the field and disables `Apply` — the same refusal, said twice on purpose: once before the
 * keystroke commits, once by the layer that owns the record).
 *
 * Rows follow the model's own order: Floor by Floor, the Existing Model first, then each Design
 * Option in the order the Project lists them.
 */
export function sharedDesignRows(
  project: Project,
  revision: number,
  itemDesignId: string,
  heightMm: number,
  intent: Intent,
  evaluate: (project: Project, intent: Intent) => Project | null,
): readonly SharedDesignRow[] | null {
  const design = project.itemDesigns.find((candidate) => candidate.id === itemDesignId)
  if (design === undefined) return null
  const currentHeight = designHeight(design)
  // The current height needs no answer from the edit layer — the table shows it as it stands,
  // and every `Warning change` cell is empty because nothing would change.
  const preview = heightMm === currentHeight ? project : evaluate(project, intent)
  if (preview === null) return null
  const options: readonly (string | null)[] = [null, ...designOptionsOf(project).map((option) => option.id)]
  const rows: SharedDesignRow[] = []
  for (const floor of project.floors) {
    for (const optionId of options) {
      const standing = effectiveModel(project, floor.id, optionId).standingPlacedItems
        .filter((placed) => placed.itemDesignId === itemDesignId)
      if (standing.length === 0) continue
      const labels = placementLabels(effectiveFloor(project, revision, floor.id, optionId).placements)
      const now = deriveWarnings(project, floor.id, optionId).warnings
      const after = deriveWarnings(preview, floor.id, optionId).warnings
      for (const placed of standing) {
        const before = keysNaming(now, placed.id)
        const afterKeys = keysNaming(after, placed.id)
        let added = false
        let cleared = false
        for (const key of afterKeys) if (!before.has(key)) added = true
        for (const key of before) if (!afterKeys.has(key)) cleared = true
        rows.push({
          placementId: placed.id,
          label: labels.get(placed.id) ?? design.name,
          floorId: floor.id,
          floorName: floor.name,
          optionId,
          optionName: designOptionName(project, optionId),
          baseMm: placed.baseElevation,
          currentTopMm: placed.baseElevation + currentHeight,
          newTopMm: placed.baseElevation + heightMm,
          added,
          cleared,
        })
      }
    }
  }
  return rows
}
