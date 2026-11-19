/**
 * Every colour and every size in the drawing, in one table each (#60 §4).
 *
 * The colours are the ones the legacy cabinet canvas and #57's Plan View drew, moved here
 * verbatim — `rgba(124,58,237,0.15)` for a selected Void, `#cbd5e1` for a pull, the
 * `MATERIALS` hexes for a panel — because the issue's promise is that the new display list
 * looks *identical*, and an identical picture is a table of the old numbers, not a fresh
 * choice of good ones. Nothing here is a resolved length: a row names a `SizeRole`, and
 * `resolveSize` turns that into millimetres for the surface being drawn.
 *
 * Two tables rather than one because they answer different questions. `STYLES` is *what this
 * thing looks like*, and is the same on a screen and on paper; `SIZE_ROLES` is *how big is
 * this*, and is the one place that knows a screen has pixels and a sheet has a scale.
 */
import type { ResolvedSize, SizeRole, SizeRow, SizeSpec, Sizing, Style, StyleKey } from './types'

/**
 * The one font stack, named once so every `<text>` is measured and drawn in the same face.
 *
 * Right now that is the stack Tailwind's preflight puts on `html`, which is what the canvases
 * inherited while they wrote no `font-family` of their own. Naming it here rather than leaving
 * the attribute off is what makes the stack a fact of the drawing instead of a fact of
 * whichever page hosts it — and it is the one line the next commit in this issue changes to
 * the bundled `"Noto Sans", sans-serif`, so that the screen and an export agree on the face
 * and `layoutText`'s committed metrics measure the glyphs that actually appear.
 */
export const FONT_STACK =
  'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'

/**
 * What each role's size is on a screen and on paper.
 *
 * The screen column is the legacy arithmetic read the other way: `Math.max(12 / zoom, 8)`
 * in the cabinet canvas is `{ px: 12, mm: 8 }`, and a plan label that was always 12 CSS px
 * is `{ px: 12 }` with no floor, because it never grew with the zoom. The paper column is
 * what the same ink measures on a printed sheet, and is the only column #62's export reads.
 */
