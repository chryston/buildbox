/**
 * The Service inspector (#79 §5, behaviours 1–7).
 *
 * A Run shows `Kind`, `Section`, the size, then `Bottom`, `Centre` and `Top`, then `Label`. A Riser
 * shows `Kind`, `Diameter`, `Bottom`, `Top`, `Label` — no `Section`, because a Riser is round and a
 * field with only one answer is not a field.
 *
 * The two rules the issue is strictest about live here:
 *
 * - **Position fields always move the Service.** `Bottom`, `Centre` and `Top` keep the section and
 *   change `centrelineElevation` so the edited value holds. Only a size field changes the Vertical
 *   Extent.
 * - **Size edits keep the stored centreline.** Changing `Diameter` or `Depth` moves Bottom and Top
 *   symmetrically, and the derived pair below the box updates in the same render — the handler has
 *   already written the entity, and this component reads it back.
 *
 * `Bottom` and `Top` of a Run are printed, never typed alongside `Centre`: all three write the same
 * one stored number, so the box that moves is the one the person aims at and the other two are its
 * consequences. A Riser owns its height, so both of its ends are typed: `Bottom` moves it and keeps
 * `Height`, `Top` keeps `Bottom` and changes the height — the rule Walls, Openings, Beams and
 * Skirting already follow.
 *
 * There is no shared-design line and no placement line: a Service is neither.
 */
import type { ReactNode } from 'react'
import type { DerivedService } from '../../../derive'
import type { DisplayUnit, Service, ServiceKind, ServiceSection } from '../../../domain'
import { serviceBottom, serviceTop } from '../../../domain'
import { STRINGS } from '../../strings'
import { NumberField } from '../SelectionInspector'
import { useFieldsLocked } from '../fieldsLock'

export interface ServiceInspectorProps {
  service: Service
  /** The derived body, or `null` when the Service is not standing in what is being shown. */
  derived: DerivedService | null
  unit: DisplayUnit
  precision: number
  onSetLabel: (label: string) => void
  onSetKind: (kind: ServiceKind) => void
  onSetSection: (section: ServiceSection) => void
  onSetOutsideDiameter: (diameter: number) => void
  onSetWidth: (width: number) => void
  onSetDepth: (depth: number) => void
  /** `bottom`, `centre` or `top` move the Service; `height` belongs to a Riser only. */
  onSetVerticalExtent: (field: 'bottom' | 'centre' | 'top' | 'height', value: number) => void
  onDelete: () => void
  /** The renovation action for this Service (#69 §13), when there is an Option to move it to. */
  renovationAction?: ReactNode
}

/** Grouped thousands, as the issue writes a height: `2,600 mm`. */
const grouped = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

const KIND_LABELS: Record<ServiceKind, string> = {
  water: STRINGS.serviceKindWater,
  drain: STRINGS.serviceKindDrain,
  gas: STRINGS.serviceKindGas,
  electrical: STRINGS.serviceKindElectrical,
  air_con: STRINGS.serviceKindAirCon,
  other: STRINGS.serviceKindOther,
}

function Row(props: { testId: string; label: string; value: string }): ReactNode {
  return (
    <>
      <span className="bb-workspace-field-label" data-testid={`${props.testId}-label`}>{props.label}</span>
      <span className="bb-workspace-static-value" data-testid={props.testId}>{props.value}</span>
    </>
  )
}

