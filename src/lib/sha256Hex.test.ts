import { describe, expect, it } from 'vitest'
import { sha256Hex } from './index'

const utf8 = (text: string) => new TextEncoder().encode(text)

describe('sha256Hex', () => {
  it('hashes the empty input', async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('hashes "abc"', async () => {
    expect(await sha256Hex(utf8('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('accepts an ArrayBuffer and returns lowercase hex', async () => {
    const buffer = utf8('abc').buffer
    expect(await sha256Hex(buffer)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('hashes a subarray view, not the whole backing buffer', async () => {
    const padded = utf8('xxabcxx')
    expect(await sha256Hex(padded.subarray(2, 5))).toBe(await sha256Hex(utf8('abc')))
  })
})
