/**
 * Telling a BuildBox Backup apart from everything else a user might hand over (#44
 * steps 1–2, #19).
 *
 * Two questions, both answered from bytes alone: is this a ZIP at all, and if it is not,
 * is it one of the things BuildBox itself wrote out — a loose CSV, PDF, SVG or PNG
 * export — so the user can be told "This is an export, not a BuildBox Backup" instead of
 * "unreadable file"? Only the ZIP signature and the leading bytes are consulted; nothing
 * here parses a document.
 */
import { MANIFEST_ENTRY, PROJECT_ENTRY } from './constants'
import { assetHashOf } from './assets'
import { type PackageProblem, type PackageProblemCode } from './problems'

/** ZIP local, empty-archive and spanning signatures. */
const ZIP_SIGNATURES = [0x04034b50, 0x02014b50, 0x06054b50, 0x08074b50]
const PDF_SIGNATURE = '%PDF'
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** How much of a non-ZIP input is looked at, and the widest CSV header line accepted. */
const SNIFF_BYTES = 4096
const CSV_SEPARATORS = [',', ';', '\t'] as const

const startsWithBytes = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte)

/** Does this start like a ZIP, so that failing to read it is damage rather than a wrong format? */
export function looksLikeZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false
  const signature = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
  return ZIP_SIGNATURES.includes(signature)
}

const looksLikePng = (bytes: Uint8Array): boolean => startsWithBytes(bytes, PNG_SIGNATURE)

/**
 * Text with at least two fields on its first line: what a spreadsheet or a BuildBox
 * export writes, and nothing else that arrives as a file a user might pick. Angle
 * brackets and braces are excluded because those are markup or JSON, handled elsewhere.
 */
function looksLikeCsv(text: string): boolean {
  // Control characters mean binary data wearing a text costume; a CSV has none of them
  // beyond the tab and line endings that separate its fields.
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false
  }
  const line = text.split('\n').find((candidate) => candidate.trim() !== '') ?? ''
  if (line.startsWith('<') || line.startsWith('{') || line.startsWith('[')) return false
  const separator = CSV_SEPARATORS.find((candidate) => line.includes(candidate))
  if (separator === undefined) return false
  return line.split(separator).filter((field) => field.trim() !== '').length >= 2
}

/**
 * Classify input that is not a ZIP: an export BuildBox wrote, or something that is not a
 * Backup at all (#19).
 */
export function classifyNonZip(bytes: Uint8Array): PackageProblemCode {
  if (looksLikePng(bytes)) return 'export-not-backup'
  const text = new TextDecoder('utf-8').decode(bytes.subarray(0, SNIFF_BYTES)).replace(/^\uFEFF/, '')
  const trimmed = text.trimStart()
  if (trimmed.startsWith(PDF_SIGNATURE)) return 'export-not-backup'
  if (trimmed.startsWith('<svg')) return 'export-not-backup'
  if (trimmed.startsWith('<?xml') && trimmed.slice(0, SNIFF_BYTES).includes('<svg')) return 'export-not-backup'
  if (looksLikeCsv(trimmed)) return 'export-not-backup'
  return 'not-a-backup'
}

/**
 * An entry name that is not a plain relative path inside the archive: absolute, driving
 * up a directory, backslashed, carrying a drive letter, with an empty segment, or not in
 * NFC so that two spellings of one name could both be written (#44 step 2).
 */
export function entryPathProblem(name: string): PackageProblem | null {
  const bad: PackageProblem = { code: 'bad-path', path: name }
  if (name === '') return bad
  if (name.includes('\\')) return bad
  if (name.startsWith('/')) return bad
  if (/^[A-Za-z]:/.test(name)) return bad
  for (const segment of name.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') return bad
  }
  if (name.normalize('NFC') !== name) return bad
  return null
}

/** Is this name one the format defines: the manifest, the project, or one asset? */
export function isKnownEntry(name: string): boolean {
  return name === MANIFEST_ENTRY || name === PROJECT_ENTRY || assetHashOf(name) !== null
}
