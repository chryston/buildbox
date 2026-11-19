/**
 * The Edges tab (#58 §4): the Item Footprint read as the edges it is made of.
 *
 * Read-only, on presets and Custom Paths alike. Editing an edge is #59's work — it needs
 * handles that can be dragged without breaking the loop, which a preset has no meaning for —
 * so the handles on the canvas carry the tooltip that says so rather than sitting there
 * looking draggable.
 *
 * The last column changes name because the two kinds of edge answer different questions: a
 * Line has a direction and no radius, an Arc has a radius and no single direction. A column
 * called `Radius` with four blank cells in it would read as missing data.
 */
import type { ReactNode } from 'react'
import { distance, directionDeg, lengthOf, segmentStart } from '../../../derive'
import type { ClosedPath, Segment } from '../../../derive'
import { readoutMm } from '../displayUnits'
import type { DisplayFormat } from '../../../domain'

/** What one edge is called in the table, in the words the issue uses. */
const EDGE_KIND_NAMES: Record<Segment['kind'], string> = {
  line: 'Line',
  arc: 'Arc',
  ellipticalArc: 'Elliptical arc',
}

export interface EdgesTabProps {
  readonly path: ClosedPath
  readonly format: DisplayFormat
}

export function EdgesTab(props: EdgesTabProps): ReactNode {
  const { path, format } = props
  const read = (mm: number): string => readoutMm(mm, format.unit, format.precision)
  return (
    <div className="bb-edges-tab" data-testid="edges-tab">
      <table className="bb-edges-table">
        <caption className="bb-edges-caption">
          Edges are editable on a Custom Path from #59.
        </caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Kind</th>
            <th scope="col">Length</th>
            <th scope="col">{path.segments.some(isCurved) ? 'Radius' : 'Direction'}</th>
          </tr>
        </thead>
        <tbody>
          {path.segments.map((segment, index) => {
            const from = segmentStart(path, index)
            return (
              <tr key={index} data-testid={`edge-row-${index + 1}`}>
                <td>{index + 1}</td>
                <td data-testid={`edge-kind-${index + 1}`}>{EDGE_KIND_NAMES[segment.kind]}</td>
                <td data-testid={`edge-length-${index + 1}`}>{read(lengthOf(segment, from))}</td>
                <td data-testid={`edge-measure-${index + 1}`}>
                  {segment.kind === 'line'
                    ? `${trimDeg(directionDeg(segment, from))}°`
                    : read(curveRadius(segment))}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const isCurved = (segment: Segment): boolean => segment.kind !== 'line'

/** The radius of a curved edge: an Arc has one, an elliptical arc has two and the X one leads. */
function curveRadius(segment: Segment): number {
  if (segment.kind === 'arc') return distance(segment.center, segment.to)
  if (segment.kind === 'ellipticalArc') return segment.rx
  return 0
}

/** `37.5` reads `37.5`, `90` reads `90` — a direction is not a distance, so no unit dp. */
function trimDeg(value: number): string {
  return String(Math.round(((value % 360) + 360) % 360 * 10) / 10)
}
