/**
 * The dashed outlines of #76, drawn above a canvas and under no pointer.
 *
 * Both components sit inside the pane's own matrix group, in the drawing's millimetres, so they
 * ride pan and zoom with the picture they outline. They are screen-only: nothing here enters a
 * Display List, so nothing here can reach a drawing export, and `pointer-events: none` keeps the
 * canvas under them fully interactive — the whole point of a preview you can still pan behind.
 */
import type { ClosedPath } from '../../derive'
import { commandsToPath, pathToCommands } from '../../drawing'
import type { PreviewBand } from './verticalPreview'
import type { ElevationScene } from '../../derive'

/**
 * Plan View: dashed footprints. `clearance` draws in the Clearance token, `preview` in the
 * preview token — the same two colours the panel and the warnings speak in.
 */
export function PlanPreviewOutlines(props: {
  outlines: readonly ClosedPath[]
  kind: 'preview' | 'clearance'
  testId: string
}) {
  const { outlines, kind, testId } = props
  if (outlines.length === 0) return null
  return (
    <g
      data-testid={testId}
      className={`bb-preview-outline bb-preview-outline--${kind}`}
      style={{ pointerEvents: 'none' }}
    >
      {outlines.map((path, index) => (
        <path
          key={index}
          d={commandsToPath(pathToCommands(path))}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  )
}

/**
 * Elevation View: dashed projected rectangles. The pane's own horizontal mirror (`xOf`) and its
 * Datum mapping (`yOf`) place them, which is what puts the band over the row it previews.
 */
export function ElevationPreviewBands(props: {
  bands: readonly PreviewBand[]
  scene: ElevationScene
  topMm: number
  kind: 'preview' | 'clearance'
  testId: string
}) {
  const { bands, scene, topMm, kind, testId } = props
  if (bands.length === 0) return null
  const xOf = (s: number): number => (scene.frame.side === 'left' ? scene.length - s : s)
  const yOf = (z: number): number => topMm - z
  return (
    <g
      data-testid={testId}
      className={`bb-preview-outline bb-preview-outline--${kind}`}
      style={{ pointerEvents: 'none' }}
    >
      {bands.map((band) => {
        const left = Math.min(xOf(band.sMin), xOf(band.sMax))
        const right = Math.max(xOf(band.sMin), xOf(band.sMax))
        const top = yOf(band.zHi)
        const bottom = yOf(band.zLo)
        return (
          <rect
            key={`${kind}-${band.id}`}
            x={left}
            y={top}
            width={Math.max(0, right - left)}
            height={Math.max(0, bottom - top)}
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </g>
  )
}
