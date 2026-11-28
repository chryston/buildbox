/**
 * The Handoff Pack (#85 §3).
 *
 * One archive holding everything a tradesperson asks for: the Drawing Set, the three printed lists and
 * a folder of CSVs. It is written out of the two exporters that already exist rather than a third one,
 * which is what makes §3.2's per-table scope rules true here for free — the Warnings List is scoped by
 * Floor and Design Option here because `exportLists` scopes it that way everywhere, and a pack and the
 * same settings exported from the Lists tab cannot disagree about a row.
 *
 * What is new here is only the packaging: the fixed entry names inside the archive, the one manifest
 * that describes all of it, and the rule that one failed output means no pack at all.
 */
import { sha256Hex, zipEntries } from '../lib'
import { exportFiles } from './index'
import { exportLists, orderedTables } from './lists'
import { manifestBytes, manifestOf, MANIFEST_VERSION } from './zip'
import type { ManifestFile } from './zip'
import { provenanceOf } from './provenance'
import { handoffArchiveName } from './slug'
import { fileDate } from './format'
import { CSV_CONTRACT_VERSION, type TableId } from './csv/tables'
import type {
  ExportDeps,
  ExportFailure,
  ExportFile,
  ExportResult,
  ExportSnapshot,
  HandoffRecipe,
  HandoffResult,
  Recipe,
} from './types'
import { HANDOFF_TABLES } from './types'

/** Where one output sits inside the archive. Fixed names, so a reader can ask for `data/walls.csv`. */
export function handoffPath(kind: 'drawings' | 'item-list' | 'cut-list' | 'comment-register'): string {
  return `${kind}.pdf`
}

/** Where one table's rows sit inside the archive. */
export function handoffDataPath(table: TableId): string {
  return `data/${table}.csv`
}

/** The pack's own file name: `<project>_handoff_<YYYYMMDD>.zip`. */
export function handoffNameOf(snapshot: ExportSnapshot, clock: ExportDeps['clock']): string {
  return handoffArchiveName(snapshot.project.meta.name, fileDate(clock.localDate()))
}

/** The deps the pack needs: a face for the printed half, messages for the Warnings List. */
type HandoffDeps = Pick<
  ExportDeps,
  'clock' | 'buildboxVersion' | 'contractVersion' | 'unsavedChanges' | 'onProgress' | 'warningMessages' | 'font' | 'projectName'
>

/** Every file one of the two exporters handed back, whether it came bare or inside its own archive. */
function produced(result: ExportResult): ExportFile[] {
  return result.ok !== true ? [] : result.kind === 'single' ? [result.file] : [...result.files]
}

/**
 * The pack.
 *
 * All or nothing (#85 §2.4): every output is written first and only then zipped, so a pack that could
 * not be completed is not handed over half-finished. A failure names the output — `drawings.pdf`,
 * `data/walls.csv` — because that is the tick the person has to find.
 */
