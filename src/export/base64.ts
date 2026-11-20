/**
 * Base64 without the browser (#61).
 *
 * A standalone SVG has no way to reach the Asset Store, so a Plan Image goes into the file as a
 * `data:` URI, and a `data:` URI wants base64. `lib` decodes base64 for the Backup reader and
 * does not export the other direction, and `btoa` is a DOM global that `export` is not allowed to
 * touch — so the encoder lives here, over the same alphabet `lib` reads.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * The bytes as base64, with padding.
 *
 * Three bytes become four characters; a tail of one or two is padded with `=`. No line breaks:
 * a `data:` URI on several lines is a URI some readers end early.
 */
export function base64Encode(bytes: Uint8Array): string {
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0
    const b = bytes[index + 1]
    const c = bytes[index + 2]
    out += ALPHABET[a >> 2]
    out += ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : ALPHABET[c & 0x3f]
  }
  return out
}

/** A stored asset as the URI an SVG can carry on its own. */
export function dataUri(mediaType: string, bytes: Uint8Array): string {
  return `data:${mediaType};base64,${base64Encode(bytes)}`
}
