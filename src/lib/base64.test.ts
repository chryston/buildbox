import { describe, expect, it } from 'vitest'
import { decodeBase64 } from './base64'

/** The reference decoder, for comparison only: `atob` is a DOM global, banned in source. */
const reference = (value: string): Uint8Array => {
  const binary = Buffer.from(value, 'base64').toString('binary')
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at)
  return bytes
}

describe('decodeBase64', () => {
  it.each(['', 'QQ==', 'QUI=', 'QUJDRA==', 'QUJDREVG', 'Tm8gc3VjaCB0aGluZy4=', '/+//', 'AAAA'])('matches the reference decoder for %j', (value) => {
    expect(decodeBase64(value)).toEqual(reference(value))
  })

  it('decodes the bytes of a real PNG header', () => {
    const bytes = decodeBase64('iVBORw0KGgo=')
    expect([...(bytes ?? [])].map((byte) => byte.toString(16).padStart(2, '0')))
      .toEqual(['89', '50', '4e', '47', '0d', '0a', '1a', '0a'])
  })

  it.each([
    ['a length that is not a multiple of 4', 'QUJDR'],
    ['a character outside the alphabet', 'QUJ*RA=='],
    ['padding in the middle', 'QQ==QQ=='],
    ['whitespace', 'QUJDR A=='],
    ['a non-ASCII character', 'QUJDR\u00e9='],
  ])('rejects %s rather than guessing', (_name, value) => {
    expect(decodeBase64(value)).toBeNull()
  })

  it('round-trips every byte value through the alphabet', () => {
    const original = new Uint8Array(256).map((_value, at) => at)
    const encoded = Buffer.from(original).toString('base64')
    expect(decodeBase64(encoded)).toEqual(original)
  })
})
