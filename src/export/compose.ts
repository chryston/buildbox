/**
 * One view, on one sheet (#61 §4).
 *
 * The step between "what the model says" and "what a writer draws", and the only place in the
 * module that knows both. It does four things, in this order, and the order is the design:
 *
 * 1. **Derive** the view with `derive`, exactly as the Plan View does on screen.
 * 2. **Change its units.** A display list is built in millimetres of the model, and a sheet is
 *    millimetres of paper, so the derived input is scaled by `1 / denominator` before it is drawn
 *    rather than the finished list afterwards. Scaling the list would put a dimension line's
 *    extension, its offset and its text size — all of which `drawing` expresses in millimetres of
 *    *ink* — through the same shrink, and at 1:50 a dimension line would land 0.08 mm outside the
 *    footprint it measures. Scaling the input instead means `drawing` is handed paper millimetres
 *    and draws them at one to one: the geometry shrinks and the ink does not, which is what a
 *    scale is.
 * 3. **Fit** the drawing to the page and choose the orientation.
 * 4. **Compose** the sheet: the drawing centred in the content area, then the furniture.
 *
 * The result is a display list in the sheet's own frame — millimetres of paper, origin at the
 * sheet's top-left — which every writer can paint without knowing any of the above.
 */

import type { DisplayLayer, DisplayList, MissingGlyph, Rect } from '../drawing'
import { drawItemDetail, drawPlanView } from '../drawing'
import { effectiveFloor, effectiveItemDetail } from '../derive'
import { autoOrientation, fitCheck, fitDenominator, sheetOf } from './fit'
import type { FitSuggestion, Sheet } from './fit'
import { formatLength } from './format'
import { scaleDerivedFloor, scaleDerivedItemDetail } from './scaleInput'
import { SHEET_SIZING, footerItems, frameItems, furnitureLayer, gridItems, scaleBarItems, titleBlockItems } from './sheet'
import { NOT_TO_SCALE, TITLE_BLOCK, scaleStatement, unitStatement } from './strings'
import { keepLayers, translateList } from './transform'
import type { ExportSnapshot, Recipe, RecipeViewRef } from './types'

/** One view, on the sheet it belongs on, in millimetres of paper. */
export type ComposedSheet =
  | {
      readonly ok: true
      readonly sheet: Sheet
      readonly list: DisplayList
      /** The drawing with no sheet furniture on it: what the content hash is taken over. */
      readonly drawing: DisplayList
      /** The view's name, as the title block and the filename both say it. */
      readonly viewName: string
      /** The subject row's label: `Floor` for a Plan View, `Item` for an Item Detail View. */
      readonly subjectLabel: string
      readonly subject: string
      /** The scale statement on the sheet: `Scale 1:50`, or `Not to scale`. */
      readonly scale: string
      /** What the drawing was actually shrunk by, which `Fit to page` decides for itself. */
      readonly denominator: number
      /** Characters the face has no glyph for, for the dialog's notice (criterion 11). */
      readonly missingGlyphs: readonly MissingGlyph[]
    }
  | {
      readonly ok: false
      readonly reason: 'unknown-view' | 'empty-drawing' | 'out-of-paper'
      /** The one-click fixes, nearest change first, when the drawing does not fit. */
      readonly suggestions?: readonly FitSuggestion[]
    }

/** One view that made it onto its sheet. */
export type ComposedDrawing = Extract<ComposedSheet, { ok: true }>

/** The drawing for one view, before any sheet exists. */
interface RawDrawing {
  readonly list: DisplayList
  readonly viewName: string
  readonly subjectLabel: string
  readonly subject: string
}

/**
 * The view as a display list, drawn at `1 / shrink` of the model.
 *
 * The bounds come from `derive` and not from the list, because `Fit to page` needs them to decide
 * the denominator and the denominator is what this call is given. So the order is: derive, measure,
 * choose, draw — never draw, measure, redraw.
 */
function rawDrawing(
  snapshot: ExportSnapshot,
  view: RecipeViewRef,
  recipe: Recipe,
  denominator: number,
): { ok: true; drawing: RawDrawing } | { ok: false; reason: 'unknown-view' } {
  const { project, revision } = snapshot
  const shrink = 1 / denominator
  if (view.kind === 'plan') {
    const planView = project.views.find((each) => each.id === view.viewId)
    if (planView === undefined) return { ok: false, reason: 'unknown-view' }
    const floor = effectiveFloor(project, revision, planView.floorId, null)
    const list = drawPlanView(
      scaleDerivedFloor(floor, shrink),
      { showPlanImage: planView.showPlanImage },
      { sizing: SHEET_SIZING },
    )
    return {
      ok: true,
      drawing: {
        list,
        viewName: planView.name,
        subjectLabel: TITLE_BLOCK.floor,
        subject: project.floors.find((each) => each.id === planView.floorId)?.name ?? '',
      },
    }
  }
  const design = project.itemDesigns.find((each) => each.id === view.itemDesignId)
  if (design === undefined) return { ok: false, reason: 'unknown-view' }
  const detail = effectiveItemDetail(project, revision, design.id)
  const list = drawItemDetail(scaleDerivedItemDetail(detail, shrink), {}, {
    sizing: SHEET_SIZING,
    // The drawing is in millimetres of paper and the number has to say what the room measures, so
    // the length goes back up to the model before it is formatted. A dimension that read `60` on a
    // 1:50 sheet would be the one mistake a reader cannot catch with a tape.
    formatLength: (paperMm: number) => formatLength(paperMm * denominator, recipe.unit, recipe.precision),
  })
  return {
    ok: true,
    drawing: {
      list,
      viewName: TITLE_BLOCK.itemDetail,
      subjectLabel: TITLE_BLOCK.itemDesign,
      subject: design.name,
    },
  }
}

