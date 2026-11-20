/**
 * The test seam of the export module: a reader strict enough to be a second opinion (#62).
 *
 * A CSV written by a writer that never quotes wrongly looks correct to a parser that never
 * complains. So this parser is the contract's own strictness turned back on the writer: it accepts
 * RFC 4180 and nothing else — CRLF only, a quote only at the start of a field, nothing between a
 * closing quote and the delimiter — and throws on the rest. A round trip through it proves the
 * bytes are what a spreadsheet will make of them, which is the half of criterion 3 that is not a
 * Playwright test.
 *
 * Only tests import this file; `TESTING_IMPORT_PATTERN` in `eslint.config.js` is what keeps it
 * that way.
 */

/** A parsed CSV: whether it opened with a BOM, and its records as fields. */
export interface ParsedCsv {
  readonly bom: boolean
  readonly rows: readonly (readonly string[])[]
}

/**
 * Parse CSV bytes as RFC 4180 means it, throwing on anything a strict reader would reject.
 *
 * A trailing CRLF ends the last record rather than starting an empty one, which is what §6's
 * "one line per row" asks for and what the writer emits.
 */
export function parseCsv(bytes: Uint8Array): ParsedCsv {
  // `ignoreBOM` so that the mark the contract requires is still there to be reported on rather
  // than quietly eaten by the decoder.
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  const bom = text.startsWith('\uFEFF')
  const body = bom ? text.slice(1) : text

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let afterQuote = false
  let index = 0

  const endField = (): void => {
    row.push(field)
    field = ''
    quoted = false
  }
  const endRow = (): void => {
    endField()
    rows.push(row)
    row = []
  }

  while (index < body.length) {
    const char = body[index]!
    if (quoted) {
      if (char === '"') {
        if (body[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
        afterQuote = true
        index += 1
        continue
      }
      field += char
      index += 1
      continue
    }
    if (afterQuote && char !== ',' && char !== '\r' && char !== '\n') {
      throw new Error(`row ${rows.length + 1}: text after a closing quote`)
    }
    afterQuote = false
    if (char === '"') {
      if (field !== '') throw new Error(`row ${rows.length + 1}: quote inside a field`)
      quoted = true
      index += 1
      continue
    }
    if (char === ',') {
      endField()
      index += 1
      continue
    }
    if (char === '\r') {
      if (body[index + 1] !== '\n') throw new Error(`row ${rows.length + 1}: a CR that is not followed by LF`)
      endRow()
      index += 2
      continue
    }
    if (char === '\n') throw new Error(`row ${rows.length + 1}: a bare LF is not an RFC 4180 line ending`)
    field += char
    index += 1
  }
  if (quoted) throw new Error(`row ${rows.length + 1}: unterminated quoted field`)
  if (field !== '' || row.length > 0) endRow()
  return { bom, rows }
}
