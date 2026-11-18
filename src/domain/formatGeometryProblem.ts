import type { GeometryProblem } from '../geometry'
import type { DisplayUnit } from './project'

/**
 * How a geometry problem's numbers are shown: the Project's display unit and precision
 * (#41), never a value baked into the kernel. Validity never depends on this — only the
 * words do.
 */
export interface DisplayFormat {
  unit: DisplayUnit
  precision: number
}

const LABEL: Record<DisplayUnit, string> = { mm: 'mm', cm: 'cm', m: 'm' }

const PER_METRE: Record<DisplayUnit, number> = { mm: 1, cm: 10, m: 1000 }

const number = (mm: number, format: DisplayFormat): string =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: format.precision,
    maximumFractionDigits: format.precision,
  }).format(mm / PER_METRE[format.unit])

const list = (edges: number[]): string => edges.join(' and ')

/**
 * The plain-language message for one geometry problem (#54 §3, behaviour 18).
 *
 * Problems are structured and the kernel never builds prose; this is where the numbers
 * become the Project's unit and precision. Messages name edges and sides, never
 * coordinates, so a validation message stays readable when the shape moves.
 */
export function formatGeometryProblem(problem: GeometryProblem, format: DisplayFormat): string {
  const { code, edges, values = [], side } = problem
  switch (code) {
    case 'edges-cross':
      return `Edges ${list(edges)} cross here`
    case 'edges-touch':
      return `Edges ${list(edges)} touch`
    case 'edge-no-length':
      return `Edge ${list(edges)} has no length`
    case 'too-few-edges':
      return 'A shape needs at least 3 edges'
    case 'no-area':
      return 'Shape encloses no area'
    case 'corner-radii-overlap': {
      const [first, second, sideLength] = values
      const where = side !== undefined ? `the ${side} side` : `edge ${list(edges)}`
      return `Corner radii on ${where} overlap (${number(first ?? 0, format)} + ${number(second ?? 0, format)} > ${number(sideLength ?? 0, format)} ${LABEL[format.unit]})`
    }
    case 'arc-radius-too-small':
      return 'Arc radius is smaller than half its chord'
    case 'arc-not-closed':
      return `Edge ${list(edges)} doesn't meet its neighbour`
    case 'radius-not-positive':
      return `Edge ${list(edges)} has no radius`
    case 'size-not-positive':
      return 'The size needs to be more than zero'
    case 'capsule-too-short':
      return 'Capsule length needs to be more than its width'
    case 'side-count-too-small':
      return 'A regular polygon needs at least 3 whole sides'
  }
}
