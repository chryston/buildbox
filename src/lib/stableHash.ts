/**
 * A synchronous 64-bit hash of a string (#66 §2).
 *
 * `derive` needs to fold a warning's signature inputs into one short value on every read,
 * and it has to do it inline: `derive` is pure and synchronous, so `crypto.subtle.digest`
 * — the only SHA-256 a browser hands out — is unusable there, and awaiting it would turn
 * every derivation, every memoised read and every render that depends on one into a
 * promise. This is `cyrb53`: two 32-bit multiply-xor lanes, no allocation, no clock, no
 * entropy, and the same 16 hex characters for the same string in every JavaScript engine
 * that implements `Math.imul` (which is every one that runs this code).
 *
 * It is a *fingerprint*, not a commitment. Two different inputs can share one value — at
 * 64 bits that happens by chance about once in 1.8 × 10¹⁹ pairs, which is far more warnings
 * than a Project holds — and nothing here uses it for integrity, authentication or a
 * content-addressed store. Where a byte-level commitment matters, the package codec uses
 * `sha256Hex` from this folder, which is async and says so.
 *
 * The two lanes are returned as hex rather than combined into one number: `h2 * 2**32 + h1`
 * exceeds `Number.MAX_SAFE_INTEGER`, and a signature that loses its top bits to float
 * rounding would quietly collide on the inputs it exists to tell apart.
 */

/** The two 32-bit lanes of the hash, as an 8-digit hex string each. */
const lanes = (input: string): [number, number] => {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < input.length; index += 1) {
    const unit = input.charCodeAt(index)
    h1 = Math.imul(h1 ^ unit, 2654435761)
    h2 = Math.imul(h2 ^ unit, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return [h1 >>> 0, h2 >>> 0]
}

/**
 * The 64-bit `cyrb53` hash of `input`, as exactly 16 lower-case hex characters.
 *
 * Deterministic across runs, platforms and processes, and stable for the same string. An
 * empty string hashes like any other input rather than answering `''`, because a signature
 * of nothing is still a signature: it has to differ from no signature at all.
 */
export const stableHash = (input: string): string => {
  const [h1, h2] = lanes(input)
  // Each lane padded to eight digits: a lane that hashes below 0x10000000 still occupies
  // its half of the value, or two different inputs would land on one string.
  return `${h2.toString(16).padStart(8, '0')}${h1.toString(16).padStart(8, '0')}`
}
