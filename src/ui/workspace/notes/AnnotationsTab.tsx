/**
 * The `Annotations` tab of the Notes panel (#81 §6, §7).
 *
 * It lists the Annotations the view a person is looking through owns and can see, and edits the one
 * they selected. Like the Comments list it is separate from the model: no Floor property, no entity
 * property, no measurement appears in it. The context rule (§5.3) and the effective style (§1) are
 * `derive`'s; the plain words an Anchor is named with are `commentAnchorSubject`; the copy is the
 * string table. What lives here is the reading order and the bounded style controls — and the rule
 * that a control which does not apply to the selected type is absent, not disabled.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { notesSessionStore, useNotesSession } from './notesSession'
import type { NotesAnnotationLayerFilter, NotesAnnotationTypeFilter } from './notesSession'
import { commentAnchorSubject } from './anchorLabel'
import type {
  Annotation,
  AnnotationScope,
  AnnotationStyle,
  EntityId,
  Project,
  SavedViewSettings,
} from '../../../domain'
import {
  ANNOTATION_MARKER_SHAPES,
  ANNOTATION_PALETTE,
  ANNOTATION_SCOPE_ALL,
  ANNOTATION_SIZES,
  ANNOTATION_TYPES,
  ANNOTATION_WEIGHTS,
  annotationTypeHasTarget,
  compareAnnotationReferences,
  designOptionsOf,
  drawingLayerById,
  drawingLayersOf,
  endpointIsAnchored,
} from '../../../domain'
import { ANNOTATION_UNLAYERED_INK, annotationIsInContext } from '../../../derive'
import { ANNOTATION_STRINGS, ANNOTATION_TYPE_LABELS } from '../../strings/annotations'

/** The patch the editor sends: every field `annotation.edit` can change, whole-style replacement. */
export interface AnnotationEditPatch {
  text?: string
  layerId?: EntityId | null
  scope?: AnnotationScope
  targetViewId?: EntityId
  style?: AnnotationStyle | null
}

export interface AnnotationsTabProps {
  project: Project
  view: (SavedViewSettings & { floorId: EntityId; id: EntityId }) | null
  now: string
  onEdit(annotationId: EntityId, patch: AnnotationEditPatch): void
  onDelete(annotationId: EntityId): void
  /** Open the view that owns an Annotation — navigation, not a history step (#81 §6.4). */
  onGoToView(viewId: EntityId): void
}

/** The scope's word: `All Options`, or the Design Option's name (#81 §6.2). */
function scopeLabel(project: Project, scope: AnnotationScope): string {
  if (scope === ANNOTATION_SCOPE_ALL) return ANNOTATION_STRINGS.scopeAll
  return designOptionsOf(project).find((option) => option.id === scope)?.name ?? scope
}

/** The layer's word, or `Unlayered` (#81 §6.2). */
function layerLabel(project: Project, layerId: EntityId | null): string {
  if (layerId === null) return ANNOTATION_STRINGS.unlayered
  return drawingLayerById(project, layerId)?.name ?? ANNOTATION_STRINGS.unlayered
}

/** The colour a row's swatch shows: the record's own, else its layer's, else the view's ink. */
function swatchColour(project: Project, annotation: Annotation): string {
  if (annotation.style?.colour !== undefined) return annotation.style.colour
  if (annotation.layerId !== null) return drawingLayerById(project, annotation.layerId)?.color ?? ANNOTATION_UNLAYERED_INK
  return ANNOTATION_UNLAYERED_INK
}

/** The name of the view an Annotation belongs to, across Plan, Elevation and Item Detail (#81 §7). */
function ownerViewName(project: Project, viewId: EntityId): string {
  const plan = project.views.find((each) => each.id === viewId)
  if (plan !== undefined) return plan.name
  const elevation = (project.elevationViews ?? []).find((each) => each.id === viewId)
  if (elevation !== undefined) return elevation.name
  const design = project.itemDesigns.find((each) => each.id === viewId)
  return design?.name ?? viewId
}

