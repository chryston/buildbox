/**
 * The `Duplicate Floor…` preview (#56 criterion 10).
 *
 * The dialog decides everything the Intent needs before anything is written — the new
 * unique name, where the copy sits in the order, which Placed Items come along and whether
 * the Plan Image is copied — so the transaction is one step and the preview is honest.
 *
 * The checklist is grouped by **Item Design**, not by item: a Floor with four of the same
 * wardrobe is one row, because that is how the person thinks about it. Every group starts
 * checked; `Include Plan Image` starts **off**, because the picture is the one thing that
 * usually belongs to one Floor only, and copying it silently would drag a scale across.
 *
 * What comes out has new IDs for every copied entity and keeps the same `itemDesignId`
 * references — reuse, not forking: edit the shared Item Design and both Floors change, edit
 * a copied item's position and the source does not.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { EntityId, Project } from '../../domain'
import { floorNameTaken } from '../../domain'
import { STRINGS } from '../strings'

/** One Item Design's worth of Placed Items on the Floor being copied. */
export interface DuplicateGroup {
  readonly itemDesignId: EntityId
  readonly label: string
  readonly placedItemIds: readonly EntityId[]
}

/** The Placed Items of `floorId`, grouped by the Item Design they share. */
export function duplicateGroups(project: Project, floorId: EntityId): readonly DuplicateGroup[] {
  const labels = new Map(project.itemDesigns.map((design) => [design.id, design.name]))
  const groups = new Map<EntityId, EntityId[]>()
  for (const item of project.existingModel.placedItems) {
    if (item.floorId !== floorId) continue
    const bucket = groups.get(item.itemDesignId)
    if (bucket === undefined) groups.set(item.itemDesignId, [item.id])
    else bucket.push(item.id)
  }
  return [...groups.entries()].map(([itemDesignId, placedItemIds]) => ({
    itemDesignId,
    label: labels.get(itemDesignId) ?? STRINGS.duplicateItemFallback,
    placedItemIds,
  }))
}

export interface DuplicateFloorInput {
  name: string
  toIndex: number
  placedItemIds: EntityId[]
  includePlanImage: boolean
}

export interface DuplicateFloorDialogProps {
  project: Project
  sourceFloorId: EntityId
  onConfirm: (input: DuplicateFloorInput) => void
  onClose: () => void
}

export function DuplicateFloorDialog(props: DuplicateFloorDialogProps): ReactNode {
  const { project, sourceFloorId, onConfirm, onClose } = props
  const source = project.floors.find((floor) => floor.id === sourceFloorId)
  const groups = duplicateGroups(project, sourceFloorId)
  const sourceIndex = project.floors.findIndex((floor) => floor.id === sourceFloorId)
  const [name, setName] = useState(STRINGS.floorCopyName(source?.name ?? STRINGS.floor))
  const [toIndex, setToIndex] = useState(sourceIndex + 1)
  const [unchecked, setUnchecked] = useState<ReadonlySet<EntityId>>(new Set())
  const [includePlanImage, setIncludePlanImage] = useState(false)

  if (source === undefined) return null
  const trimmed = name.trim()
  const nameTaken = trimmed !== '' && floorNameTaken(project, trimmed, source.id)
  const nameError = trimmed === '' ? STRINGS.floorNameRequired : nameTaken ? STRINGS.floorNameTaken(trimmed) : null

  const chosen = groups
    .filter((group) => !unchecked.has(group.itemDesignId))
    .flatMap((group) => [...group.placedItemIds])

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="duplicate-floor-dialog">
      <div role="dialog" aria-modal="true" aria-label={STRINGS.duplicateFloorAria(source.name)} className="bb-workspace-dialog">
        <h2>{STRINGS.duplicateFloor}</h2>
        <label className="bb-workspace-field-label" htmlFor="duplicate-name">{STRINGS.name}</label>
        <input
          id="duplicate-name"
          className="bb-workspace-input"
          data-testid="duplicate-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {nameError !== null && (
          <p className="bb-workspace-field-error" data-testid="duplicate-name-error" role="alert">{nameError}</p>
        )}
        <label className="bb-workspace-field-label" htmlFor="duplicate-position">{STRINGS.position}</label>
        <select
          id="duplicate-position"
          className="bb-workspace-select"
          data-testid="duplicate-position"
          value={toIndex}
          onChange={(event) => setToIndex(Number(event.target.value))}
        >
          {positionLabels(project).map((label, index) => (
            <option key={label} value={index}>{label}</option>
          ))}
        </select>
        {groups.length > 0 && (
          <>
            <p className="bb-workspace-field-label">{STRINGS.placedItems}</p>
            <ul className="bb-workspace-checklist" data-testid="duplicate-checklist">
              {groups.map((group) => (
                <li key={group.itemDesignId}>
                  <label>
                    <input
                      type="checkbox"
                      data-testid={`duplicate-group-${group.itemDesignId}`}
                      checked={!unchecked.has(group.itemDesignId)}
                      onChange={(event) => setUnchecked((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.delete(group.itemDesignId)
                        else next.add(group.itemDesignId)
                        return next
                      })}
                    />
                    {group.label} ({group.placedItemIds.length})
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        {source.planImage !== null && (
          <label className="bb-workspace-check" data-testid="duplicate-plan-image-row">
            <input
              type="checkbox"
              data-testid="duplicate-include-plan-image"
              checked={includePlanImage}
              onChange={(event) => setIncludePlanImage(event.target.checked)}
            />
            {STRINGS.includePlanImage}
          </label>
        )}
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="duplicate-confirm"
            className="bb-workspace-primary-button"
            disabled={nameError !== null}
            onClick={() => onConfirm({ name: trimmed, toIndex, placedItemIds: chosen, includePlanImage })}
          >
            {STRINGS.duplicate}
          </button>
          <button
            type="button"
            data-testid="duplicate-cancel"
            className="bb-workspace-secondary-button"
            onClick={onClose}
          >
            {STRINGS.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** `At the top`, one `Between … and …` per join, then `At the end`. */
function positionLabels(project: Project): readonly string[] {
  const floors = project.floors
  const labels = [STRINGS.positionAtTop]
  for (let index = 1; index < floors.length; index += 1) {
    labels.push(STRINGS.positionBetween(floors[index - 1]?.name ?? '', floors[index]?.name ?? ''))
  }
  labels.push(STRINGS.positionAtEnd)
  return labels
}
