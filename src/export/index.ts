/**
 * The export module's barrel (#20 §2).
 *
 * One door, and nothing behind it: every module the export is made of is re-exported here and no
 * logic lives in this file. That is what lets `files.ts` hold the drawing pipeline and `handoff.ts`
 * build a pack out of it without either importing the barrel that re-exports it.
 */
export { exportFiles } from './files'
export { exportHandoff, handoffDataPath, handoffNameOf, handoffPath } from './handoff'
export { listRows } from './rows'
export { composeSheet, modelBounds } from './compose'
export type { ComposedDrawing, ComposedSheet } from './compose'
// The sizing every sheet is drawn at, so the dialog's preview and the file agree on what a
// millimetre of paper is; one declaration, because the preview that sized differently is a second
// renderer wearing the first one's clothes.
export { SHEET_SIZING } from './sheet'
export { fitCheck, suggestionsFor, downsampledSize, pngSize, PAGE_MM, MARGIN_MM, FIXED_SCALES } from './fit'
export { EXPORT_FOOTER, NOT_TO_SCALE, NOTES_SWITCH_LABELS, notesStatement, roomLabel, scaleStatement, SCOPE } from './strings'
// The whole table as one namespace, for the CI scan over shipped strings (#66 criterion 8),
// which has to see every word the writers can put in a file rather than the four the dialog asks for.
export * as EXPORT_WORDS from './strings'
export { defaultCutListStates, defaultListsScope, describeScope } from './scope'
export { hiddenInView } from './hiddenInView'
export type { HiddenInView } from './hiddenInView'
export { needsActiveOption } from './blocking'
export { drawingComposition, drawingLayerChips } from './composition'
export type { DrawingComposition, DrawingLayerChip } from './composition'
export { exportLists, listsSummary, CSV_MEDIA_TYPE } from './lists'
export type { ListsSummary } from './lists'
// The printed model (#84 §1): the CSV's rows as display strings. Public because the dialog shows the
// row count and the notice a PDF of it carries, and both have to be read from the same model the
// page is drawn from.
export { tableModel } from './tableModel'
export type { CellAlign, TableModel, TableColumn } from './tableModel'
export { tableSheets, writeTablePdf } from './tablePdf'
export type { TablePdfInput, TablePdfResult } from './tablePdf'
export { LENGTH_DP, AREA_DP, ANGLE_DP, INTEGER_DP, formatNumber, neutralise, quote } from './csv/format'
export {
  CSV_CONTRACT_VERSION,
  CUT_LIST_TABLE,
  ITEMS_TABLE,
  TABLES,
  headerLine,
} from './csv/tables'
export type { Column, ColumnKind, ListTableId, TableId, TableSpec } from './csv/tables'
export { CSV_BOM, writeCsv } from './csv/write'
export type { Cell, CsvRow } from './csv/write'
export { slug, drawingFileName, archiveName, listFileName, listsArchiveName, handoffArchiveName } from './slug'
export { defaultPageOrder, orderedViews, pageOrderOf, viewKey } from './pageOrder'
export type { HandoffRecipe, HandoffOutputs, HandoffResult, HandoffSuccess, HandoffFailure } from './types'
export { HANDOFF_TABLES, DEFAULT_HANDOFF_OUTPUTS, DEFAULT_HANDOFF_TABLES } from './types'
export type { SheetPage } from './compose'
export { SINGLE_PAGE } from './compose'
export { provenanceOf, provenanceJson } from './provenance'
export { manifestOf, manifestBytes, zipOf } from './zip'
export type { Manifest, ManifestFile } from './zip'
export type {
  CompositionColorOverride,
  CompositionLayer,
  CompositionNotes,
  DrawingFormat,
  DrawingToggles,
  ExportClock,
  ExportDeps,
  ExportFailure,
  ExportFailureReason,
  ExportFile,
  ExportProgress,
  ExportResult,
  ExportSnapshot,
  ListsRecipe,
  ListFormat,
  NotesSwitches,
  Orientation,
  OrientationSetting,
  PageSize,
  PngLongEdge,
  RasterImage,
  Rasterizer,
  RasterSurface,
  Recipe,
  RecipeViewRef,
  RecordedComposition,
  ScaleDenominator,
  ScaleSetting,
} from './types'
export type { AssetBytes } from './types'
export { DEFAULT_NOTES_SWITCHES } from './types'
export { exportNotes } from './notes'
export type { ExportNotesInput, ExportNotePlacement } from './notes'
