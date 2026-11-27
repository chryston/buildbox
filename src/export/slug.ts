/**
 * File names (#61 §10).
 *
 * A drawing's name is the reader's only index into a folder of downloads, so it says which
 * Project, which Floor, which view, and which day — in that order, joined by `_`, with every
 * segment slugged the same way. The day is the author's local calendar date, because it is the
 * day the drawing was made as far as the person holding the paper is concerned — the same day the
 * title block prints, so a name and a sheet never disagree about when the drawing happened.
 *
 * The slug keeps case (`Café Déjà Vu` → `Cafe-Deja-Vu`) because a name that shreds a reader's
 * capitalisation is worse than one that keeps it, and because the case is already a fact about
 * the Project. What it drops is anything a file system or a shell would argue with.
 */

import type { TableId } from './csv/tables'
import type { DrawingFormat as FileFormat } from './types'

/** What a segment falls back to when nothing in it survives. */
export const PROJECT_SLUG_FALLBACK = 'buildbox-project'

/** The longest one segment, so a long Project name cannot crowd the view out of the name. */
export const MAX_SEGMENT = 40

/** The extension each format writes. */
export const EXTENSION: Readonly<Record<FileFormat, string>> = {
  svg: 'svg',
  pdf: 'pdf',
  png: 'png',
}

/** The media type each format writes. */
export const MEDIA_TYPE: Readonly<Record<FileFormat, string>> = {
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  png: 'image/png',
}

/**
 * One path segment from arbitrary user text.
 *
 * Compatibility-normalised so that an `é` written as one code point and one written as two slug
 * the same way; accents stripped, because a name someone has to type at a terminal should not
 * need a compose key; everything left that is not a letter, a digit or a `-` becomes a `-`; runs
 * collapse; the ends are trimmed. A segment with nothing left is `buildbox-project` — CJK and
 * Cyrillic Project names have no Latin letters to keep, and `____` is not a name.
 */
export function slug(value: string): string {
  const folded = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  const trimmed = folded.length > MAX_SEGMENT ? folded.slice(0, MAX_SEGMENT).replace(/-+$/, '') : folded
  return trimmed.length === 0 ? PROJECT_SLUG_FALLBACK : trimmed
}

/** `20261120` — the UTC day of an ISO instant, for the end of a file name. */
export const dateStamp = (iso: string): string => iso.slice(0, 10).replace(/-/g, '')

/** `2026-11-20` — the same day as a title block prints it. */
export const dayStamp = (iso: string): string => iso.slice(0, 10)

/** The parts of one drawing's name. `floor` is absent for an Item Detail View. */
export interface NameParts {
  readonly project: string
  readonly view: string
  readonly date: string
  readonly floor?: string
  /** True for the existing-conditions drawing of a Plan View. */
  readonly existing?: boolean
  readonly itemDesign?: string
}

/**
 * `<project>_<floor>_<view>_existing_<YYYYMMDD>.<ext>` for a Plan View, and
 * `<project>_<item-design>_<view>_<YYYYMMDD>.<ext>` for an Item Detail View.
 */
export function drawingFileName(parts: NameParts, format: FileFormat): string {
  const segments = [slug(parts.project)]
  if (parts.floor !== undefined) segments.push(slug(parts.floor))
  if (parts.itemDesign !== undefined) segments.push(slug(parts.itemDesign))
  segments.push(slug(parts.view))
  if (parts.existing === true) segments.push('existing')
  segments.push(parts.date)
  return `${segments.join('_')}.${EXTENSION[format]}`
}

/**
 * `<project>_drawings_<YYYYMMDD>.zip` — the archive that holds more than one file — or the one PDF a
 * multi-view Drawing Set is, which is named for the set for the same reason (#85 §1.3).
 */
export function archiveName(project: string, date: string, extension: 'zip' | 'pdf' = 'zip'): string {
  return `${slug(project)}_drawings_${date}.${extension}`
}

/**
 * `<project>_items_<YYYYMMDD>.csv`, `<project>_cut-list_<YYYYMMDD>.csv` (#62 §10).
 *
 * The table segment is the contract's own id, `cut-list` and all: the file is named after the
 * table it holds, and a name that renamed the table to make a tidier segment would be a second
 * name for one thing.
 */
export function listFileName(project: string, table: TableId, date: string, extension: 'csv' | 'pdf' = 'csv'): string {
  return `${slug(project)}_${table}_${date}.${extension}`
}

/** `<project>_lists_<YYYYMMDD>.zip` — the archive that holds two or more tables. */
export function listsArchiveName(project: string, date: string): string {
  return `${slug(project)}_lists_${date}.zip`
}

/** `<project>_handoff_<YYYYMMDD>.zip` — the pack a person sends to someone else (#85 §3.3). */
export function handoffArchiveName(project: string, date: string): string {
  return `${slug(project)}_handoff_${date}.zip`
}

/**
 * Segments made unique by `-2`, `-3` after the first.
 *
 * Two Placed Items can be named `Base unit` in one Project, and two saved views can share a name;
 * the drawings are different files and neither may overwrite the other. The suffix goes on the
 * *view* segment rather than on the whole file name, because a name is read segment by segment —
 * `kitchen-2` says which kitchen, where `kitchen-2.svg` says which file and leaves the reader to
 * guess what the `2` counts. The first keeps the plain segment, so the common case of one drawing
 * of each is unchanged.
 */
export function uniqueSegments(segments: readonly string[]): string[] {
  const used = new Set<string>()
  return segments.map((segment) => {
    if (!used.has(segment)) {
      used.add(segment)
      return segment
    }
    let next = 2
    while (used.has(`${segment}-${next}`)) next += 1
    const candidate = `${segment}-${next}`
    used.add(candidate)
    return candidate
  })
}