export const SIZE_ROLES: Record<SizeRole, SizeRow> = {
  // Text. On screen these are the pixel sizes #57's Plan View set on its `font-size`.
  'plan-label': { screen: { px: 12 }, paper: { mm: 2.5 } },
  'plan-dimension': { screen: { px: 11 }, paper: { mm: 2 } },
  'plan-chip': { screen: { px: 11 }, paper: { mm: 2 } },
  // The distances a Plan View lays its dimensions and its chip out by. These are sizes for the
  // same reason a stroke is: 22 px of offset at 0.4 px per millimetre is 55 mm of Floor, and
  // 4 mm on a sheet, and a dimension line that does not move with the drawing lands on the
  // thing it is measuring.
  'plan-dim-offset': { screen: { px: 22 }, paper: { mm: 4 } },
  'plan-dim-gap': { screen: { px: 8 }, paper: { mm: 1.5 } },
  'plan-dim-tick': { screen: { px: 5 }, paper: { mm: 1 } },
  'plan-chip-height': { screen: { px: 18 }, paper: { mm: 3.5 } },
  // The chip box is still sized per character today; the row exists so that the guess is at
  // least a number that scales, until `layoutText` replaces it (#19 §4).
  'plan-chip-char': { screen: { px: 6.2 }, paper: { mm: 1.2 } },
  // The Item Origin crosshair: its stroke, its arm, its centre dot.
  'plan-origin-line': { screen: { px: 1.25 }, paper: { mm: 0.2 } },
  'plan-origin-arm': { screen: { px: 7 }, paper: { mm: 1.4 } },
  'plan-origin-dot': { screen: { px: 2 }, paper: { mm: 0.4 } },
  // The rotate handle: a grip 24 CSS px past the footprint's furthest corner, whatever the zoom.
  'plan-handle-reach': { screen: { px: 24 }, paper: { mm: 12 } },
  'plan-handle-r': { screen: { px: 6 }, paper: { mm: 3 } },
  'plan-handle-stroke': { screen: { px: 1.5 }, paper: { mm: 0.3 } },
  // The cabinet canvas's two `Math.max(n / zoom, m)` sizes.
  'cabinet-dimension': { screen: { px: 12, mm: 8 }, paper: { mm: 2 } },
  'cabinet-space-label': { screen: { px: 10, mm: 6 }, paper: { mm: 2 } },
  // A locked dimension's glyph, drawn in the scene's own millimetres: the icon is 14 mm of
  // cabinet however big the number beside it happens to be, which is why it is its own role
  // rather than a multiple of the text's.
  'cabinet-lock-icon': { screen: { mm: 14 }, paper: { mm: 3 } },

  // Lines. A plan line was `1 / zoom`, so it stayed one device pixel at every zoom.
  'plan-line': { screen: { px: 1 }, paper: { mm: 0.25 } },
  'plan-line-selected': { screen: { px: 2 }, paper: { mm: 0.25 } },
  hairline: { screen: { px: 1 }, paper: { mm: 0.18 } },
  // The uncalibrated Plan Image's placeholder rect was `strokeWidth={2}` inside the zoomed
  // group, so on screen it is two millimetres of Floor, not two device pixels.
  'plan-placeholder-line': { screen: { mm: 2 }, paper: { mm: 0.25 } },

  // Cabinet construction, which the legacy canvas drew in millimetres of the scene.
  'cabinet-outline': { screen: { mm: 1 }, paper: { mm: 0.25 } },
  'cabinet-outline-bold': { screen: { mm: 2 }, paper: { mm: 0.25 } },
  'cabinet-outline-medium': { screen: { mm: 1.5 }, paper: { mm: 0.18 } },

  // The active unit's marching outline, which *was* pixel-based: `2 / zoom`, `6 / zoom`,
  // `3 / zoom`.
  'cabinet-active': { screen: { px: 2 }, paper: { mm: 0.25 } },
  'cabinet-active-dash': { screen: { px: 6 }, paper: { mm: 3 } },
  'cabinet-active-gap': { screen: { px: 3 }, paper: { mm: 1.5 } },
  // A drawer front's dash is drawn inside the zoomed group, so it is millimetres of the
  // scene and grows with the cabinet — unlike the active-unit dash above, which is chrome.
  'cabinet-outline-dash': { screen: { mm: 6 }, paper: { mm: 3 } },
  'cabinet-outline-gap': { screen: { mm: 2 }, paper: { mm: 1 } },

  // Rounded corners, which are a size for the same reason a stroke is: 2 mm of a cabinet
  // scene is not 2 px of a screen.
  'cabinet-corner': { screen: { mm: 2 }, paper: { mm: 1 } },
  'cabinet-corner-small': { screen: { mm: 1.5 }, paper: { mm: 0.75 } },
  'plan-chip-corner': { screen: { px: 4 }, paper: { mm: 1.5 } },
}

/**
 * Every paint in the drawing, keyed by role.
 *
 * The `:selected` suffix is not a rendering mode, it is a row: `toSvgTree` appends it when
 * the item's `ref` is in the caller's selection, which is what keeps emphasis out of the
 * display list and lets a hit-test-free export look like the unselected canvas.
 *
 * `MATERIALS`' hexes are copied in rather than imported: `src/utils` is legacy and no target
 * module may import it (#20 §2), and a colour the display list cannot name is a colour a
 * renderer would have to hold itself.
 */