/**
 * The box a derived view covers, in millimetres of the model.
 *
 * Exported because the dialog has to know it before it runs: a fixed scale that will not fit the
 * page is a blocking configuration error, and the only way to find that out in advance is to
 * measure the thing (#61 criterion 14).
 */
export function modelBounds(snapshot: ExportSnapshot, view: RecipeViewRef): Rect | null {
  const { project, revision } = snapshot
  if (view.kind === 'plan') {
    const planView = project.views.find((each) => each.id === view.viewId)
    if (planView === undefined) return null
    // A Floor with no Plan Image and nothing on it has no extent, which is not the same as there
    // being no such view: criterion 7 wants its sheet drawn, frame and all.
    return effectiveFloor(project, revision, planView.floorId, null).bounds ?? { x: 0, y: 0, w: 0, h: 0 }
  }
  const design = project.itemDesigns.find((each) => each.id === view.itemDesignId)
  if (design === undefined) return null
  const detail = effectiveItemDetail(project, revision, design.id)
  return detail.kind === 'cabinet' ? detail.layout.boundingBox : detail.bounds
}

/** A box through a uniform scale about the origin. */
export function scaleRect(rect: Rect, factor: number): Rect {
  return { x: rect.x * factor, y: rect.y * factor, w: rect.w * factor, h: rect.h * factor }
}

/**
 * One view on one sheet.
 *
 * A fixed scale that does not fit is a failure and never a clip: a drawing that quietly loses half
 * a kitchen is worse than no drawing, so the caller is told and offered the fixes `fitCheck` found.
 *
 * A view with nothing in it is not a failure. Criterion 7 wants its sheet — frame, title block,
 * footer, and an empty middle — because a person exporting a whole set expects every view they
 * ticked to come back, and a blank sheet says more clearly than an error that the Floor is empty.
 */
export function composeSheet(
  snapshot: ExportSnapshot,
  view: RecipeViewRef,
  recipe: Recipe,
  clock: { localDate(): string },
  buildboxVersion: string,
): ComposedSheet {
  const bounds = modelBounds(snapshot, view)
  if (bounds === null) return { ok: false, reason: 'unknown-view' }

  const orientation = recipe.orientation === 'auto' ? autoOrientation(bounds, recipe.pageSize) : recipe.orientation
  const check = fitCheck(bounds, recipe.pageSize, orientation, recipe.scale)
  if (!check.fits) return { ok: false, reason: 'out-of-paper', suggestions: check.suggestions }
  const denominator = recipe.scale === 'fit' ? fitDenominator(bounds, recipe.pageSize, orientation) : recipe.scale

  const raw = rawDrawing(snapshot, view, recipe, denominator)
  if (!raw.ok) return raw
  const drawn = raw.drawing.list

  const sheet = sheetOf(recipe.pageSize, orientation, { titleBlock: recipe.titleBlock })
  const scale = recipe.scale === 'fit' ? NOT_TO_SCALE : scaleStatement(recipe.scale)
  // The drawing sits centred in the content area: a sheet whose drawing is off to one side looks
  // like a mistake even when every measurement on it is right.
  const offset = {
    x: sheet.content.x + (sheet.content.w - bounds.w / denominator) / 2 - bounds.x / denominator,
    y: sheet.content.y + (sheet.content.h - bounds.h / denominator) / 2 - bounds.y / denominator,
  }
  const furniture = [
    ...(recipe.titleBlock ? frameItems(sheet) : []),
    ...(recipe.titleBlock && sheet.titleBlock !== null
      ? titleBlockItems(sheet.titleBlock, {
          project: snapshot.project.meta.name,
          subjectLabel: raw.drawing.subjectLabel,
          subject: raw.drawing.subject,
          view: raw.drawing.viewName,
          scale,
          unit: unitStatement(recipe.unit),
          date: clock.localDate(),
          version: buildboxVersion,
        })
      : []),
    ...(recipe.titleBlock ? footerItems(sheet) : []),
    ...(recipe.scale === 'fit' ? [] : scaleBarItems(sheet, recipe.scale)),
  ]
  const placed = translateList(offset.x, offset.y, drawn)
  const layers: DisplayLayer[] = [
    ...(recipe.grid
      ? [{ key: 'sheet-grid' as const, items: gridItems(sheet, scaleRect(bounds, denominator), denominator) }]
      : []),
    ...placed.layers,
    furnitureLayer(furniture),
  ]

  return {
    ok: true,
    sheet,
    // The drawing on its own, with no frame, title block, footer or scale bar on it. The content hash
    // is taken over these bytes and not over `list`, because a title block prints the day and the day
    // a sheet was printed is not part of the drawing on it.
    drawing: {
      space: drawn.space,
      bounds: { x: 0, y: 0, w: sheet.widthMm, h: sheet.heightMm },
      layers: recipe.layers === undefined ? placed.layers : keepLayers(placed.layers, recipe.layers),
      missingGlyphs: placed.missingGlyphs,
    },
    list: {
      space: drawn.space,
      bounds: { x: 0, y: 0, w: sheet.widthMm, h: sheet.heightMm },
      layers: recipe.layers === undefined ? layers : keepLayers(layers, recipe.layers),
      missingGlyphs: placed.missingGlyphs,
    },
    viewName: raw.drawing.viewName,
    subjectLabel: raw.drawing.subjectLabel,
    subject: raw.drawing.subject,
    scale,
    denominator,
    missingGlyphs: placed.missingGlyphs,
  }
}
