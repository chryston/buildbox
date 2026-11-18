#!/usr/bin/env node
// Deterministic seeded-noise PNG for the v3-large-image legacy fixture (#38).
//
// Random RGB bytes barely compress, so width*height*3 is the binary size to within a
// few hundred bytes — that is how the fixture is sized to a target byte length.
// Same arguments always produce the same bytes: the seed drives a mulberry32 PRNG and
// PNG has no timestamps.
//
//   node scripts/make-noise-png.mjs --width 1200 --height 1000 --seed 20260529
//
// Prints JSON with the byte length, SHA-256 and data-URL length; --out writes the file.

import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

/** @returns {Buffer} an 8-bit RGB PNG of seeded noise */
export function noisePng({ width, height, seed }) {
  const rand = mulberry32(seed)
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1)
    raw[row] = 0 // filter: None
    for (let i = 0; i < stride; i++) raw[row + 1 + i] = Math.floor(rand() * 256)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour RGB
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

/**
 * @returns {Buffer} an 8-bit RGB PNG of a room plan: pale ground, a grid and an outline
 *
 * The Migration review fixture (#52) needs a Plan Image whose declared size is the size of the
 * bytes — a review that says `2400 × 1800 px` over a 256-pixel file would be testing the
 * preview's ability to lie. Noise cannot do that at a sane byte count, so this is a flat
 * drawing instead: rows repeat, and deflate takes a 2400×1800 image down to tens of kilobytes.
 */
export function planPng({ width, height, grid = 100 }) {
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  const ground = [0xf4, 0xf1, 0xea]
  const rule = [0xd9, 0xd3, 0xc5]
  const wall = [0x53, 0x4f, 0x46]
  const inset = Math.round(Math.min(width, height) / 12)

  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1)
    raw[row] = 0 // filter: None
    const onWallRow = y === inset || y === height - 1 - inset
    for (let x = 0; x < width; x++) {
      const onWallColumn = x === inset || x === width - 1 - inset
      const onRule = x % grid === 0 || y % grid === 0
      const colour = onWallRow || onWallColumn ? wall : onRule ? rule : ground
      const at = row + 1 + x * 3
      raw[at] = colour[0]
      raw[at + 1] = colour[1]
      raw[at + 2] = colour[2]
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour RGB

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

if (process.argv[1] && process.argv[1].endsWith('make-noise-png.mjs')) {
  const width = Number(arg('width', 1200))
  const height = Number(arg('height', 1000))
  const seed = Number(arg('seed', 20260529))
  const kind = arg('kind', 'noise')
  const png = kind === 'plan' ? planPng({ width, height }) : noisePng({ width, height, seed })
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  const out = arg('out', null)
  if (out) writeFileSync(out, png)
  process.stdout.write(
    `${JSON.stringify(
      {
        out,
        kind,
        widthPx: width,
        heightPx: height,
        ...(kind === 'noise' ? { seed } : {}),
        bytes: png.length,
        sha256: createHash('sha256').update(png).digest('hex'),
        dataUrlChars: dataUrl.length,
      },
      null,
      2,
    )}\n`,
  )
}