export const STYLES: Record<StyleKey, Style> = {
  // --- The Plan View: a Placed Item, its label, its dimensions, the `Floor bounds` chip.
  'plan-item': { fill: 'item', fillAlpha: 0x33 / 0xff, stroke: 'item', strokeWidth: 'plan-line' },
  'plan-item:selected': {
    fill: 'item',
    fillAlpha: 0x33 / 0xff,
    stroke: 'var(--bb-text)',
    strokeWidth: 'plan-line-selected',
  },
  'plan-label': { fill: 'item', size: 'plan-label', fontFamily: FONT_STACK, hit: 'none' },
  'plan-dimension': { fill: 'var(--bb-accent)', size: 'plan-dimension', fontFamily: FONT_STACK, hit: 'none' },
  'plan-dimension-line': { stroke: 'var(--bb-accent)', strokeWidth: 'hairline', hit: 'none' },
  'plan-chip-box': {
    fill: 'var(--bb-bg-card)',
    stroke: 'var(--bb-border-card)',
    strokeWidth: 'hairline',
    corner: 'plan-chip-corner',
    hit: 'none',
  },
  'plan-chip-text': { fill: 'var(--bb-text-muted)', size: 'plan-chip', fontFamily: FONT_STACK, hit: 'none' },

  // The Item Origin: a crosshair on the placement, its centre dot, and the stem out to the
  // rotate handle. `:preview` is the same crosshair while a drag is in flight — a row rather
  // than a parameter, because a display list never mentions interaction and an export of the
  // same Floor must look like the unmanipulated canvas.
  'plan-origin': { stroke: 'var(--bb-text)', strokeWidth: 'plan-origin-line', hit: 'none' },
  'plan-origin:preview': { stroke: 'var(--bb-accent)', strokeWidth: 'plan-origin-line', hit: 'none' },
  'plan-origin-dot': { fill: 'var(--bb-text)', hit: 'none' },
  'plan-origin-dot:preview': { fill: 'var(--bb-accent)', hit: 'none' },
  'plan-rotate-stem': { stroke: 'var(--bb-accent)', strokeWidth: 'plan-line', hit: 'none' },
  'plan-handle': {
    fill: 'var(--bb-bg-card)',
    stroke: 'var(--bb-accent)',
    strokeWidth: 'plan-handle-stroke',
  },

  'plan-placeholder': {
    fill: 'var(--bb-bg-card)',
    stroke: 'var(--bb-border-card)',
    strokeWidth: 'plan-placeholder-line',
    hit: 'none',
  },

  // --- A cabinet's construction.
  'cabinet-panel-oak': { fill: '#C8A96E', stroke: '#8B6914', strokeWidth: 'cabinet-outline' },
  'cabinet-panel-walnut': { fill: '#5C3D1E', stroke: '#3B2410', strokeWidth: 'cabinet-outline' },
  'cabinet-panel-white': { fill: '#F5F5F0', stroke: '#D0CEC8', strokeWidth: 'cabinet-outline' },
  'cabinet-panel-birch': { fill: '#E8D5A3', stroke: '#B09050', strokeWidth: 'cabinet-outline' },
  'cabinet-panel-mdf': { fill: '#D4C5A9', stroke: '#9E8E72', strokeWidth: 'cabinet-outline' },

  'cabinet-void': {
    fill: 'rgba(255,255,255,0.03)',
    stroke: 'transparent',
    strokeWidth: 'cabinet-outline-bold',
  },
  'cabinet-void:selected': {
    fill: 'rgba(124,58,237,0.15)',
    stroke: '#7c3aed',
    strokeWidth: 'cabinet-outline-bold',
  },

  // A Divider's own colours come from its material at the call site, which is why the plain
  // row carries only a width; the five material rows exist so that no renderer holds a
  // literal either.
  'cabinet-divider': { strokeWidth: 'cabinet-outline' },
  'cabinet-divider-oak': { fill: '#C8A96E', stroke: '#8B6914', strokeWidth: 'cabinet-outline' },
  'cabinet-divider-walnut': { fill: '#5C3D1E', stroke: '#3B2410', strokeWidth: 'cabinet-outline' },
  'cabinet-divider-white': { fill: '#F5F5F0', stroke: '#D0CEC8', strokeWidth: 'cabinet-outline' },
  'cabinet-divider-birch': { fill: '#E8D5A3', stroke: '#B09050', strokeWidth: 'cabinet-outline' },
  'cabinet-divider-mdf': { fill: '#D4C5A9', stroke: '#9E8E72', strokeWidth: 'cabinet-outline' },
  // Selection is a row per material, not one shared `:selected`: the renderer suffixes the
  // style the builder named, which is the material row, and a divider that lost its wood
  // colour when you clicked it would be worse than no highlight at all.
  'cabinet-divider-oak:selected': { fill: '#C8A96E', stroke: '#7c3aed', strokeWidth: 'cabinet-outline-bold' },
  'cabinet-divider-walnut:selected': { fill: '#5C3D1E', stroke: '#7c3aed', strokeWidth: 'cabinet-outline-bold' },
  'cabinet-divider-white:selected': { fill: '#F5F5F0', stroke: '#7c3aed', strokeWidth: 'cabinet-outline-bold' },
  'cabinet-divider-birch:selected': { fill: '#E8D5A3', stroke: '#7c3aed', strokeWidth: 'cabinet-outline-bold' },
  'cabinet-divider-mdf:selected': { fill: '#D4C5A9', stroke: '#7c3aed', strokeWidth: 'cabinet-outline-bold' },

  'cabinet-unit-hit': { fill: 'transparent' },
  'cabinet-unit-active': {
    fill: 'none',
    stroke: 'var(--color-accent)',
    strokeWidth: 'cabinet-active',
    dash: ['cabinet-active-dash', 'cabinet-active-gap'],
    hit: 'none',
  },
  'cabinet-drawer-frame': {
    fill: 'none',
    stroke: '#7c3aed',
    strokeWidth: 'cabinet-outline-medium',
    corner: 'cabinet-corner',
  },
  'cabinet-drawer-pull-dot': { fill: '#7c3aed' },
  'cabinet-door': {
    fill: 'none',
    stroke: '#94a3b8',
    strokeWidth: 'cabinet-outline-bold',
    corner: 'cabinet-corner',
  },
  'cabinet-drawer-front': {
    fill: 'none',
    stroke: '#94a3b8',
    strokeWidth: 'cabinet-outline-bold',
    corner: 'cabinet-corner',
    dash: ['cabinet-outline-dash', 'cabinet-outline-gap'],
  },
  'cabinet-pull': { fill: '#cbd5e1', corner: 'cabinet-corner-small' },
  'cabinet-hinge': { fill: '#cbd5e1' },

  // --- The cabinet's dimensions and marks.
  'cabinet-dimension': {
    fill: 'var(--color-dim-label)',
    size: 'cabinet-dimension',
    fontFamily: FONT_STACK,
  },
  'cabinet-dimension:locked': {
    fill: 'var(--color-dim-label)',
    size: 'cabinet-dimension',
    fontFamily: FONT_STACK,
    opacity: 0.4,
  },
  'cabinet-space-label': {
    fill: '#6b7280',
    size: 'cabinet-space-label',
    fontFamily: FONT_STACK,
    hit: 'none',
  },
  'cabinet-lock-mark': {
    stroke: 'var(--color-dim-label)',
    strokeWidth: 'cabinet-outline-medium',
    opacity: 0.4,
  },
  'cabinet-unlock-mark': {
    stroke: '#fbbf24',
    strokeWidth: 'cabinet-outline-medium',
    fill: 'rgba(251,191,36,0.15)',
  },

  // --- The Item Detail's own footprint and name.
  'item-footprint': {
    fill: 'item',
    fillAlpha: 0x33 / 0xff,
    stroke: 'item',
    strokeWidth: 'plan-line',
  },
  'item-label': { fill: 'item', size: 'plan-label', fontFamily: FONT_STACK },
}

