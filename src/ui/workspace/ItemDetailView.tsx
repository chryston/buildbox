/**
 * The Item Detail View (#57 §6): one Item Design read on its own, with no Floor around it.
 *
 * This is the only way into the cabinet editor. The `Cabinet ⇄ Floor Plan` switcher is gone, so
 * the editor appears in this view's main slot — passed in as `children`, because the cabinet
 * chrome belongs to the composition above this module and not to the Plan View's. A generic
 * Item Design gets its properties in the same slot; #58 puts the shape editor there.
 *
 * Navigation only: nothing here dispatches an Intent (#26). `← Back` and the `Placements` list
 * both move the Floor and Plan View pointers and reselect one Placed Item.
 */
import type { ReactNode } from 'react'
import { useWorkspaceProject, useWorkspaceRoot } from './WorkspaceRoot'
import { formatMm } from './displayUnits'
import { itemLibrary, planViewsForFloor, placementGroups } from './planModel'
import { useWorkspace, workspaceStore } from './workspaceStore'

export interface ItemDetailViewProps {
  /** The Item Design on screen — the one `Open Item Detail` was pressed for. */
  readonly itemDesignId: string
  /** The cabinet editor, when this Item Design is a cabinet. */
  readonly children?: ReactNode
}

/**
 * Leave Item Detail for a Placed Item. The order is the whole gesture: a selection belongs to
 * the Floor and Plan View it was made on, so moving after selecting would drop what was chosen.
 */
function gotoPlacement(floorId: string, viewId: string | null, placedItemId: string): void {
  const store = workspaceStore.getState()
  store.closeItemDetail()
  store.setActiveFloor(floorId, viewId)
  store.select(placedItemId)
}

export function ItemDetailView({ itemDesignId, children }: ItemDetailViewProps) {
  const { session } = useWorkspaceRoot()
  const project = useWorkspaceProject(session)
  const detail = useWorkspace((state) => state.itemDetail)
  const entry = itemLibrary(project).find((each) => each.itemDesignId === itemDesignId) ?? null
  const groups = placementGroups(project, itemDesignId)
  const from = detail?.from ?? null
  const fromFloor = from === null
    ? null
    : project.floors.find((each) => each.id === from.floorId) ?? null
  const unit = project.preferences.displayUnit
  const precision = project.preferences.displayPrecision
  const size = (mm: number): string => formatMm(mm, unit, precision)

  return (
    <div className="bb-item-detail" data-testid="item-detail-view">
      <header className="bb-item-detail-header">
        <button
          type="button"
          className="bb-item-detail-back"
          data-testid="item-detail-back"
          disabled={from === null || fromFloor === null}
          onClick={() => {
            if (from === null) return
            gotoPlacement(from.floorId, from.viewId, from.placedItemId)
          }}
        >
          {`← Back to ${entry?.label ?? ''} on ${fromFloor?.name ?? ''}`}
        </button>
        <span className="bb-item-detail-title" data-testid="item-detail-title">
          {entry?.label ?? ''}
        </span>
      </header>
      <div className="bb-item-detail-body">
        <nav
          className="bb-item-detail-placements"
          aria-label="Placements"
          data-testid="item-detail-placements"
        >
          <h2>Placements</h2>
          {groups.length === 0 && <p className="bb-item-detail-empty">Not placed in this Project.</p>}
          {groups.map((group) => {
            const viewId = planViewsForFloor(project, group.floorId)[0]?.id ?? null
            return (
              <section key={group.floorId} data-testid={`placement-group-${group.floorId}`}>
                <h3>{group.floorName}</h3>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="bb-item-detail-row"
                        data-testid={`placement-row-${item.id}`}
                        onClick={() => gotoPlacement(group.floorId, viewId, item.id)}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </nav>
        <div className="bb-item-detail-main">
          {children ?? (entry === null ? null : (
            <section className="bb-item-detail-props" data-testid="item-detail-props">
              <h2>Item Design</h2>
              <dl>
                <dt>Name</dt>
                <dd data-testid="detail-name">{entry.label}</dd>
                <dt>Width</dt>
                <dd data-testid="detail-width">{size(entry.width)}</dd>
                <dt>Depth</dt>
                <dd data-testid="detail-depth">{size(entry.depth)}</dd>
                <dt>Colour</dt>
                <dd data-testid="detail-color">{entry.color}</dd>
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
