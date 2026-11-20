/**
 * The names on disk and the pixels behind a Plan Image (#61 §6, criterion 12).
 *
 * Two things a person meets without ever seeing this code: what the file is called when it lands in
 * their Downloads, and how coarse an embedded Plan Image is allowed to be. Both are tables rather
 * than behaviour, which is the reason they are pinned here and not in a browser.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { archiveName, drawingFileName, slug } from './slug'
import { downsampledSize, pngSize, PLAN_IMAGE_MAX_DPI } from './fit'

describe('the file name', () => {
  it.each([
    ['Kitchen Wall', 'Kitchen-Wall'],
    ['Café Déjà Vu', 'Cafe-Deja-Vu'],
    ['  the   back room  ', 'the-back-room'],
    ['wall/ceiling', 'wall-ceiling'],
    ['a'.repeat(80), 'a'.repeat(40)],
  ] as const)('folds %j to one path segment', (input, expected) => {
    expect(slug(input)).toBe(expected)
  })

  it('falls back to a name rather than an empty segment', () => {
    // A CJK or Cyrillic Project has no Latin letters to keep, and `____.svg` is not a name.
    expect(slug('廚房')).toBe('buildbox-project')
    expect(slug('Проект')).toBe('buildbox-project')
    expect(slug('   ')).toBe('buildbox-project')
  })

  it('never leaves a path separator in a name', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const made = slug(text)
        expect(made).not.toContain('/')
        expect(made).not.toContain('\\')
        expect(made).not.toContain('..')
        expect(made.length).toBeGreaterThan(0)
      }),
    )
  })

  it('names a Plan View drawing by floor, view and day', () => {
    expect(drawingFileName({ project: 'Kitchen Wall', floor: 'Ground', view: 'Plan', date: '20261120' }, 'svg')).toBe(
      'Kitchen-Wall_Ground_Plan_20261120.svg',
    )
    expect(
      drawingFileName({ project: 'Kitchen Wall', floor: 'Ground', view: 'Plan', date: '20261120', existing: true }, 'pdf'),
    ).toBe('Kitchen-Wall_Ground_Plan_existing_20261120.pdf')
    expect(
      drawingFileName({ project: 'Kitchen Wall', itemDesign: 'Bench', view: 'Elevation', date: '20261120' }, 'png'),
    ).toBe('Kitchen-Wall_Bench_Elevation_20261120.png')
  })

  it('names the archive after the Project and the day', () => {
    expect(archiveName('Kitchen Wall', '20261120')).toBe('Kitchen-Wall_drawings_20261120.zip')
  })
})

describe('the pixels a Plan Image is printed at', () => {
  it('leaves an image at or below the ceiling exactly as stored', () => {
    // 1000 mm across at 150 dpi is 5906 px; anything coarser than 300 dpi is kept as it is,
    // because inventing pixels is the one way to make a drawing lie about what was measured.
    expect(downsampledSize(1181, 886, 100, 75)).toEqual({ widthPx: 1181, heightPx: 886 })
  })

  it('caps a coarser-than-300-dpi image at the ceiling on both axes', () => {
    const made = downsampledSize(4000, 2000, 100, 50)
    expect(made.widthPx).toBeLessThan(4000)
    expect(made.heightPx).toBeLessThan(2000)
    const dpi = made.widthPx / (100 / 25.4)
    expect(Math.round(dpi)).toBeCloseTo(PLAN_IMAGE_MAX_DPI, 0)
  })

  it('never returns a zero-width image', () => {
    expect(downsampledSize(1, 1, 100_000, 100_000).widthPx).toBeGreaterThanOrEqual(1)
  })

  it('keeps the long edge at the chosen size and the aspect ratio intact', () => {
    // The arguments are the drawing's millimetres: the PNG is the sheet resampled to the chosen
    // long edge, so the long edge is always exactly what was asked for and the ratio survives.
    expect(pngSize(4000, 2000, 2048)).toEqual({ widthPx: 2048, heightPx: 1024 })
    expect(pngSize(2000, 4000, 2048)).toEqual({ widthPx: 1024, heightPx: 2048 })
    expect(pngSize(800, 600, 2048)).toEqual({ widthPx: 2048, heightPx: 1536 })
    expect(pngSize(4000, 2000, 4096)).toEqual({ widthPx: 4096, heightPx: 2048 })
  })
})
