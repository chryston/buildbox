/**
 * Base64 without the DOM (#20 §2): `lib` is pure, so `atob` — a `window` global — is not
 * available here, and the legacy floor-plan image has to be decoded in Node as well as in
 * the browser (#43).
 *
 * Strict on purpose: the only input is the base64 body of a data URL a browser wrote, so
 * anything else (a wrong length, a character outside the alphabet, padding in the middle)
 * is `null` rather than a best-effort guess. Callers report it as their own problem.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Character code to sextet, `-1` for anything that is not in the alphabet. */
const SEXTET = new Int16Array(128).fill(-1)
for (const [index, char] of [...ALPHABET].entries()) SEXTET[char.charCodeAt(0)] = index

/**
 * The bytes `value` encodes, or `null` when it is not canonical base64: a length that is
 * not a multiple of 4, a character outside the alphabet, or padding that is not the one
 * or two `=` characters a well-formed encoding ends with.
 */
export function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  if (value.length % 4 !== 0) return null

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  // Padding belongs at the end and nowhere else; everything before it carries sextets.
  if (value.slice(0, value.length - padding).includes('=')) return null

  const bytes = new Uint8Array(((value.length / 4) * 3) - padding)
  let written = 0
  for (let at = 0; at < value.length; at += 4) {
    const last = at + 4 === value.length
    const a = sextet(value.charCodeAt(at))
    const b = sextet(value.charCodeAt(at + 1))
    const c = last && padding >= 2 ? 0 : sextet(value.charCodeAt(at + 2))
    const d = last && padding >= 1 ? 0 : sextet(value.charCodeAt(at + 3))
    if (a < 0 || b < 0 || c < 0 || d < 0) return null

    const triple = (a << 18) | (b << 12) | (c << 6) | d
    if (written < bytes.length) bytes[written++] = (triple >> 16) & 0xff
    if (written < bytes.length) bytes[written++] = (triple >> 8) & 0xff
    if (written < bytes.length) bytes[written++] = triple & 0xff
  }
  return bytes
}

/** `-1` for a code outside ASCII, which is not base64 either. */
function sextet(code: number): number {
  return code < 128 ? SEXTET[code] as number : -1
}
