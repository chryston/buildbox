/**
 * SHA-256 through WebCrypto (#20 §2). `globalThis.crypto.subtle` exists in browsers,
 * Workers and Node 24, so this stays usable from the pure Node test project and from
 * the browser bundle with no polyfill.
 */

/** Lowercase hex SHA-256 digest of `data`. Nothing is copied or retained. */
export async function sha256Hex(data: Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  // `BufferSource` still names the pre-generic `ArrayBufferView<ArrayBuffer>`, so a plain
  // `Uint8Array` view has to be named at this boundary. Nothing in BuildBox produces a
  // SharedArrayBuffer, and the digest reads the bytes without retaining them.
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  let hex = ''
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0')
  return hex
}
