/**
 * The on-canvas candidate list (#70 §8, criterion 16): while more than one candidate is under the
 * pointer, the canvas says so, next to the pointer, and says what clicking again will do.
 *
 * Three things it has to get right, all of them the issue's words:
 *
 * - the header counts the click that has been made — `Overlap 1/2 · click again to cycle`, then
 *   `2/2` — because the question a person is asking is "have I got the one I wanted yet";
 * - one row per candidate, top first, in the same order the cycle walks, each row the State in
 *   brackets and the entity's **full** name: `W-2` and `W-2′` differ by one character, so a
 *   shortened name is a list that cannot be read;
 * - the current row carries `▶` and is bold, and the whole list is kept inside the canvas bounds by
 *   `clampOverlay` — the same rule the snap radius uses for "the same spot", measured in CSS pixels.
 *
 * It is a layer over the canvas, not a band beside it: the list belongs to the spot that was clicked.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import { DISPLAY_LABELS } from './displayTheme'
import { clampOverlay } from '../selection/overlapCycle'
import type { CanvasPoint, CanvasSize, CycleCandidate } from '../selection/overlapCycle'

export interface OverlapCycleListProps {
  /** The click, in CSS pixels inside the canvas host. */
  point: CanvasPoint
  /** The reachable candidates in cycle order, top first. */
  candidates: readonly CycleCandidate[]
  /** Which of them is selected now. */
  index: number
  /** The entity's full name — never shortened. */
  nameOf: (id: string) => string
  /** The canvas host's box, which the list may not extend past. */
  bounds: CanvasSize
}

export function OverlapCycleList(props: OverlapCycleListProps): ReactNode {
  const { point, candidates, index, nameOf, bounds } = props
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    setSize({ width: el.offsetWidth, height: el.offsetHeight })
  }, [candidates, index])
  const at = clampOverlay(point, size, bounds)
  return (
    <div
      ref={ref}
      className="bb-renovation-overlap"
      data-testid="overlap-cycle"
      style={{ left: `${at.x}px`, top: `${at.y}px` }}
    >
      <div className="bb-renovation-overlap-header" data-testid="overlap-header">
        {RENOVATION_STRINGS.overlapHeader(index + 1, candidates.length)}
      </div>
      <ul className="bb-renovation-overlap-rows">
        {candidates.map((candidate, row) => (
          <li
            key={candidate.entityId}
            data-testid={`overlap-row-${candidate.entityId}`}
            data-current={row === index ? 'true' : 'false'}
            className={row === index ? 'bb-renovation-overlap-row is-current' : 'bb-renovation-overlap-row'}
          >
            <span aria-hidden="true">{row === index ? '▶ ' : ''}</span>
            {RENOVATION_STRINGS.overlapRow(DISPLAY_LABELS[candidate.renovationState], nameOf(candidate.entityId))}
          </li>
        ))}
      </ul>
    </div>
  )
}