export async function exportHandoff(
  snapshot: ExportSnapshot,
  recipe: HandoffRecipe,
  deps: HandoffDeps,
): Promise<HandoffResult> {
  const clock = deps.clock
  const failures: ExportFailure[] = []
  const missingGlyphs: string[] = []
  /** Each output's bytes under its fixed pack path, in the order the pack lists them. */
  const written: { path: string; mediaType: string; bytes: Uint8Array; warnings: readonly string[] }[] = []

  /** One exporter's answer, landed under the pack paths the recipe's ticks asked for. */
  const take = (result: ExportResult, paths: readonly string[], glyphs: boolean): void => {
    if (!result.ok) {
      // The exporter named the view or the table it could not write; the pack names the entry, because
      // that is what the person ticked.
      failures.push(...result.failures.map((each) => ({ output: paths[0] ?? each.output, reason: each.reason })))
      return
    }
    const files = produced(result)
    if (glyphs && result.ok === true) {
      for (const glyph of result.missingGlyphs) {
        if (!missingGlyphs.includes(glyph)) missingGlyphs.push(glyph)
      }
    }
    // `exportLists` writes its files in contract order, so the nth file is the nth table asked for.
    files.forEach((file, index) => {
      const path = paths[index] ?? paths[paths.length - 1]!
      written.push({ path, mediaType: file.mediaType, bytes: file.bytes, warnings: [] })
    })
  }

  // The Drawing Set: one PDF, one page per view, in the recipe's page order.
  if (recipe.outputs.drawings && recipe.drawing.views.length > 0) {
    const drawing: Recipe = { ...recipe.drawing, format: 'pdf' }
    take(await exportFiles(snapshot, drawing, deps), [handoffPath('drawings')], true)
  }

  // The printed lists, in one call: the scope rules each table has everywhere else apply here because
  // the same exporter runs. The Comment Register is Open Comments unless the recipe said otherwise,
  // which is the one thing the pack asks that the Lists tab asks differently.
  const PRINTED: readonly [{ readonly output: 'itemList'; readonly table: 'items'; readonly path: 'item-list.pdf' }, {
    readonly output: 'cutList'
    readonly table: 'cut-list'
    readonly path: 'cut-list.pdf'
  }, {
    readonly output: 'commentRegister'
    readonly table: 'comments'
    readonly path: 'comment-register.pdf'
  }] = [
    { output: 'itemList', table: 'items', path: 'item-list.pdf' },
    { output: 'cutList', table: 'cut-list', path: 'cut-list.pdf' },
    { output: 'commentRegister', table: 'comments', path: 'comment-register.pdf' },
  ]
  const printed = PRINTED.filter((each) => recipe.outputs[each.output])
  if (printed.length > 0) {
    take(
      await exportLists(
        snapshot,
        {
          tables: printed.map((each) => each.table),
          scope: recipe.scope,
          formats: Object.fromEntries(printed.map((each) => [each.table, 'pdf'])) as Partial<
            Record<'items' | 'cut-list' | 'comments', 'pdf'>
          >,
          ...(recipe.includeResolvedComments === true ? { includeResolvedComments: true } : {}),
        },
        deps,
      ),
      printed.map((each) => each.path),
      true,
    )
  }

  // The CSVs, in one call, each under `data/`.
  const dataTables = orderedTables(HANDOFF_TABLES.filter((table) => recipe.tables.includes(table)))
  if (dataTables.length > 0) {
    take(
      await exportLists(snapshot, { tables: dataTables, scope: recipe.scope }, deps),
      dataTables.map(handoffDataPath),
      false,
    )
  }

  if (failures.length > 0) return { ok: false, failures }
  if (written.length === 0) {
    return { ok: false, failures: [{ output: handoffNameOf(snapshot, clock), reason: 'empty-drawing' }] }
  }

  const provenance = provenanceOf(snapshot, recipe, deps)
  const entries: ManifestFile[] = []
  for (const item of written) {
    entries.push({
      path: item.path,
      kind: item.path.startsWith('data/') ? 'list' : 'drawing',
      format: item.path.endsWith('.csv') ? 'csv' : 'pdf',
      media_type: item.mediaType,
      bytes: item.bytes.length,
      sha256: await sha256Hex(item.bytes),
      contract_version: provenance.contract_version,
      warnings: item.warnings,
    })
  }
  const manifestFile: ExportFile = {
    name: 'manifest.json',
    mediaType: 'application/json',
    bytes: manifestBytes(
      await manifestOf(snapshot, recipe, provenance, [
        ...entries,
        {
          path: 'manifest.json',
          kind: 'manifest',
          format: 'json',
          media_type: 'application/json',
          contract_version: provenance.contract_version,
          warnings: [],
        },
      ]),
    ),
  }
  const archive = handoffNameOf(snapshot, clock)
  deps.onProgress?.({ stage: 'archive', done: written.length, total: written.length, label: archive })
  return {
    ok: true,
    manifest: manifestFile,
    missingGlyphs,
    archive: {
      name: archive,
      mediaType: 'application/zip',
      bytes: zipPack([{ name: manifestFile.name, bytes: manifestFile.bytes }, ...written.map((item) => ({ name: item.path, bytes: item.bytes }))]),
    },
  }
}

/** The archive: `manifest.json` first, then the outputs in the order above, at the fixed timestamp. */
function zipPack(files: readonly { name: string; bytes: Uint8Array }[]): Uint8Array {
  return zipEntries(files.map((file) => ({ name: file.name, data: file.bytes })))
}

/** The contract version every pack entry carries. */
export const HANDOFF_CONTRACT_VERSION: typeof CSV_CONTRACT_VERSION = CSV_CONTRACT_VERSION

/** The manifest version the pack writes — the same one a Drawing Set or a Lists ZIP writes. */
export const HANDOFF_MANIFEST_VERSION: number = MANIFEST_VERSION
