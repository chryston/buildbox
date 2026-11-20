/**
 * The provenance inside a PNG (#61 §2).
 *
 * A PNG has no comment box that says what it is for, but it has `iTXt`: international text, UTF-8,
 * with a keyword so a reader that does not know BuildBox walks past it. The chunk is spliced in
 * after `IHDR` — the position the specification recommends for text that describes the whole image
 * — and everything else about the file is left exactly as the encoder made it, so the pixels a
 * screenshot test compares are the pixels the browser painted.
 *
 * `lib` owns a CRC-32 for the Backup archive and does not export it, and a chunk's CRC covers the
 * chunk's own type and data rather than a file's, so the table lives here too.
 */

/** The keyword a BuildBox PNG is recognised by. */
export const ITXT_KEYWORD = 'buildbox'

/** The polynomial the PNG specification names, bit-reversed for the usual table method. */
const CRC_POLY = 0xedb88320

/** The 256 remainders CRC-32 needs, built once at module load and never written again. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? CRC_POLY ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

/** The CRC-32 of a run of bytes, as PNG spells it. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** One chunk: length, type, data, and the CRC over type and data together. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let index = 0; index < 4; index++) out[4 + index] = type.charCodeAt(index)
  out.set(data, 8)
  const crcSource = out.subarray(4, 8 + data.length)
  view.setUint32(8 + data.length, crc32(crcSource))
  return out
}

/**
 * The `iTXt` payload: keyword, two zero flags, `en`, an empty translated keyword, then the text.
 *
 * Nothing is compressed. The provenance is a few hundred bytes of JSON whose keys a reader may want
 * to see without a decompressor, and `deflate` output is only byte-stable if the compressor is —
 * which is one more thing not to depend on.
 */
export function iTxtChunk(keyword: string, text: string): Uint8Array {
  const encoder = new TextEncoder()
  const parts = [
    encoder.encode(keyword),
    new Uint8Array([0]),
    new Uint8Array([0, 0]),
    encoder.encode('en'),
    new Uint8Array([0]),
    new Uint8Array([0]),
    encoder.encode(text),
  ]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const data = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    data.set(part, offset)
    offset += part.length
  }
  return chunk('iTXt', data)
}

/** The length of the signature plus the `IHDR` chunk, or `null` for bytes that are not a PNG. */
function afterIhdr(bytes: Uint8Array): number | null {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 12) return null
  if (!SIGNATURE.every((byte, index) => bytes[index] === byte)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (typeAt(bytes, 12) !== 'IHDR') return null
  return 12 + 8 + view.getUint32(8)
}

/** A chunk's four-character type. */
function typeAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset + 4] ?? 0, bytes[offset + 5] ?? 0, bytes[offset + 6] ?? 0, bytes[offset + 7] ?? 0)
}

/**
 * The PNG with BuildBox's provenance in it.
 *
 * Bytes that are not a PNG come back untouched rather than failing the export: the rasterizer
 * produced a real image either way, and a drawing without its metadata is a worse outcome than a
 * drawing whose metadata could not be attached. The caller is told, though — `null` is returned for
 * anything the splicer could not read, and the caller decides.
 */
export function spliceITxt(png: Uint8Array, text: string): Uint8Array | null {
  const at = afterIhdr(png)
  if (at === null) return null
  const meta = iTxtChunk(ITXT_KEYWORD, text)
  const out = new Uint8Array(png.length + meta.length)
  out.set(png.subarray(0, at), 0)
  out.set(meta, at)
  out.set(png.subarray(at), at + meta.length)
  return out
}

/**
 * The text of BuildBox's `iTXt` chunk, or `null` when the file has none.
 *
 * A reader, not only a writer: criterion 1 masks the timestamp out of a PNG's metadata before
 * comparing two runs, and the only way to do that honestly is to read the chunk back out of the
 * bytes a browser encoded.
 */
export function readITxt(png: Uint8Array, keyword: string = ITXT_KEYWORD): string | null {
  const at = afterIhdr(png)
  if (at === null) return null
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let offset = at
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset)
    const type = typeAt(png, offset)
    const dataStart = offset + 8
    if (type === 'iTXt') {
      const data = png.subarray(dataStart, dataStart + length)
      const text = readLatin(data, keyword.length)
      if (text !== keyword) {
        offset = dataStart + length + 4
        continue
      }
      // keyword, NUL, compression flag, method, language tag, NUL, translated keyword, NUL, text.
      let cursor = keyword.length + 3
      cursor = skipString(data, cursor)
      cursor = skipString(data, cursor)
      return new TextDecoder().decode(data.subarray(cursor))
    }
    if (type === 'IEND') return null
    offset = dataStart + length + 4
  }
  return null
}

/** A NUL-terminated run read as Latin-1, which is what a PNG keyword is. */
function readLatin(bytes: Uint8Array, length: number): string {
  let out = ''
  for (let index = 0; index < length && index < bytes.length; index++) out += String.fromCharCode(bytes[index] ?? 0)
  return out
}

/** The offset just past the next NUL, or the end of the chunk if there is none. */
function skipString(bytes: Uint8Array, from: number): number {
  let index = from
  while (index < bytes.length && bytes[index] !== 0) index++
  return Math.min(index + 1, bytes.length)
}
