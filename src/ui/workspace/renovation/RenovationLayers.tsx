/**
 * The Layers list of one saved view (#71 §3), in the saved-view card's reserved slot.
 *
 * The list is drawn **front first** — the top row is the layer on top of the drawing — which is the
 * reverse of the order the Project stores, so the rows come from `layerRowsFrontFirst` and nothing
 * here reverses an array by hand. One row per layer plus the system row `Unlayered`, which is a row
 * like any other except that it has no Project section: there is no layer to rename, recolour,
 * reorder or delete behind it.
 *
 * Each row is two halves. The view half writes this saved view's own answer and nothing else —
 * criterion 6 is exactly that, and it is why every control here sends `view.setLayerSetting`,
 * `view.setLayerOrder` or `view.setActiveLayer` rather than a Project Intent. The `Project:` half
 * writes the layer itself, which every view that has not said otherwise then shows. A row shows the
 * **effective** answer, not the stored one: a view that hides Furniture draws the checkbox unticked
 * even though the Project says nothing about it, and the `◐` marker is what distinguishes "hidden
 * here" from "hidden everywhere".
 *
 * Nothing here decides what a layer means: the answers come from `derive`, every change is one Edit
 * Transaction the caller labels, and the only state this component keeps is which rows are open and
 * what has been typed into a field that has not been committed yet — UI-session state, never the
 * Project (#71 §3).
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { effectiveLayerSetting, layerRowsFrontFirst } from '../../../derive'
import type { PlanView, Project } from '../../../domain'
import {
  drawingLayerById,
  drawingLayersOf,
  viewActiveLayerId,
  viewLayerOrder,
  viewLayerSettingOverride,
  viewSnapToHidden,
} from '../../../domain'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import { LAYER_NEUTRAL_COLOR, layerSwatchClass } from './layersTheme'

/** The one field of a view's setting a control is changing; `null` hands that answer to the Project. */
export interface LayerSettingPatch {
  visible?: boolean | null
  selectable?: boolean | null
  editable?: boolean | null
  color?: string | null
}

export interface RenovationLayersProps {
  project: Project
  /** The saved view whose settings these are. No view, no list: there is nothing to aim. */
  view: PlanView | null
  /**
   * `+`: one Edit Transaction that makes `New layer` at the front. The new layer's id comes back so
   * the row can open with its name field focused — the caller is the one that built the Intent, and
   * only the Intent knows the id.
   */
  onAddLayer(): string | null
  onRenameLayer(layerId: string, name: string): void
  onSetProjectColor(layerId: string, color: string): void
  onMoveProject(layerId: string, direction: 'forward' | 'back'): void
  /** `Delete…`: opens the review. The dialog asks, and the dialog is the only thing that deletes. */
  onDeleteLayer(layerId: string): void
  onSetSetting(layerKey: string, setting: LayerSettingPatch): void
  /** The whole order, back to front — the same shape `view.setLayerOrder` takes — and which row moved. */
  onSetViewOrder(layerOrder: readonly string[], movedLayerId: string): void
  onSetActiveLayer(layerId: string | null): void
  /** `Use Project layer order`: `view.setLayerOrder` with `null`. */
  onUseProjectOrder(): void
  onSetSnapToHidden(snapToHidden: boolean): void
}

/** Which end of a front-first list a row sits at, which is where `forward` / `back` stop. */
const edgeOf = (index: number, length: number): { front: boolean; back: boolean } => ({
  front: index === 0,
  back: index === length - 1,
})

/**
 * The one word for what a row's control just did, for the undo label that has to say so (#71 §8).
 *
 * It lives beside the controls because it is the same distinction the controls draw: a patch names
 * exactly one field, and the word is that field's state — including handing the answer back to the
 * Project, which is a third thing a control can do and the one a history entry would otherwise lose.
 */
