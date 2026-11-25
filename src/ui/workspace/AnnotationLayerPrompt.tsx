/**
 * The first-Annotation layer prompt (#81 §4.2).
 *
 * The first Annotation of a Project wants its default layer (`Notes`, or `Revisions` for a Revision
 * Cloud) and the Project has none by that name. The prompt is the one place that decides where the
 * Annotation lives, and its answer rides the same `annotation.create` as the placement itself — one
 * Intent, one undo step, so a single `Cmd+Z` removes the layer and the Annotation together (§4.3).
 *
 * `Create layer` is preselected: the prompt explains what BuildBox is about to do rather than
 * silently doing it, and an ordinary Drawing Layer is exactly what the issue promises — renameable
 * and deletable like any other. `Unlayered` is the third answer, and it is honest: the Annotation
 * then follows the overlay and nothing else.
 */
import type { ReactNode } from 'react'
import { useState } from 'react'
import type { EntityId } from '../../domain'
import { ANNOTATION_STRINGS } from '../strings/annotations'

export interface AnnotationLayerPromptProps {
  /** The default layer's name — `Notes`, or `Revisions` for a Revision Cloud. */
  layerName: string
  /** The layer to create when the first answer stands: the type's default colour (#4.1). */
  color: string
  /** The existing Drawing Layers, in list order, for the `Use existing` answers. */
  layers: readonly { id: EntityId; name: string }[]
  onCancel: () => void
  /** `null` is `Unlayered`; `create` is the preselected answer, name and colour in hand. */
  onConfirm: (answer: { layerId: EntityId | null } | { create: true; name: string; color: string }) => void
}

type Choice = { kind: 'create' } | { kind: 'use'; layerId: EntityId | null }

export function AnnotationLayerPrompt(props: AnnotationLayerPromptProps): ReactNode {
  const { layerName, color, layers, onCancel, onConfirm } = props
  const [choice, setChoice] = useState<Choice>({ kind: 'create' })

  const place = (): void => {
    if (choice.kind === 'create') onConfirm({ create: true, name: layerName, color })
    else onConfirm({ layerId: choice.layerId })
  }

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="annotation-layer-prompt">
      <div role="dialog" aria-modal="true" aria-label={ANNOTATION_STRINGS.promptTitle} className="bb-workspace-dialog">
        <h2>{ANNOTATION_STRINGS.promptTitle}</h2>
        <p className="bb-workspace-dialog-note">{ANNOTATION_STRINGS.promptBody(layerName)}</p>
        <div className="bb-workspace-dependency-list" role="radiogroup" aria-label={ANNOTATION_STRINGS.promptTitle}>
          <label data-testid="annotation-layer-create" className="bb-workspace-dependency-text">
            <input
              type="radio"
              name="annotation-layer"
              checked={choice.kind === 'create'}
              onChange={() => setChoice({ kind: 'create' })}
            />
            {ANNOTATION_STRINGS.promptCreate(layerName)}
          </label>
          {layers.map((layer) => (
            <label key={layer.id} data-testid={`annotation-layer-use-${layer.id}`} className="bb-workspace-dependency-text">
              <input
                type="radio"
                name="annotation-layer"
                checked={choice.kind === 'use' && choice.layerId === layer.id}
                onChange={() => setChoice({ kind: 'use', layerId: layer.id })}
              />
              {ANNOTATION_STRINGS.promptUseExisting(layer.name)}
            </label>
          ))}
          <label data-testid="annotation-layer-unlayered" className="bb-workspace-dependency-text">
            <input
              type="radio"
              name="annotation-layer"
              checked={choice.kind === 'use' && choice.layerId === null}
              onChange={() => setChoice({ kind: 'use', layerId: null })}
            />
            {ANNOTATION_STRINGS.promptUnlayered}
          </label>
        </div>
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="annotation-layer-place"
            className="bb-workspace-tool-button"
            onClick={place}
          >
            {ANNOTATION_STRINGS.promptPlace}
          </button>
          <button
            type="button"
            data-testid="annotation-layer-cancel"
            className="bb-workspace-secondary-button"
            onClick={onCancel}
          >
            {ANNOTATION_STRINGS.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}