/** The filters, composed with AND, after the §5.3 context rule has had its say (#81 §6.3, §6.4). */
function listedAnnotations(
  project: Project,
  view: (SavedViewSettings & { floorId: EntityId; id: EntityId }) | null,
  session: { currentContext: boolean; type: NotesAnnotationTypeFilter; layer: NotesAnnotationLayerFilter; query: string },
): Annotation[] {
  const needle = session.query.toLowerCase()
  return (project.annotations ?? [])
    .filter((annotation) => {
      if (session.type !== 'any' && annotation.type !== session.type) return false
      if (session.layer === 'unlayered' && annotation.layerId !== null) return false
      if (session.layer !== 'any' && session.layer !== 'unlayered' && annotation.layerId !== session.layer) return false
      if (needle !== '' && !annotation.reference.toLowerCase().includes(needle) && !annotation.text.toLowerCase().includes(needle)) return false
      // With `Current context` on, only the view's own visible Annotations; with it off, every one
      // in the Project — a row owned by another view navigates there when selected (§6.4).
      if (session.currentContext) {
        if (view === null) return true
        if (annotation.viewId !== view.id) return false
        if (!annotationIsInContext(project, view, annotation)) return false
      }
      return true
    })
    .sort((left, right) => compareAnnotationReferences(left.reference, right.reference))
}

/** One row (#81 §6.2): swatch, `A-nnn · <type>` bold, then the text, layer, scope and anchor. */
function AnnotationRow({
  project,
  annotation,
  selected,
  onSelect,
}: {
  project: Project
  annotation: Annotation
  selected: boolean
  onSelect(): void
}): ReactNode {
  const anchored = annotation.endpoint !== undefined && endpointIsAnchored(annotation.endpoint)
  const anchorText = anchored ? ANNOTATION_STRINGS.anchoredSuffix(commentAnchorSubject(project, annotation.endpoint as never)) : ''
  const layerText = annotation.layerId === null ? ANNOTATION_STRINGS.unlayeredSuffix : ANNOTATION_STRINGS.layerSuffix(layerLabel(project, annotation.layerId))
  return (
    <li className="bb-note-row" data-testid={`annotation-row-${annotation.reference}`} data-selected={selected ? 'true' : 'false'}>
      <button type="button" className="bb-note-row-main" data-testid={`annotation-select-${annotation.reference}`} onClick={onSelect} aria-current={selected ? 'true' : undefined}>
        <span className="bb-note-dot" style={{ background: swatchColour(project, annotation) }} data-testid={`annotation-swatch-${annotation.reference}`} />
        <span className="bb-note-row-text">
          <span className="bb-note-row-title">
            {annotation.reference} · {ANNOTATION_TYPE_LABELS[annotation.type]}
          </span>
          <span className="bb-note-row-anchor">
            {`“${annotation.text}”`}{layerText} · {scopeLabel(project, annotation.scope)}{anchorText}
          </span>
        </span>
      </button>
    </li>
  )
}

/** A small chip that toggles one boolean of the style (#81 §7). */
function StyleChip({ testId, label, on, onToggle }: { testId: string; label: string; on: boolean; onToggle(): void }): ReactNode {
  return (
    <button
      type="button"
      className="bb-button"
      data-testid={testId}
      data-on={on ? 'true' : 'false'}
      aria-pressed={on}
      onClick={onToggle}
    >
      {label}
    </button>
  )
}

/**
 * The inline editor for one Annotation (#81 §7). Text commits on Enter or blur as one transaction;
 * every style control sends the whole style with the one field changed (the domain replaces the
 * style, never merges a field), and `Reset to layer style` clears every override at once. A control
 * that does not apply to the selected type is not rendered.
 */
