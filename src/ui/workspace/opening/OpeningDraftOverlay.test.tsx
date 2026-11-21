/**
 * The Door / window tool on screen (#65 §9, §10, criterion 5's DOM half).
 *
 * The picker's rows, the chip's two numbers, the one sentence a blocked preview says, and the
 * click that either places an Opening or does nothing — all of it is asserted through the real
 * aim machine rather than a stub, because the promise the bar makes and the promise the ghost
 * makes have to be the same promise.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Pt } from '../../../derive'
import type { Wall, WallJunction } from '../../../domain'
import { pt, usableIntervals } from '../../../derive'
import { readoutMm } from '../displayUnits'
import { OpeningDraftOverlay } from './OpeningDraftOverlay'
import { emptyOpeningDraft, openingAim } from './openingDraft'
import type { OpeningAim, OpeningDraft } from './openingDraft'
import { DEFAULT_OPENING_PRESET_ID, openingPresetRow } from './openingPresets'

const PAN = { x: 100, y: 100 }
const viewport = { zoom: 1, panX: PAN.x, panY: PAN.y }
const FLOOR = 'floor-main'

beforeAll(() => {
  // jsdom's `PointerEvent` carries no coordinates, and the tool is all coordinates.
  if (!globalThis.PointerEvent || !('clientX' in new globalThis.PointerEvent('pointermove'))) {
    globalThis.PointerEvent = MouseEvent as typeof PointerEvent
  }
})

const wall = (id: string, ref: string, x1: number, y1: number, x2: number, y2: number): Wall => ({
  id,
  ref,
  floorId: FLOOR,
  line: { kind: 'line', start: pt(x1, y1), end: pt(x2, y2) },
  thickness: 100,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

const WALLS: readonly Wall[] = [wall('w1', 'W-1', 0, 0, 3000, 0), wall('w2', 'W-2', 3000, 0, 3000, 3000)]
const JUNCTIONS: readonly WallJunction[] = [
  { id: 'j1', floorId: FLOOR, ends: [{ wallId: 'w1', end: 'end' }, { wallId: 'w2', end: 'start' }] },
]
const USABLE = usableIntervals(WALLS, JUNCTIONS)

const aimAt = (draft: OpeningDraft) => (cursor: Pt | null): OpeningAim | null =>
  openingAim(cursor, draft, {
    walls: WALLS,
    junctions: JUNCTIONS,
    usable: USABLE,
    preset: openingPresetRow(draft.presetId),
    hostHeightOf: (wallId) => WALLS.find((each) => each.id === wallId)?.height ?? 0,
    reach: 200,
    refOf: (wallId) => WALLS.find((each) => each.id === wallId)?.ref ?? wallId,
    format: (mm) => readoutMm(mm, 'mm', 0),
  })

function Harness({ onPlace = (): void => undefined, onCancel = (): void => undefined }: {
  onPlace?: (aim: OpeningAim) => void
  onCancel?: () => void
}): ReactNode {
  const [draft, setDraft] = useState<OpeningDraft>(() => emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID))
  const [cursor, setCursor] = useState<Pt | null>(null)
  const aim = aimAt(draft)
  return (
    <OpeningDraftOverlay
      viewport={viewport}
      draft={draft}
      onDraft={setDraft}
      onCursor={setCursor}
      aim={aim(cursor)}
      aimAt={aim}
      onPlace={onPlace}
      onCancel={onCancel}
      unit="mm"
      precision={0}
    />
  )
}

const layer = (): HTMLElement => screen.getByTestId('opening-draft-layer')
const picker = (): HTMLSelectElement => screen.getByTestId('opening-preset-picker') as HTMLSelectElement
const hoverAt = (at: Pt): void => {
  fireEvent.pointerMove(layer(), { clientX: at.x + PAN.x, clientY: at.y + PAN.y })
}
const clickAt = (at: Pt): void => {
  const x = at.x + PAN.x
  const y = at.y + PAN.y
  fireEvent.pointerDown(layer(), { clientX: x, clientY: y })
  fireEvent.pointerUp(layer(), { clientX: x, clientY: y })
}
const message = (): string | null => screen.queryByTestId('opening-fit-message')?.textContent ?? null
const chipStart = (): string => screen.getByTestId('opening-distance-start').textContent ?? ''
const chipEnd = (): string => screen.getByTestId('opening-distance-end').textContent ?? ''

describe('OpeningDraftOverlay', () => {
  it('offers the pack’s rows under three headings, with the bedroom door already chosen', () => {
    render(<Harness />)
    expect(picker().value).toBe('door.bedroom')
    expect(picker().querySelectorAll('optgroup')).toHaveLength(3)
    expect([...picker().querySelectorAll('optgroup')].map((group) => group.label)).toEqual(['Doors', 'Windows', 'Other'])
    const options = [...picker().querySelectorAll('option')].map((option) => option.textContent ?? '')
    expect(options).toHaveLength(9)
    expect(options[0]).toBe('Bedroom door · 900 × 2100 mm')
    expect(options).toContain('Household shelter door · 700 × 1900 mm')
    expect(options).toContain('Standard window · sill 1050 mm')
    expect(options).toContain('Removed wall section')
    // The kitchen row is the one that slides, and the sliding mark is what its symbol draws.
    expect(options.some((text) => /Kitchen/i.test(text))).toBe(true)
  })

  it('shows the pack’s note on the rows whose numbers are typical, and not on the fixed one', () => {
    render(<Harness />)
    // The bedroom door is the row the tool opens on, and the pack gives it no note; the bathroom
    // door and the three windows carry one, because their numbers are typical rather than measured.
    expect(screen.queryByTestId('opening-preset-hint')).toBeNull()
    fireEvent.change(picker(), { target: { value: 'door.bathroom' } })
    expect(screen.getByTestId('opening-preset-hint').textContent).toBe('Typical size — measure yours.')
    fireEvent.change(picker(), { target: { value: 'shelter.household.door' } })
    expect(screen.queryByTestId('opening-preset-hint')).toBeNull()
    expect(screen.getByTestId('opening-preset-fixed').textContent).toBe('Fixed size')
    fireEvent.change(picker(), { target: { value: 'window.standard' } })
    expect(screen.getByTestId('opening-preset-hint').textContent).toBe('Typical size — measure yours.')
  })

  it('measures the room to both usable ends of the Wall the pointer is over', () => {
    render(<Harness />)
    expect(chipStart()).toBe('—')
    expect(chipEnd()).toBe('—')
    hoverAt({ x: 1500, y: 0 })
    expect(chipStart()).toBe('1,050 mm')
    // The corner with W-2 takes the last 50 mm of W-1, which is what the second number counts to.
    expect(chipEnd()).toBe('1,000 mm')
  })

  it('says nothing while the Opening fits, and exactly one sentence when it does not', () => {
    render(<Harness />)
    hoverAt({ x: 1500, y: 0 })
    expect(message()).toBeNull()
    // Past the corner: the join with W-2 takes the last of W-1, and the sentence says so once.
    hoverAt({ x: 2960, y: 0 })
    expect(message()).toBe("Bedroom door doesn't fit here: it would run past the end of W-1.")
    expect(screen.queryAllByTestId('opening-fit-message')).toHaveLength(1)
  })

  it('places nothing where it does not fit, and the Opening where it does', () => {
    const onPlace = vi.fn()
    render(<Harness onPlace={onPlace} />)
    hoverAt({ x: 2960, y: 0 })
    clickAt({ x: 2960, y: 0 })
    expect(onPlace).not.toHaveBeenCalled()
    hoverAt({ x: 1500, y: 0 })
    clickAt({ x: 1500, y: 0 })
    expect(onPlace).toHaveBeenCalledTimes(1)
    expect(onPlace.mock.calls[0]![0]).toMatchObject({ hostWallId: 'w1', start: 1050, width: 900, fits: true })
  })

  it('does nothing when the pointer is over the room rather than a Wall', () => {
    const onPlace = vi.fn()
    render(<Harness onPlace={onPlace} />)
    hoverAt({ x: 1500, y: 1200 })
    expect(chipStart()).toBe('—')
    clickAt({ x: 1500, y: 1200 })
    expect(onPlace).not.toHaveBeenCalled()
  })

  it('measures a typed distance from the end the chip has highlighted', () => {
    render(<Harness />)
    hoverAt({ x: 1500, y: 0 })
    fireEvent.change(screen.getByTestId('opening-distance-field'), { target: { value: '500' } })
    expect(chipStart()).toBe('500 mm')
    expect(chipEnd()).toBe('1,550 mm')
    fireEvent.click(screen.getByTestId('opening-distance-end'))
    // Choosing the end drops the number, so the ghost returns to the pointer's own centre.
    expect(chipStart()).toBe('1,050 mm')
    expect(chipEnd()).toBe('1,000 mm')
    fireEvent.change(screen.getByTestId('opening-distance-field'), { target: { value: '500' } })
    expect(chipEnd()).toBe('500 mm')
  })

  it('leaves the tool on Escape and on Cancel', () => {
    const onCancel = vi.fn()
    render(<Harness onCancel={onCancel} />)
    fireEvent.keyDown(layer(), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('opening-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('never puts a control’s click on the canvas', () => {
    const onPlace = vi.fn()
    render(<Harness onPlace={onPlace} />)
    hoverAt({ x: 1500, y: 0 })
    fireEvent.click(screen.getByTestId('opening-distance-start'))
    fireEvent.click(screen.getByTestId('opening-cancel'))
    expect(onPlace).not.toHaveBeenCalled()
  })
})