/** The style one key names; the table is exhaustive over `StyleKey`, so this never fails. */
export function resolveStyle(key: StyleKey): Style {
  return STYLES[key]
}

/**
 * One size role in millimetres, for the surface being drawn.
 *
 * A screen row with a pixel value alone is that many device pixels, so it divides by the
 * zoom and keeps its thickness as the user zooms out — the plan's hairlines. With an `mm`
 * floor as well it is the larger of the two, which is the legacy canvas's
 * `Math.max(12 / zoom, 8)`: a cabinet's dimension text that stops shrinking before it turns
 * to dust. A row with no `px` at all is millimetres in both modes, because it was always
 * drawn inside the zoomed group.
 *
 * On paper the paper column is the whole answer: `mm` is what the ink measures, and a `px`
 * there is a pixel of the *sheet* at the drawing's own scale.
 */
export function resolveSize(role: SizeRole, sizing: Sizing): ResolvedSize {
  const row = SIZE_ROLES[role]
  if (sizing.kind === 'screen') {
    const mm = screenMm(row.screen, sizing.pxPerMm)
    return { mm, px: mm * sizing.pxPerMm }
  }
  const spec = row.paper
  const mm = 'px' in spec ? spec.px * sizing.scale : spec.mm
  return { mm, px: mm * sizing.scale }
}

/** The screen column read at `pxPerMm` device pixels to the millimetre. */
const screenMm = (spec: SizeSpec, pxPerMm: number): number => {
  if (!('px' in spec)) return spec.mm
  if (spec.mm === undefined) return spec.px / pxPerMm
  return Math.max(spec.px / pxPerMm, spec.mm)
}