function AnnotationEditor({
  project,
  view,
  annotation,
  onEdit,
  onDelete,
  onGoToView,
  focusText,
}: {
  project: Project
  view: (SavedViewSettings & { floorId: EntityId; id: EntityId }) | null
  annotation: Annotation
  onEdit(annotationId: EntityId, patch: AnnotationEditPatch): void
  onDelete(annotationId: EntityId): void
  onGoToView(viewId: EntityId): void
  focusText: boolean
}): ReactNode {
  const [text, setText] = useState(annotation.text)
  const textRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setText(annotation.text), [annotation.id, annotation.text])
  useEffect(() => {
    if (!focusText) return
    textRef.current?.focus()
    textRef.current?.select()
  }, [focusText])

  const commitText = (): void => {
    const next = text.trim()
    if (next === '' || next === annotation.text) {
      setText(annotation.text)
      return
    }
    onEdit(annotation.id, { text: next })
  }

  // The style the controls read: the record's overrides over the bounded defaults. A control writes
  // the whole style with its one field changed, so the other overrides survive.
  const style = annotation.style ?? {}
  const size = style.size ?? 'M'
  const colour = style.colour
  const weight = style.weight ?? 1
  const dashed = style.dashed ?? false
  const arrowhead = style.arrowhead ?? true
  const cloudTint = style.cloudTint ?? false
  const markerShape = style.markerShape ?? 'circle'
  const writeStyle = (patch: Partial<AnnotationStyle>): void => {
    onEdit(annotation.id, { style: { ...style, ...patch } })
  }

  const options = designOptionsOf(project)
  const scopeValue = annotation.scope
  const otherViews = project.views.filter((each) => each.id !== annotation.viewId)
  const hasTarget = annotationTypeHasTarget(annotation.type)
  const hasArrowhead = annotation.type === 'leader' || annotation.type === 'arrow'
  const hasFill = annotation.type === 'revision_cloud'
  const hasShape = annotation.type === 'reference_marker'

  return (
    <div className="bb-note-editor" data-testid="annotation-editor">
      <div className="bb-note-editor-eyebrow" data-testid="annotation-editor-eyebrow">
        {ANNOTATION_STRINGS.editorEyebrow(annotation.reference, annotation.type)}
      </div>
      <textarea
        ref={textRef}
        className="bb-note-editor-body"
        data-testid="annotation-editor-text"
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commitText}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return
          event.preventDefault()
          commitText()
        }}
      />
      <dl className="bb-note-editor-fields">
        <div className="bb-note-editor-field">
          <dt>{ANNOTATION_STRINGS.fieldView}</dt>
          <dd data-testid="annotation-editor-view">{ownerViewName(project, annotation.viewId)}</dd>
        </div>
        <div className="bb-note-editor-field">
          <dt>{ANNOTATION_STRINGS.fieldLayer}</dt>
          <dd>
            <select
              className="bb-notes-filter"
              data-testid="annotation-editor-layer"
              value={annotation.layerId ?? ''}
              onChange={(event) => onEdit(annotation.id, { layerId: event.target.value === '' ? null : event.target.value })}
            >
              <option value="">{ANNOTATION_STRINGS.unlayered}</option>
              {drawingLayersOf(project).map((layer) => (
                <option key={layer.id} value={layer.id}>{layer.name}</option>
              ))}
            </select>
          </dd>
        </div>
        <div className="bb-note-editor-field">
          <dt>{ANNOTATION_STRINGS.fieldScope}</dt>
          <dd>
            <select
              className="bb-notes-filter"
              data-testid="annotation-editor-scope"
              value={scopeValue}
              onChange={(event) => onEdit(annotation.id, { scope: event.target.value })}
            >
              <option value={ANNOTATION_SCOPE_ALL}>{ANNOTATION_STRINGS.scopeAll}</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.id === view?.designOptionId ? ANNOTATION_STRINGS.scopeActive(option.name) : option.name}
                </option>
              ))}
            </select>
          </dd>
        </div>
        {hasTarget && (
          <div className="bb-note-editor-field">
            <dt>{ANNOTATION_STRINGS.fieldTarget}</dt>
            <dd>
              <select
                className="bb-notes-filter"
                data-testid="annotation-editor-target"
                value={annotation.targetViewId ?? ''}
                onChange={(event) => {
                  const next = event.target.value
                  if (next !== '') onEdit(annotation.id, { targetViewId: next })
                }}
              >
                {otherViews.map((each) => (
                  <option key={each.id} value={each.id}>{each.name}</option>
                ))}
              </select>
              {annotation.targetViewId !== undefined && (
                <button type="button" className="bb-button" data-testid="annotation-editor-go" onClick={() => onGoToView(annotation.targetViewId as EntityId)}>
                  {ANNOTATION_STRINGS.goToView}
                </button>
              )}
            </dd>
          </div>
        )}
        <div className="bb-note-editor-field">
          <dt>{ANNOTATION_STRINGS.fieldSize}</dt>
          <dd>
            <select
              className="bb-notes-filter"
              data-testid="annotation-editor-size"
              value={size}
              onChange={(event) => writeStyle({ size: event.target.value as AnnotationStyle['size'] })}
            >
              {ANNOTATION_SIZES.map((each) => (
                <option key={each} value={each}>{each}</option>
              ))}
            </select>
          </dd>
        </div>
        <div className="bb-note-editor-field">
          <dt>{ANNOTATION_STRINGS.fieldColor}</dt>
          <dd data-testid="annotation-editor-color" role="group">
            {ANNOTATION_PALETTE.map((each) => (
              <button
                key={each}
                type="button"
                className="bb-annotation-swatch"
                data-testid={`annotation-color-${each.replace('#', '')}`}
                data-on={colour === each ? 'true' : 'false'}
                aria-pressed={colour === each}
                style={{ background: each }}
                aria-label={each}
                onClick={() => writeStyle({ colour: each })}
              />
            ))}
          </dd>
        </div>
        <div className="bb-note-editor-field">
          <dt>{ANNOTATION_STRINGS.fieldLine}</dt>
          <dd>
            <select
              className="bb-notes-filter"
              data-testid="annotation-editor-weight"
              value={String(weight)}
              onChange={(event) => writeStyle({ weight: Number(event.target.value) })}
            >
              {ANNOTATION_WEIGHTS.map((each) => (
                <option key={each} value={String(each)}>{String(each)}</option>
              ))}
            </select>
            <StyleChip
              testId="annotation-editor-dashed"
              label={ANNOTATION_STRINGS.dashedChip}
              on={dashed}
              onToggle={() => writeStyle({ dashed: !dashed })}
            />
          </dd>
        </div>
        {hasArrowhead && (
          <div className="bb-note-editor-field">
            <dt>{ANNOTATION_STRINGS.fieldArrowhead}</dt>
            <dd>
              <StyleChip testId="annotation-editor-arrowhead" label={ANNOTATION_STRINGS.onChip} on={arrowhead} onToggle={() => writeStyle({ arrowhead: !arrowhead })} />
            </dd>
          </div>
        )}
        {hasFill && (
          <div className="bb-note-editor-field">
            <dt>{ANNOTATION_STRINGS.fieldFill}</dt>
            <dd>
              <StyleChip testId="annotation-editor-fill" label={ANNOTATION_STRINGS.tintChip} on={cloudTint} onToggle={() => writeStyle({ cloudTint: !cloudTint })} />
            </dd>
          </div>
        )}
        {hasShape && (
          <div className="bb-note-editor-field">
            <dt>{ANNOTATION_STRINGS.fieldShape}</dt>
            <dd>
              <select
                className="bb-notes-filter"
                data-testid="annotation-editor-shape"
                value={markerShape}
                onChange={(event) => writeStyle({ markerShape: event.target.value as AnnotationStyle['markerShape'] })}
              >
                {ANNOTATION_MARKER_SHAPES.map((each) => (
                  <option key={each} value={each}>{each === 'circle' ? ANNOTATION_STRINGS.shapeCircle : ANNOTATION_STRINGS.shapeHexagon}</option>
                ))}
              </select>
            </dd>
          </div>
        )}
      </dl>
      <p className="bb-notes-helper" data-testid="annotation-editor-helper">{ANNOTATION_STRINGS.styleHelper}</p>
      <div className="bb-note-editor-actions">
        <button type="button" className="bb-button" data-testid="annotation-editor-reset" onClick={() => onEdit(annotation.id, { style: null })}>
          {ANNOTATION_STRINGS.resetStyle}
        </button>
        <button type="button" className="bb-button bb-workspace-danger-button" data-testid="annotation-editor-delete" onClick={() => onDelete(annotation.id)}>
          {ANNOTATION_STRINGS.delete}
        </button>
      </div>
    </div>
  )
}

