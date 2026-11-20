/**
 * The Shapes gallery's glyphs (#58 §4).
 *
 * Each one is the preset itself, evaluated at a demo size and drawn through the same
 * converter the Plan View and the SVG export use — `pathToCommands` then `commandsToPath`,
 * the one route from a kernel path to path data — not a hand-drawn icon. A gallery whose
 * rounded rectangle is drawn by a different rule than the shape it places is a gallery that
 * lies about what you are about to get, and the corner radii are exactly where that would
 * first show.
 */
import type { ReactNode } from 'react'
import { evaluatePreset } from '../../../derive'
import type { Preset, PresetKind } from '../../../derive'
import { commandsToPath, pathToCommands } from '../../../drawing'

/** A demo preset of each kind, sized to sit inside a 100 × 100 box centred on (50, 50). */
const DEMO: Record<PresetKind, Preset> = {
  square: { kind: 'square', side: 70 },
  rectangle: { kind: 'rectangle', width: 82, depth: 54 },
  roundedRectangle: { kind: 'roundedRectangle', width: 82, depth: 54, radius: 14 },
  circle: { kind: 'circle', diameter: 76 },
  ellipse: { kind: 'ellipse', width: 82, depth: 56 },
  capsule: { kind: 'capsule', length: 82, width: 46 },
  triangle: { kind: 'triangle', baseWidth: 82, depth: 66 },
  regularPolygon: { kind: 'regularPolygon', sideCount: 6, sideLength: 30 },
}

/** The gallery's order: the eight presets, in the order the Shape tab documents them. */
export const GALLERY_ORDER: readonly PresetKind[] = [
  'square',
  'rectangle',
  'roundedRectangle',
  'circle',
  'ellipse',
  'capsule',
  'triangle',
  'regularPolygon',
]

/** One preset, drawn. `label` is the accessible name; the shape itself carries no text. */
export function PresetGlyph(props: { kind: PresetKind; label: string; size?: number }): ReactNode {
  const { kind, label, size = 34 } = props
  const path = evaluatePreset(DEMO[kind], { centre: { x: 50, y: 50 }, orientationDeg: 0 })
  return (
    <svg
      className="bb-shape-glyph"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      data-testid={`preset-glyph-${kind}`}
    >
      <path d={commandsToPath(pathToCommands(path))} />
    </svg>
  )
}