export function ServiceInspector(props: ServiceInspectorProps): ReactNode {
  const { service, unit, precision } = props
  const { locked } = useFieldsLocked()
  const run = service.shape === 'run'
  const bottom = serviceBottom(service)
  const top = serviceTop(service)
  const round = !run || service.section === 'round'

  return (
    <div
      data-testid="service-inspector"
      className="bb-service-inspector grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-sm">
      <Row testId="inspector-service-shape" label={STRINGS.serviceShape} value={run ? STRINGS.serviceShapeRun : STRINGS.serviceShapeRiser} />

      <span className="bb-workspace-field-label" data-testid="inspector-service-kind-label">{STRINGS.serviceKind}</span>
      <select
        data-testid="inspector-service-kind"
        value={service.kind}
        disabled={locked}
        onChange={(event) => props.onSetKind(event.target.value as ServiceKind)}
      >
        {Object.keys(KIND_LABELS).map((kind) => (
          <option key={kind} value={kind}>{KIND_LABELS[kind as ServiceKind]}</option>
        ))}
      </select>

      {run ? (
        <>
          <span className="bb-workspace-field-label" data-testid="inspector-service-section-label">{STRINGS.serviceSection}</span>
          <select
            data-testid="inspector-service-section"
            value={service.section}
            disabled={locked}
            onChange={(event) => props.onSetSection(event.target.value as ServiceSection)}
          >
            <option value="round">{STRINGS.serviceSectionRound}</option>
            <option value="rectangular">{STRINGS.serviceSectionRectangular}</option>
          </select>
        </>
      ) : null}

      {round ? (
        <>
          <span className="bb-workspace-field-label" data-testid="inspector-service-diameter-label">{STRINGS.serviceDiameter}</span>
          <NumberField
            label={STRINGS.serviceDiameter}
            kind="mm"
            testId="inspector-service-diameter"
            value={service.outsideDiameter ?? 0}
            unit={unit}
            precision={precision}
            min={1}
            onCommit={(value) => props.onSetOutsideDiameter(value)}
          />
        </>
      ) : (
        <>
          <span className="bb-workspace-field-label" data-testid="inspector-service-width-label">{STRINGS.serviceWidth}</span>
          <NumberField
            label={STRINGS.serviceWidth}
            kind="mm"
            testId="inspector-service-width"
            value={service.width ?? 0}
            unit={unit}
            precision={precision}
            min={1}
            onCommit={(value) => props.onSetWidth(value)}
          />
          <span className="bb-workspace-field-label" data-testid="inspector-service-depth-label">{STRINGS.serviceDepth}</span>
          <NumberField
            label={STRINGS.serviceDepth}
            kind="mm"
            testId="inspector-service-depth"
            value={service.depth ?? 0}
            unit={unit}
            precision={precision}
            min={1}
            onCommit={(value) => props.onSetDepth(value)}
          />
        </>
      )}

      {run ? (
        <>
          {/* A Run stores one number; all three boxes write it, and the other two are its
              consequences. `Bottom` is the issue's default field, so it comes first. */}
          <span className="bb-workspace-field-label" data-testid="inspector-service-bottom-label">{STRINGS.serviceBottom}</span>
          <NumberField
            label={STRINGS.serviceBottom}
            kind="mm"
            testId="inspector-service-bottom"
            value={bottom}
            unit={unit}
            precision={precision}
            min={Number.NEGATIVE_INFINITY}
            onCommit={(value) => props.onSetVerticalExtent('bottom', value)}
          />
          <span className="bb-workspace-field-label" data-testid="inspector-service-centre-label">{STRINGS.serviceCentre}</span>
          <NumberField
            label={STRINGS.serviceCentre}
            kind="mm"
            testId="inspector-service-centre"
            value={service.centrelineElevation ?? 0}
            unit={unit}
            precision={precision}
            min={Number.NEGATIVE_INFINITY}
            onCommit={(value) => props.onSetVerticalExtent('centre', value)}
          />
          <span className="bb-workspace-field-label" data-testid="inspector-service-top-label">{STRINGS.serviceTop}</span>
          <NumberField
            label={STRINGS.serviceTop}
            kind="mm"
            testId="inspector-service-top"
            value={top}
            unit={unit}
            precision={precision}
            min={Number.NEGATIVE_INFINITY}
            onCommit={(value) => props.onSetVerticalExtent('top', value)}
          />
        </>
      ) : (
        <>
          {/* A Riser owns its height: `Bottom` moves it, `Top` changes the height. */}
          <span className="bb-workspace-field-label" data-testid="inspector-service-bottom-label">{STRINGS.serviceBottom}</span>
          <NumberField
            label={STRINGS.serviceBottom}
            kind="mm"
            testId="inspector-service-bottom"
            value={service.bottomElevation}
            unit={unit}
            precision={precision}
            min={Number.NEGATIVE_INFINITY}
            onCommit={(value) => props.onSetVerticalExtent('bottom', value)}
          />
          <span className="bb-workspace-field-label" data-testid="inspector-service-top-label">{STRINGS.serviceTop}</span>
          <NumberField
            label={STRINGS.serviceTop}
            kind="mm"
            testId="inspector-service-top"
            value={top}
            unit={unit}
            precision={precision}
            min={Number.NEGATIVE_INFINITY}
            onCommit={(value) => props.onSetVerticalExtent('top', value)}
          />
        </>
      )}

      {/* The derived pair, printed: what the drawing and the Services table both publish. */}
      <Row testId="inspector-service-extent" label={STRINGS.serviceVerticalExtent} value={`${grouped.format(bottom)} – ${grouped.format(top)} mm`} />

      <span className="bb-workspace-field-label" data-testid="inspector-service-label-label">{STRINGS.serviceLabel}</span>
      <input
        type="text"
        data-testid="inspector-service-label"
        value={service.label ?? ''}
        disabled={locked}
        onChange={(event) => props.onSetLabel(event.target.value)}
      />

      {props.renovationAction ?? null}

      <span />
      <button type="button" data-testid="inspector-service-delete" disabled={locked} onClick={props.onDelete}>
        {STRINGS.delete}
      </button>
    </div>
  )
}
