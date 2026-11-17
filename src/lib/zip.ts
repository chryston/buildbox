/**
 * ZIP in and out (#20 §6, #44). `package` is the only caller and reaches this through
 * the `lib` entry point: `fflate` is a `lib` dependency, never a `package` one.
 *
 * Two halves, both deliberately low-level:
 *
 * - {@link zipEntries} writes an archive byte-for-byte the way the caller says: the
 *   entries in the order given, one fixed mtime, no extra fields, no comment, no
 *   OS-specific attributes. Same input, same bytes — that is what makes a Project
 *   Backup reproducible (#44 §"Determinism rules").
 * - {@link unzipEntries} reads one under a budget. It parses the central directory
 *   first, then inflates entry by entry in bounded chunks, counting the bytes it
 *   actually produces and stopping at the first limit crossed. Declared sizes are
 *   never trusted and never used to allocate, so a zip bomb costs the caller one
 *   chunk of memory rather than the archive's claim (#44 §"Zip bombs").
 *
 * Neither half decides what an entry *means*: path rules, expected names and hashes
 * belong to `package`. Failures here are resource limits and format damage only.
 */
import { UnzipInflate, deflateSync } from 'fflate'

// --- Writing -------------------------------------------------------------------

/** One archive member. `level` 0 stores the bytes, 6 deflates them; the default is 6. */
export interface ZipEntryInput {
  readonly name: string
  readonly data: Uint8Array
  readonly level?: 0 | 6
}

/** The single timestamp every entry is written with: 1980-01-01 00:00:00 (#44). */
const FIXED_DOS_TIME = 0
const FIXED_DOS_DATE = (1 << 5) | 1

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
const VERSION = 20
const UTF8_FLAG = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8
const LOCAL_HEADER_BYTES = 30
const CENTRAL_HEADER_BYTES = 46
const END_HEADER_BYTES = 22
/** Compressed input is fed to the inflater this many bytes at a time. */
const INFLATE_CHUNK_BYTES = 32 * 1024

const encoder = new TextEncoder()
const lenientDecoder = new TextDecoder('utf-8')

/** CRC-32/ISO-HDLC, the checksum a ZIP stores for every entry. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const ascii = (name: string): boolean => {
  for (let index = 0; index < name.length; index += 1) if (name.charCodeAt(index) > 0x7f) return false
  return true
}

/**
 * Write `entries` as a deterministic ZIP: given order, fixed mtime, no extra fields,
 * no comment, no OS attributes. Duplicate names are written as given — deciding
 * whether they are allowed is the caller's job.
 */
export function zipEntries(entries: readonly ZipEntryInput[]): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const flags = ascii(entry.name) ? 0 : UTF8_FLAG
    const level = entry.level ?? 6
    const stored = level === 0
    const body = stored ? entry.data : deflateSync(entry.data, { level })
    const method = stored ? METHOD_STORE : METHOD_DEFLATE
    const crc = crc32(entry.data)

    const local = new Uint8Array(LOCAL_HEADER_BYTES + nameBytes.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, LOCAL_SIGNATURE, true)
    localView.setUint16(4, VERSION, true)
    localView.setUint16(6, flags, true)
    localView.setUint16(8, method, true)
    localView.setUint16(10, FIXED_DOS_TIME, true)
    localView.setUint16(12, FIXED_DOS_DATE, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, body.length, true)
    localView.setUint32(22, entry.data.length, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true)
    local.set(nameBytes, LOCAL_HEADER_BYTES)
    parts.push(local, body)

    const record = new Uint8Array(CENTRAL_HEADER_BYTES + nameBytes.length)
    const centralView = new DataView(record.buffer)
    centralView.setUint32(0, CENTRAL_SIGNATURE, true)
    centralView.setUint16(4, VERSION, true)
    centralView.setUint16(6, VERSION, true)
    centralView.setUint16(8, flags, true)
    centralView.setUint16(10, method, true)
    centralView.setUint16(12, FIXED_DOS_TIME, true)
    centralView.setUint16(14, FIXED_DOS_DATE, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, body.length, true)
    centralView.setUint32(24, entry.data.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)
    record.set(nameBytes, CENTRAL_HEADER_BYTES)
    central.push(record)

    offset += local.length + body.length
  }

  const centralStart = offset
  let centralSize = 0
  for (const record of central) centralSize += record.length

  const end = new Uint8Array(END_HEADER_BYTES)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, END_SIGNATURE, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, centralStart, true)

  return concat([...parts, ...central, end])
}

// --- Reading -------------------------------------------------------------------