export const layerSettingWord = (setting: LayerSettingPatch): string => {
  const str = RENOVATION_STRINGS
  if (setting.visible !== undefined) return setting.visible === null ? str.layerStateDefault : setting.visible ? str.layerStateVisible : str.layerStateHidden
  if (setting.selectable !== undefined)
    return setting.selectable === null ? str.layerStateDefault : setting.selectable ? str.layerStateSelectable : str.layerStateNotSelectable
  if (setting.editable !== undefined)
    return setting.editable === null ? str.layerStateDefault : setting.editable ? str.layerStateEditable : str.layerStateNotEditable
  return setting.color === null ? str.layerStateDefault : str.layerStateColour
}

export function RenovationLayers(props: RenovationLayersProps): ReactNode {
  const { project, view } = props
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [focus, setFocus] = useState<string | null>(null)
  /** What has been typed but not committed, per layer: Enter and blur commit, Esc drops (#71 §3). */
  const [names, setNames] = useState<Record<string, string>>({})
  const [colors, setColors] = useState<Record<string, string>>({})
  const nameFields = useRef(new Map<string, HTMLInputElement>())

  // `+` adds a layer and opens its row with the name focused and selected, so the first thing a
  // person does is type over `New layer`. The row only exists once the Project has, so the effect
  // waits on the Project and tries again until the field is on screen.
  useEffect(() => {
    if (focus === null) return
    const field = nameFields.current.get(focus)
    if (field === undefined) return
    field.focus()
    field.select()
    setFocus(null)
  }, [focus, project])

  if (view === null) return null

  const rows = layerRowsFrontFirst(project, view)
  const layers = drawingLayersOf(project)
  const active = viewActiveLayerId(view)
  const order = viewLayerOrder(view)
  const str = RENOVATION_STRINGS

  const toggle = (key: string): void =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  /** One step of this view's own order, sent whole: a partial order could not say where the rest sits. */
  const moveInView = (key: string, direction: 'forward' | 'back'): void => {
    const back = [...rows].reverse()
    const at = back.indexOf(key)
    const to = direction === 'forward' ? at + 1 : at - 1
    if (at < 0 || to < 0 || to >= back.length) return
    const next = [...back]
    const [moved] = next.splice(at, 1)
    next.splice(to, 0, moved!)
    props.onSetViewOrder(next, key)
  }

  const commitName = (layerId: string, name: string): void => {
    const typed = (names[layerId] ?? name).trim()
    setNames((current) => ({ ...current, [layerId]: '' }))
    if (typed === '' || typed === name) return
    props.onRenameLayer(layerId, typed)
  }

  const commitColor = (layerId: string, current: string): void => {
    const typed = colors[layerId]
    setColors((state) => ({ ...state, [layerId]: '' }))
    if (typed === undefined || typed === '' || typed === current) return
    props.onSetProjectColor(layerId, typed)
  }

  return (
    <div className="bb-renovation-layers" data-testid="layers-section">
      <div className="bb-renovation-layers-header">
        <span className="bb-workspace-field-label" data-testid="layers-header">
          {str.layersHeader}
        </span>
        <button
          type="button"
          className="bb-layer-add"
          aria-label={str.layerNewName}
          data-testid="layer-add"
          onClick={() => {
            const id = props.onAddLayer()
            if (id === null) return
            setOpen((current) => new Set(current).add(id))
            setFocus(id)
          }}
        >
          +
        </button>
      </div>

      {layers.length === 0 && (
        <p className="bb-workspace-dialog-note" data-testid="layers-none">
          {str.layersNone}
        </p>
      )}

      <ul className="bb-layer-list" data-testid="layer-list">
        {rows.map((key, index) => {
          const layer = drawingLayerById(project, key)
          const unlayered = layer === null
          const name = layer?.name ?? str.layerUnlayered
          const setting = effectiveLayerSetting(project, view, key)
          const override = viewLayerSettingOverride(view, key)
          const expanded = open.has(key)
          const edges = edgeOf(index, rows.length)
          const colour = setting.color
          const viewColourDraft = colors[`view:${key}`]
          const projectColourDraft = layer === null ? undefined : colors[layer.id]

          return (
            <li className="bb-layer-item" key={key} data-testid={`layer-item-${key}`}>
              <div className="bb-layer-row">
                <input
                  type="checkbox"
                  checked={setting.visible}
                  aria-label={setting.visible ? str.layerHide(name) : str.layerShow(name)}
                  data-testid={`layer-visible-${key}`}
                  onChange={(event) => props.onSetSetting(key, { visible: event.target.checked })}
                />
                <span
                  className={layerSwatchClass(colour)}
                  style={colour === null ? undefined : { backgroundColor: colour }}
                  data-testid={`layer-swatch-${key}`}
                />
                <span className="bb-layer-name" data-testid={`layer-name-text-${key}`}>
                  {name}
                </span>
                {!setting.selectable && (
                  <span className="bb-layer-mark" title={str.layerMarkNotSelectable} data-testid={`layer-mark-unselectable-${key}`}>
                    ⊘
                  </span>
                )}
                {!setting.editable && (
                  <span className="bb-layer-mark" title={str.layerMarkReadOnly} data-testid={`layer-mark-readonly-${key}`}>
                    [RO]
                  </span>
                )}
                {override?.color !== undefined && (
                  <span className="bb-layer-mark" title={str.layerMarkOverride} data-testid={`layer-mark-override-${key}`}>
                    ◐
                  </span>
                )}
                <button
                  type="button"
                  className="bb-layer-disclosure"
                  aria-label={expanded ? str.layerCollapseAria(name) : str.layerExpandAria(name)}
                  aria-expanded={expanded}
                  data-testid={`layer-toggle-${key}`}
                  onClick={() => toggle(key)}
                >
                  {expanded ? '▾' : '▸'}
                </button>
              </div>

              {expanded && (
                <div className="bb-layer-view" data-testid={`layer-view-section-${key}`}>
                  <label className="bb-layer-field">
                    <input
                      type="checkbox"
                      checked={setting.selectable}
                      data-testid={`layer-selectable-${key}`}
                      onChange={(event) => props.onSetSetting(key, { selectable: event.target.checked })}
                    />
                    {str.layerSelectable}
                  </label>
                  <label className="bb-layer-field">
                    <input
                      type="checkbox"
                      checked={setting.editable}
                      data-testid={`layer-editable-${key}`}
                      onChange={(event) => props.onSetSetting(key, { editable: event.target.checked })}
                    />
                    {str.layerEditable}
                  </label>
                  <label className="bb-layer-field">
                    <input
                      type="radio"
                      name="bb-layer-active"
                      checked={unlayered ? active === null : active === layer.id}
                      aria-label={str.layerActiveAria(name)}
                      data-testid={`layer-active-${key}`}
                      onChange={() => props.onSetActiveLayer(unlayered ? null : layer.id)}
                    />
                    {str.layerActive}
                  </label>
                  <label className="bb-layer-field">
                    {str.layerColourInView}
                    <input
                      type="color"
                      value={viewColourDraft ?? colour ?? LAYER_NEUTRAL_COLOR}
                      aria-label={str.layerViewColourAria(name)}
                      data-testid={`layer-view-colour-${key}`}
                      onChange={(event) => setColors((state) => ({ ...state, [`view:${key}`]: event.target.value }))}
                      onBlur={() => {
                        const typed = colors[`view:${key}`]
                        setColors((state) => ({ ...state, [`view:${key}`]: '' }))
                        if (typed !== undefined && typed !== '' && typed !== colour) props.onSetSetting(key, { color: typed })
                      }}
                    />
                    {override?.color !== undefined && (
                      <button
                        type="button"
                        className="bb-layer-reset"
                        data-testid={`layer-colour-reset-${key}`}
                        onClick={() => props.onSetSetting(key, { color: null })}
                      >
                        {str.layerReset}
                      </button>
                    )}
                  </label>
                  <span className="bb-layer-order">
                    <span className="bb-layer-field-label" data-testid={`layer-view-order-label-${key}`}>
                      {str.layerViewOrder}
                    </span>
                    <button
                      type="button"
                      className="bb-layer-step"
                      aria-label={str.layerViewOrderUpAria(name)}
                      data-testid={`layer-view-forward-${key}`}
                      disabled={edges.front}
                      onClick={() => moveInView(key, 'forward')}
                    >
                      {str.layerForward}
                    </button>
                    <button
                      type="button"
                      className="bb-layer-step"
                      aria-label={str.layerViewOrderDownAria(name)}
                      data-testid={`layer-view-back-${key}`}
                      disabled={edges.back}
                      onClick={() => moveInView(key, 'back')}
                    >
                      {str.layerBack}
                    </button>
                  </span>
                </div>
              )}

              {/* Unlayered has no Project section: there is no layer behind the row to rename,
                  recolour, reorder or delete (#71 §3). */}
              {expanded && layer !== null && (
                <div className="bb-layer-project" data-testid={`layer-project-section-${key}`}>
                  <span className="bb-layer-field-label" data-testid={`layer-project-label-${key}`}>
                    {str.layerProjectSection}
                  </span>
                  <input
                    type="text"
                    className="bb-workspace-input"
                    value={names[layer.id] ?? layer.name}
                    aria-label={str.layerRenameAria(name)}
                    data-testid={`layer-name-${key}`}
                    ref={(field) => {
                      if (field === null) nameFields.current.delete(layer.id)
                      else nameFields.current.set(layer.id, field)
                    }}
                    onChange={(event) => setNames((state) => ({ ...state, [layer.id]: event.target.value }))}
                    onBlur={() => commitName(layer.id, layer.name)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitName(layer.id, layer.name)
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setNames((state) => ({ ...state, [layer.id]: '' }))
                      }
                    }}
                  />
                  <label className="bb-layer-field">
                    {str.layerProjectColour}
                    <input
                      type="color"
                      value={projectColourDraft ?? layer.color}
                      aria-label={str.layerProjectColourAria(name)}
                      data-testid={`layer-project-colour-${key}`}
                      onChange={(event) => setColors((state) => ({ ...state, [layer.id]: event.target.value }))}
                      onBlur={() => commitColor(layer.id, layer.color)}
                    />
                  </label>
                  <span className="bb-layer-steps">
                    <button
                      type="button"
                      className="bb-layer-step"
                      aria-label={str.layerMoveUpAria(name)}
                      data-testid={`layer-up-${key}`}
                      disabled={edges.front}
                      onClick={() => props.onMoveProject(layer.id, 'forward')}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="bb-layer-step"
                      aria-label={str.layerMoveDownAria(name)}
                      data-testid={`layer-down-${key}`}
                      disabled={edges.back}
                      onClick={() => props.onMoveProject(layer.id, 'back')}
                    >
                      ↓
                    </button>
                  </span>
                  <button
                    type="button"
                    className="bb-workspace-button-danger"
                    data-testid={`layer-delete-${key}`}
                    onClick={() => props.onDeleteLayer(layer.id)}
                  >
                    {str.layerDelete}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <label className="bb-layer-snap">
        <input
          type="checkbox"
          checked={viewSnapToHidden(view)}
          data-testid="layer-snap-to-hidden"
          onChange={(event) => props.onSetSnapToHidden(event.target.checked)}
        />
        {str.layerSnapToHidden}
      </label>

      {/* Only a view that has an order of its own can be offered the way out of it (#71 §3). */}
      {order !== null && (
        <button type="button" className="bb-layer-reset" data-testid="layer-use-project-order" onClick={props.onUseProjectOrder}>
          {str.layerUseProjectOrder}
        </button>
      )}
    </div>
  )
}
