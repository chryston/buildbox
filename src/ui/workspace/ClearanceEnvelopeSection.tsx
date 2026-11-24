/**
 * The `Clearance Envelope` group (#76 §4): the one envelope an Item Design may own, added,
 * measured and removed — from the Item Design section of the inspector and from Item Detail.
 *
 * Two ways in, as the issue decides: `Zone off one edge` picks a straight Item Footprint edge
 * and a `Depth`, and the envelope is the rectangle that zone makes outward from that edge
 * (`zoneOffEdgeEnvelope` — no default depth is offered, and the placeholder says so in the
 * person's own words); `Custom Path…` opens the shape editor on the envelope path itself.
 * `Bottom` rides each placement's Base, `Height` rises from there, `Remove` takes the envelope
 * away. Every commit is one Edit Transaction on the Design, which is why the caption says
 * `shared by <N> placements` before any of them move.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { lengthOf, segmentStart } from '../../derive'
import type { ClosedPath } from '../../derive'
import {
  designFootprintSize,
  designHeight,
  footprintAsPath,
  rectangleFootprint,
  zoneOffEdgeEnvelope,
} from '../../domain'
import type { ItemDesign } from '../../domain'
import { STRINGS } from '../strings'
import { formatMm, parseToMm } from './displayUnits'
import { useFieldsLocked } from './fieldsLock'
import { placementCountFor } from './planModel'
import { useWorkspaceDispatch, useWorkspaceProject, useWorkspaceRoot } from './WorkspaceRoot'
import { ShapeEditor } from './shape/ShapeEditor'

export interface ClearanceEnvelopeSectionProps {
  itemDesignId: string
  design: ItemDesign
  /** `stacked` in the Floor inspector's narrow card, `editor` beside Item Detail's canvas. */
  layout?: 'stacked' | 'editor'
}

/** The Item Footprint as a chain: a cabinet's derived rectangle, a generic design's own shape. */
function footprintPath(design: ItemDesign): ClosedPath {
  if (design.kind === 'generic') return footprintAsPath(design.footprint).path
  const size = designFootprintSize(design)
  return footprintAsPath(rectangleFootprint(size?.width ?? 0, size?.depth ?? 0)).path
}