/** The DOS timestamp an entry carries, decoded. */
export interface ZipDateTime {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

/** Where one entry lives in the archive, exactly as the central directory declares it. */
export interface ZipIndexEntry {
  readonly name: string
  readonly method: number
  readonly crc32: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly localOffset: number
  /** Where the compressed bytes begin, resolved through the local header. */
  readonly dataOffset: number
  readonly mtime: ZipDateTime
}

export type ZipIndexResult = { ok: true; entries: ZipIndexEntry[] } | { ok: false }

/** The resource budget {@link unzipEntries} enforces; the caller owns the numbers. */
export interface ZipLimits {
  readonly maxEntries: number
  readonly maxEntryBytes: number
  readonly maxTotalBytes: number
  /** Highest tolerated uncompressed : compressed ratio. */
  readonly maxRatio: number
  /** Below this many uncompressed bytes the ratio is not checked at all. */
  readonly ratioFloorBytes: number
}

export interface ZipEntry {
  readonly name: string
  readonly data: Uint8Array
}

/** Why an archive was not read: a limit crossed, or bytes that are not a readable ZIP. */
export type ZipFailureCode = 'too-many-entries' | 'entry-too-large' | 'total-too-large' | 'ratio-exceeded' | 'corrupt-archive'

export interface ZipFailure {
  readonly code: ZipFailureCode
  /** The entry being read when the limit was crossed, when one was known. */
  readonly path?: string
}

export type ZipResult = { ok: true; entries: ZipEntry[] } | { ok: false; failure: ZipFailure }

function readZipDateTime(view: DataView, timeOffset: number, dateOffset: number): ZipDateTime {
  const time = view.getUint16(timeOffset, true)
  const date = view.getUint16(dateOffset, true)
  return {
    year: ((date >>> 9) & 0x7f) + 1980,
    month: (date >>> 5) & 0x0f,
    day: date & 0x1f,
    hour: (time >>> 11) & 0x1f,
    minute: (time >>> 5) & 0x3f,
    second: (time & 0x1f) * 2,
  }
}

/**
 * Parse the end-of-central-directory record and the central directory itself, without
 * inflating anything. `null`-shaped failures (`{ ok: false }`) mean the bytes are not a
 * readable ZIP: no end record, a truncated directory, a ZIP64 archive or an offset that
 * points outside the input.
 */
export function readZipIndex(bytes: Uint8Array): ZipIndexResult {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = findEndRecord(view, bytes.length)
  if (end === null) return { ok: false }

  const count = view.getUint16(end + 10, true)
  const centralSize = view.getUint32(end + 12, true)
  const centralStart = view.getUint32(end + 16, true)
  // ZIP64 archives carry placeholders here; nothing BuildBox writes needs them (#44).
  if (count === 0xffff || centralStart === 0xffffffff || centralSize === 0xffffffff) return { ok: false }
  if (centralStart + centralSize > end) return { ok: false }

  const entries: ZipIndexEntry[] = []
  let cursor = centralStart
  for (let index = 0; index < count; index += 1) {
    if (cursor + CENTRAL_HEADER_BYTES > bytes.length) return { ok: false }
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) return { ok: false }
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    if (method !== METHOD_STORE && method !== METHOD_DEFLATE) return { ok: false }
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const headerEnd = cursor + CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength
    if (headerEnd > bytes.length) return { ok: false }
    const rawName = bytes.subarray(cursor + CENTRAL_HEADER_BYTES, cursor + CENTRAL_HEADER_BYTES + nameLength)
    const name =
      flags & UTF8_FLAG ? new TextDecoder('utf-8', { fatal: true }).decode(rawName) : lenientDecoder.decode(rawName)

    const dataOffset = localDataOffset(view, bytes.length, localOffset)
    if (dataOffset === null) return { ok: false }
    if (dataOffset + compressedSize > bytes.length) return { ok: false }

    entries.push({
      name,
      method,
      crc32: view.getUint32(cursor + 16, true),
      compressedSize,
      uncompressedSize,
      localOffset,
      dataOffset,
      mtime: readZipDateTime(view, cursor + 12, cursor + 14),
    })
    cursor = headerEnd
  }

  return { ok: true, entries }
}

function findEndRecord(view: DataView, length: number): number | null {
  const earliest = Math.max(0, length - END_HEADER_BYTES - 0xffff)
  for (let cursor = length - END_HEADER_BYTES; cursor >= earliest; cursor -= 1) {
    if (view.getUint32(cursor, true) === END_SIGNATURE) return cursor
  }
  return null
}

function localDataOffset(view: DataView, length: number, localOffset: number): number | null {
  if (localOffset + LOCAL_HEADER_BYTES > length) return null
  if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) return null
  const nameLength = view.getUint16(localOffset + 26, true)
  const extraLength = view.getUint16(localOffset + 28, true)
  const dataOffset = localOffset + LOCAL_HEADER_BYTES + nameLength + extraLength
  return dataOffset <= length ? dataOffset : null
}

