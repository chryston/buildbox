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
import { drawElevationView, drawFloorView, drawItemDetail, wallOpenings } from '../drawing'
import {

  designOptionName,
  deriveRooms,
  deriveWalls,
  displayModel,
  displayProject,
  displayStates,
  effectiveFloor,
  effectiveItemDetail,
  effectiveModel,
  elevationScene,
  rangeClasses,
} from '../derive'
import type { RenovationState } from '../derive'
import { viewDesignOptionId, viewRenovationDisplay } from '../domain'
import { drawingComposition } from './composition'
import { exportNotes } from './notes'
import { autoOrientation, fitCheck, fitDenominator, sheetOf } from './fit'
import type { FitSuggestion, Sheet } from './fit'
import { formatLength } from './format'
import { scaleDerivedFloor, scaleDerivedItemDetail, scaleFloorRooms, scaleFloorWalls, scaleWallOpenings } from './scaleInput'
import { SHEET_SIZING, footerItems, frameItems, furnitureLayer, gridItems, renovationLegendItems, scaleBarItems, titleBlockItems } from './sheet'
import { DESIGN_OPTION, DISPLAY_NAME, NOT_TO_SCALE, TITLE_BLOCK, roomLabel, scaleStatement, unitStatement } from './strings'
import { translateList } from './transform'
import type { ExportSnapshot, Recipe, RecipeViewRef } from './types'
import { DEFAULT_NOTES_SWITCHES } from './types'

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
  /** What the sheet has to say about the Design Option, or null when it was drawn from neither. */
  readonly renovation: {
    readonly designOption: string
    readonly renovationDisplay: string
    readonly states: readonly RenovationState[]
  } | null
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
    const floorId = planView.floorId
    const composition = drawingComposition(project, planView, floorId, view.toggles, recipe.notes)
    const drawn = displayProject(project, composition.optionId)
    // The screen's recipe, line for line (#70 §F): the standing geometry comes from the Project with
    // the active Option's demolition records set aside, so a Wall marked for demolition is still
    // drawn — with its overlay on it — while `displayStates` decides what reaches the paper at all.
    // The Openings are resolved against the Existing Model's Walls, which is what the canvas does.
    // The Display's own states, both for the drawing (which entity is drawn at all, and marked as
    // what) and for the sheet's legend, which has to say what the marks it carries mean.
    const states = composition.optionId === null
      ? null
      : displayStates(displayModel(effectiveModel(project, floorId, composition.optionId), viewRenovationDisplay(planView)))
    // #74 §3: the sheet carries the range of the Plan View it was composed from, because a drawing on
    // paper that quietly redashed every cabinet the section plane passes under would be a different
    // drawing from the one on the screen. The classification reads the Existing Model — the same one
    // the Openings above are resolved against — and the scaling of the geometry below cannot change
    // it, because the answer is keyed by entity.
    const classes = rangeClasses(
      effectiveModel(project, floorId, composition.optionId),
      project.itemDesigns,
      planView.planViewRange,
    )
    // The Floor and its Walls, derived once: the drawing scales them into paper millimetres, while the
    // Notes resolve their Anchors against the unscaled Walls and scale the answer (#83 §2.2) — a scale
    // is something you apply to a place, not something you ask a question about.
    const floor = effectiveFloor(drawn, revision, floorId, composition.optionId)
    const walls = deriveWalls(drawn, floorId, composition.optionId)
    const { list: painted } = drawFloorView(
      {
        floor: scaleDerivedFloor(floor, shrink),
        walls: scaleFloorWalls(walls, shrink),
        rooms: scaleFloorRooms(deriveRooms(drawn, floorId, composition.optionId), shrink),
        openings: scaleWallOpenings(
          wallOpenings(
            project.existingModel.walls,
            project.existingModel.wallJunctions,
            project.existingModel.openings.filter((each) => each.floorId === floorId),
          ),
          shrink,
        ),
      },
      {
        sizing: SHEET_SIZING,
        showPlanImage: planView.showPlanImage,
        renovation: states === null ? null : { states },
        layers: composition.gates,
        range: { classOf: (id) => classes.get(id) ?? 'in' },
        formatRoomLabel: roomLabel,
      },
    )
    // #83 §2: the Annotations of this view and the pins of its Comments ride on the sheet, painted over
    // the Floor in the order the canvas paints them and gated by the recipe — never by the screen's
    // overlay switch, which is Display state and has no say about a file.
    const notes = exportNotes({
      project,
      view: planView,
      optionId: composition.optionId,
      drawnLayer: composition.drawnLayer,
      walls,
      placements: floor.placements,
      notes: recipe.notes ?? DEFAULT_NOTES_SWITCHES,
      shrink,
    })
    const list = notes === null ? painted : {
      ...painted,
      bounds: {
        x: Math.min(painted.bounds.x, notes.bounds.x),
        y: Math.min(painted.bounds.y, notes.bounds.y),
        w: Math.max(painted.bounds.x + painted.bounds.w, notes.bounds.x + notes.bounds.w) - Math.min(painted.bounds.x, notes.bounds.x),
        h: Math.max(painted.bounds.y + painted.bounds.h, notes.bounds.y + notes.bounds.h) - Math.min(painted.bounds.y, notes.bounds.y),
      },
      layers: [...painted.layers, ...notes.layers],
      missingGlyphs: [...painted.missingGlyphs, ...notes.missingGlyphs],
    }
    return {
      ok: true,
      drawing: {
        list,
        viewName: planView.name,
        subjectLabel: TITLE_BLOCK.floor,
        subject: project.floors.find((each) => each.id === planView.floorId)?.name ?? '',
        renovation: composition.optionId === null || states === null
          ? null
          : {
              designOption: designOptionName(project, composition.optionId),
              renovationDisplay: DISPLAY_NAME[viewRenovationDisplay(planView)],
              states: [...new Set(states.values())],
            },
      },
    }
  }
  if (view.kind === 'elevation') {
    const elevationView = (project.elevationViews ?? []).find((each) => each.id === view.viewId)
    if (elevationView === undefined) return { ok: false, reason: 'unknown-view' }
    // The same layer access a Plan View sheet gets (#71 §4): an Elevation View is a saved view like
    // any other, and a sheet that quietly drew what the view hides would be a different drawing from
    // the one on the screen. There are no temporary chips for one yet, so `undefined` is the view.
    const composition = drawingComposition(project, elevationView, elevationView.floorId, undefined, recipe.notes)
    const scene = elevationScene(project, elevationView)
    const states = composition.optionId === null
      ? null
      : displayStates(displayModel(effectiveModel(project, elevationView.floorId, composition.optionId), viewRenovationDisplay(elevationView)))
    const { list } = drawElevationView(scene, {
      sizing: SHEET_SIZING,
      layers: composition.gates,
      scale: shrink,
      // The ruler and the height lines name the room, not the paper: 2600 on a 1:50 sheet, never 52.
      formatHeight: (mm: number) => formatLength(mm, recipe.unit, recipe.precision),
    })
    return {
      ok: true,
      drawing: {
        list,
        viewName: elevationView.name,
        // The subject row says `Floor`, exactly as a Plan sheet's does: what the drawing is of is
        // the same thing, and the view's own name is what says it is looked at sideways.
        subjectLabel: TITLE_BLOCK.floor,
        subject: project.floors.find((each) => each.id === elevationView.floorId)?.name ?? '',
        renovation: composition.optionId === null || states === null
          ? null
          : {
              designOption: designOptionName(project, composition.optionId),
              renovationDisplay: DISPLAY_NAME[viewRenovationDisplay(elevationView)],
              states: [...new Set(states.values())],
            },
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
      renovation: null,
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
    // The same Floor `rawDrawing` draws, Option and all: a fixed scale is checked against the extent
    // of what will be drawn, and a Design Option's proposed Walls can reach past the Existing Model.
    const optionId = viewDesignOptionId(planView)
    // A Floor with no Plan Image and nothing on it has no extent, which is not the same as there
    // being no such view: criterion 7 wants its sheet drawn, frame and all.
    return effectiveFloor(displayProject(project, optionId), revision, planView.floorId, optionId).bounds ?? { x: 0, y: 0, w: 0, h: 0 }
  }
  if (view.kind === 'elevation') {
    const elevationView = (project.elevationViews ?? []).find((each) => each.id === view.viewId)
    if (elevationView === undefined) return null
    // The drawn area, in millimetres of the model: the view line's length across, and the heights the
    // rows and the Floor's own limits reach. The ruler stands outside it and is sized by the paper,
    // not by the model, so it is not part of what has to fit.
    const scene = elevationScene(project, elevationView)
    const limits = scene.floor?.limits
    const heights = [0, ...scene.rows.flatMap((row) => [row.zMin, row.zMax])]
    if ((limits?.lowerMm ?? null) !== null) heights.push(limits!.lowerMm!)
    if ((limits?.upperMm ?? null) !== null) heights.push(limits!.upperMm!)
    const low = Math.min(...heights)
    const high = Math.max(...heights)
    return { x: 0, y: low, w: scene.length, h: high - low }
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
          designOption: raw.drawing.renovation?.designOption ?? DESIGN_OPTION,
          ...(raw.drawing.renovation === null ? {} : { renovationDisplay: raw.drawing.renovation.renovationDisplay }),
          scale,
          unit: unitStatement(recipe.unit),
          date: clock.localDate(),
          version: buildboxVersion,
        })
      : []),
    ...(recipe.titleBlock ? footerItems(sheet) : []),
    ...(recipe.scale === 'fit' ? [] : scaleBarItems(sheet, recipe.scale)),
    // The legend belongs to the drawing rather than the frame: a sheet drawn without a title block
    // still carries its hatches, and a mark nobody can read is not information (#73 §1).
    ...(raw.drawing.renovation === null ? [] : renovationLegendItems(sheet, raw.drawing.renovation.states)),
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
      layers: placed.layers,
      missingGlyphs: placed.missingGlyphs,
    },
    list: {
      space: drawn.space,
      bounds: { x: 0, y: 0, w: sheet.widthMm, h: sheet.heightMm },
      layers,
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
