/**
 * The warning badge as a hit target (#66 §14, criterion 7).
 *
 * Two things are pinned here that no pure test can reach. The first is that the badge answers a
 * pointer with the entity it belongs to, which is the whole of "clicking the badge scrolls to
 * that entity's first row" as far as the renderer is concerned. The second is the shape it
 * answers on: Firefox does not deliver `pointerdown` on a stroke-only SVG path, so a badge drawn
 * as a ring would be clickable in Chromium and dead in Firefox, and every one of those failures
 * would look like a broken strip rather than a missing fill.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { drawWarningBadges } from '../../drawing'
import { DisplayListSvg } from './DisplayListSvg'

const sizing = { kind: 'screen', pxPerMm: 1 } as const
const IDENTITY = 'translate(0,0) scale(1)'

const list = drawWarningBadges([{ id: 'w-2', bounds: { x: 0, y: 0, w: 4000, h: 100 } }], { sizing })!

function shown(onWarningBadgePointerDown: (id: string) => void, onBackground = vi.fn()): void {
  render(
    <svg data-testid="canvas" onClick={onBackground}>
      <DisplayListSvg
        list={list}
        sizing={sizing}
        matrix={IDENTITY}
        textSpace="screen"
        screen={{ pxPerUnit: 1, panX: 0, panY: 0 }}
        resolveAsset={() => null}
        interactions={{ onWarningBadgePointerDown }}
      />
    </svg>,
  )
}

describe('a warning badge', () => {
  it('answers a pointer with the entity it belongs to', () => {
    const onWarningBadgePointerDown = vi.fn()
    shown(onWarningBadgePointerDown)
    fireEvent.pointerDown(screen.getByTestId('warning-badge-w-2'))
    expect(onWarningBadgePointerDown).toHaveBeenCalledWith('w-2')
  })

  it('owns the gesture, so the Wall underneath is not what was clicked', () => {
    const onWarningBadgePointerDown = vi.fn()
    const onBackground = vi.fn()
    shown(onWarningBadgePointerDown, onBackground)
    const badge = screen.getByTestId('warning-badge-w-2')
    fireEvent.pointerDown(badge)
    fireEvent.click(badge)
    expect(onWarningBadgePointerDown).toHaveBeenCalledTimes(1)
    expect(onBackground).not.toHaveBeenCalled()
  })

  it('is filled, because a ring is not a hit target in Firefox', () => {
    shown(vi.fn())
    const paths = screen.getByTestId('warning-badge-w-2').querySelectorAll('path')
    const fills = [...paths].map((path) => path.getAttribute('fill'))
    expect(fills.some((fill) => fill !== null && fill !== 'none')).toBe(true)
  })
})