/**
 * Read every entry of `bytes` under `limits`, in central-directory order.
 *
 * The entry count is checked against the directory before anything is inflated; sizes
 * are counted from the bytes the inflater actually produces, in bounded chunks, so the
 * run stops at the first limit crossed instead of materialising what a bomb declared.
 * Nothing here allocates from a declared size.
 */
export function unzipEntries(bytes: Uint8Array, limits: ZipLimits): ZipResult {
  const index = readZipIndex(bytes)
  if (!index.ok) return { ok: false, failure: { code: 'corrupt-archive' } }
  if (index.entries.length > limits.maxEntries) {
    return { ok: false, failure: { code: 'too-many-entries' } }
  }

  let totalCompressed = 0
  for (const entry of index.entries) totalCompressed += entry.compressedSize

  const entries: ZipEntry[] = []
  let totalBytes = 0

  for (const entry of index.entries) {
    const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize)
    const inflated = inflateEntry(compressed, entry, {
      maxEntryBytes: limits.maxEntryBytes,
      remainingTotalBytes: limits.maxTotalBytes - totalBytes,
      maxRatio: limits.maxRatio,
      ratioFloorBytes: limits.ratioFloorBytes,
    })
    if (!inflated.ok) return { ok: false, failure: inflated.failure }

    totalBytes += inflated.data.length
    // The archive as a whole earns a ratio check only once it is big enough for the
    // comparison to mean anything: a 2 KB manifest at level 6 is 60:1 on its own.
    if (totalBytes >= limits.ratioFloorBytes && totalBytes > totalCompressed * limits.maxRatio) {
      return { ok: false, failure: { code: 'ratio-exceeded', path: entry.name } }
    }
    entries.push({ name: entry.name, data: inflated.data })
  }

  return { ok: true, entries }
}

interface InflateBudget {
  readonly maxEntryBytes: number
  readonly remainingTotalBytes: number
  readonly maxRatio: number
  readonly ratioFloorBytes: number
}

type InflateResult = { ok: true; data: Uint8Array } | { ok: false; failure: ZipFailure }

/**
 * Inflate one entry under `budget`, counting the bytes the inflater actually produces
 * and stopping at the first limit crossed. Compressed input goes in bounded chunks, so
 * a bomb costs one chunk of memory before the run is called off.
 */
function inflateEntry(compressed: Uint8Array, entry: ZipIndexEntry, budget: InflateBudget): InflateResult {
  if (budget.remainingTotalBytes <= 0) {
    return { ok: false, failure: { code: 'total-too-large', path: entry.name } }
  }
  const overBudget = (produced: number): ZipFailure | null => {
    if (produced > budget.maxEntryBytes) return { code: 'entry-too-large', path: entry.name }
    if (produced > budget.remainingTotalBytes) return { code: 'total-too-large', path: entry.name }
    if (produced >= budget.ratioFloorBytes && produced > compressed.length * budget.maxRatio) {
      return { code: 'ratio-exceeded', path: entry.name }
    }
    return null
  }

  if (entry.method === METHOD_STORE) {
    const failure = overBudget(compressed.length)
    if (failure !== null) return { ok: false, failure }
    return { ok: true, data: compressed.slice() }
  }

  const inflater = new UnzipInflate()
  const chunks: Uint8Array[] = []
  let produced = 0
  let sawFinal = false
  let failure: ZipFailure | null = null
  // fflate reports through a callback and swallows anything thrown in it, so the sink
  // only records the verdict; the loop below is what stops feeding it bytes.
  inflater.ondata = (error, data, final) => {
    if (failure !== null) return
    if (error) failure = { code: 'corrupt-archive', path: entry.name }
    else if (data) {
      produced += data.length
      failure = overBudget(produced)
      if (failure === null) chunks.push(data)
    }
    if (final) sawFinal = true
  }

  const chunksToFeed = Math.max(1, Math.ceil(compressed.length / INFLATE_CHUNK_BYTES))
  for (let index = 0; index < chunksToFeed; index += 1) {
    const start = index * INFLATE_CHUNK_BYTES
    const chunk = compressed.subarray(start, Math.min(start + INFLATE_CHUNK_BYTES, compressed.length))
    inflater.push(chunk, index === chunksToFeed - 1)
    if (failure !== null) return { ok: false, failure }
  }

  if (failure !== null) return { ok: false, failure }
  if (!sawFinal) return { ok: false, failure: { code: 'corrupt-archive', path: entry.name } }
  return { ok: true, data: concat(chunks) }
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const out = new Uint8Array(total)
  let cursor = 0
  for (const chunk of chunks) {
    out.set(chunk, cursor)
    cursor += chunk.length
  }
  return out
}