export function ClearanceEnvelopeSection(props: ClearanceEnvelopeSectionProps): ReactNode {
  const { itemDesignId, design, layout = 'editor' } = props
  const { session, services } = useWorkspaceRoot()
  const project = useWorkspaceProject(session)
  const dispatch = useWorkspaceDispatch()
  const { locked, notice } = useFieldsLocked()
  const unit = project.preferences.displayUnit
  const precision = project.preferences.displayPrecision
  const envelope = design.clearanceEnvelope ?? null
  const edges = footprintPath(design)

  // The `Zone off one edge` fields: the edge is 0-based into the footprint's chain, the Depth
  // starts empty — an empty field commits nothing, and no number is offered as a rule.
  const [edgeIndex, setEdgeIndex] = useState<number | null>(null)
  const [depthText, setDepthText] = useState('')
  const depthMm = depthText === '' ? null : parseToMm(Number(depthText), unit)
  const depthValid = depthMm !== null && Number.isFinite(depthMm) && depthMm > 0
  const [customOpen, setCustomOpen] = useState(false)

  const addFromEdge = (): void => {
    if (edgeIndex === null || depthMm === null) return
    const zone = zoneOffEdgeEnvelope(footprintPath(design), edgeIndex, depthMm)
    if (zone === null) return
    dispatch(services.intent.build('design.setClearanceEnvelope', {
      itemDesignId,
      envelope: { path: zone, bottomOffset: 0, height: designHeight(design) },
    }))
    setEdgeIndex(null)
    setDepthText('')
  }

  const commitEnvelope = (bottomOffset: number, height: number): void => {
    if (envelope === null) return
    dispatch(services.intent.build('design.setClearanceEnvelope', {
      itemDesignId,
      envelope: { path: envelope.path, bottomOffset, height },
    }))
  }

  const remove = (): void => {
    dispatch(services.intent.build('design.removeClearanceEnvelope', { itemDesignId }))
  }

  const count = placementCountFor(project, itemDesignId)
  const fieldProps = locked ? { disabled: true, title: notice } : {}

  return (
    <section className="bb-clearance-section" data-testid="clearance-envelope-section">
      <h4 className="bb-workspace-card-title">{STRINGS.clearanceEnvelope}</h4>
      {envelope === null ? (
        <>
          <label className="bb-workspace-field-label" htmlFor="clearance-edge">
            {STRINGS.zoneOffOneEdge}
          </label>
          <select
            id="clearance-edge"
            className="bb-workspace-input"
            data-testid="clearance-edge"
            value={edgeIndex === null ? '' : String(edgeIndex)}
            onChange={(event) => setEdgeIndex(event.target.value === '' ? null : Number(event.target.value))}
            {...fieldProps}
          >
            <option value="">—</option>
            {edges.segments.map((segment, index) => (
              segment.kind === 'line'
                ? (
                  <option key={index} value={String(index)}>
                    {STRINGS.edgeChoice(index + 1, `${formatMm(lengthOf(segment, segmentStart(edges, index)), unit, precision)} ${unit}`)}
                  </option>
                )
                : <option key={index} value={String(index)} disabled>{STRINGS.arcEdge(index + 1)}</option>
            ))}
          </select>
          <label className="bb-workspace-field-label" htmlFor="clearance-depth">
            {STRINGS.depth} <span className="bb-workspace-unit-suffix">({unit})</span>
          </label>
          <input
            id="clearance-depth"
            className="bb-workspace-input"
            data-testid="clearance-depth"
            type="number"
            step="any"
            placeholder={STRINGS.depthPlaceholder}
            value={depthText}
            onChange={(event) => setDepthText(event.target.value)}
            {...fieldProps}
          />
          <div className="bb-workspace-button-row">
            <button
              type="button"
              className="bb-workspace-tool-button"
              data-testid="clearance-add"
              disabled={locked || edgeIndex === null || !depthValid}
              onClick={addFromEdge}
            >
              {STRINGS.addClearanceEnvelope}
            </button>
            <button
              type="button"
              className="bb-workspace-tool-button"
              data-testid="clearance-custom"
              disabled={locked}
              aria-expanded={customOpen ? 'true' : 'false'}
              onClick={() => setCustomOpen((open) => !open)}
            >
              {STRINGS.customPathEditor}
            </button>
          </div>
          {customOpen && (
            <div data-testid="clearance-custom-editor">
              <ShapeEditor itemDesignId={itemDesignId} design={design} envelope layout={layout} />
              <button
                type="button"
                className="bb-workspace-secondary-button"
                data-testid="clearance-custom-close"
                onClick={() => setCustomOpen(false)}
              >
                {STRINGS.close}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <label className="bb-workspace-field-label" htmlFor="clearance-bottom">
            {STRINGS.clearanceBottom} <span className="bb-workspace-unit-suffix">({unit})</span>
          </label>
          <input
            id="clearance-bottom"
            className="bb-workspace-input"
            data-testid="clearance-bottom"
            type="number"
            step="any"
            defaultValue={formatMm(envelope.bottomOffset, unit, precision)}
            {...fieldProps}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              const mm = parseToMm(Number((event.target as HTMLInputElement).value), unit)
              if (mm !== null && Number.isFinite(mm)) commitEnvelope(mm, envelope.height)
            }}
          />
          <label className="bb-workspace-field-label" htmlFor="clearance-height">
            {STRINGS.extentHeight} <span className="bb-workspace-unit-suffix">({unit})</span>
          </label>
          <input
            id="clearance-height"
            className="bb-workspace-input"
            data-testid="clearance-height"
            type="number"
            step="any"
            defaultValue={formatMm(envelope.height, unit, precision)}
            {...fieldProps}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              const mm = parseToMm(Number((event.target as HTMLInputElement).value), unit)
              if (mm !== null && Number.isFinite(mm) && mm > 0) commitEnvelope(envelope.bottomOffset, mm)
            }}
          />
          <div className="bb-workspace-button-row">
            <button
              type="button"
              className="bb-workspace-danger-button"
              data-testid="clearance-remove"
              disabled={locked}
              onClick={remove}
            >
              {STRINGS.remove}
            </button>
          </div>
        </>
      )}
      <p className="bb-clearance-caption" data-testid="clearance-caption">
        {STRINGS.clearanceSharedBy(count)}
      </p>
    </section>
  )
}