export function AnnotationsTab({ project, view, onEdit, onDelete, onGoToView }: AnnotationsTabProps): ReactNode {
  const query = useNotesSession((state) => state.query)
  const currentContext = useNotesSession((state) => state.currentContext)
  const annotationType = useNotesSession((state) => state.annotationType)
  const annotationLayer = useNotesSession((state) => state.annotationLayer)
  const selectedAnnotationId = useNotesSession((state) => state.selectedAnnotationId)
  const annotationTextToFocus = useNotesSession((state) => state.annotationTextToFocus)
  const session = notesSessionStore.getState

  const listed = useMemo(
    () => listedAnnotations(project, view, { currentContext, type: annotationType, layer: annotationLayer, query }),
    [project, view, currentContext, annotationType, annotationLayer, query],
  )
  const selected = listed.find((each) => each.id === selectedAnnotationId) ?? (project.annotations ?? []).find((each) => each.id === selectedAnnotationId) ?? null

  const select = (annotation: Annotation): void => {
    // A row owned by another view navigates there and focuses the Annotation (#81 §6.4); a row of
    // this view just selects it.
    if (view !== null && annotation.viewId !== view.id) onGoToView(annotation.viewId)
    session().selectAnnotation(annotation.id)
  }

  return (
    <>
      <div className="bb-notes-filters" data-testid="annotation-filters">
        <select
          className="bb-notes-filter"
          data-testid="annotation-type-filter"
          value={annotationType}
          onChange={(event) => session().setAnnotationType(event.target.value as NotesAnnotationTypeFilter)}
        >
          <option value="any">{ANNOTATION_STRINGS.anyAnnotation}</option>
          {ANNOTATION_TYPES.map((each) => (
            <option key={each} value={each}>{ANNOTATION_TYPE_LABELS[each]}</option>
          ))}
        </select>
        <select
          className="bb-notes-filter"
          data-testid="annotation-layer-filter"
          value={annotationLayer}
          onChange={(event) => session().setAnnotationLayer(event.target.value as NotesAnnotationLayerFilter)}
        >
          <option value="any">{ANNOTATION_STRINGS.anyLayer}</option>
          {drawingLayersOf(project).map((layer) => (
            <option key={layer.id} value={layer.id}>{layer.name}</option>
          ))}
          <option value="unlayered">{ANNOTATION_STRINGS.unlayered}</option>
        </select>
      </div>
      <ul className="bb-note-rows" data-testid="annotation-rows">
        {listed.map((annotation) => (
          <AnnotationRow
            key={annotation.id}
            project={project}
            annotation={annotation}
            selected={annotation.id === selectedAnnotationId}
            onSelect={() => select(annotation)}
          />
        ))}
      </ul>
      {selected === null ? (
        <p className="bb-notes-empty" data-testid="annotation-editor-empty">{ANNOTATION_STRINGS.styleHelper}</p>
      ) : (
        <AnnotationEditor
          project={project}
          view={view}
          annotation={selected}
          onEdit={onEdit}
          onDelete={onDelete}
          onGoToView={onGoToView}
          focusText={annotationTextToFocus === selected.id}
        />
      )}
    </>
  )
}
