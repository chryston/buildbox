/**
 * The Door / window tool's controls on screen (#65 §9, §10, criterion 5's DOM half).
 *
 * The picker's rows, the chip's two numbers and the one sentence a blocked preview says are all
 * asserted through the real aim machine rather than a stub, because the promise the bar makes and
 * the promise the ghost makes have to be the same promise.
 *
 * The pointer is not here. The canvas reports it (`PlanViewCanvas`'s `onCursorChange`) and the
 * Floor workspace aims with it, so this harness is handed the cursor as a prop — a layer above the
 * canvas cannot see the moves that land on the canvas, which is the defect that made the ghost
 * unplaceable in a browser. What a click does with the aim is the workspace's business; the rule
 * it applies — place where the aim fits, nothing where it does not — is asserted below through the
 * same `aimAt`, and the click itself is proven in `e2e/smoke/openings.spec.ts`.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Pt } from '../../../derive'
import type { Wall, WallJunction } from '../../../domain'
import { pt, usableIntervals } from '../../../derive'
import { readoutMm } from '../displayUnits'
import { OpeningDraftOverlay } from './OpeningDraftOverlay'
import { emptyOpeningDraft, openingAim } from './openingDraft'
import type { OpeningAim, OpeningDraft } from './openingDraft'
import { DEFAULT_OPENING_PRESET_ID, openingPresetRow } from './openingPresets'

const FLOOR = 'floor-main'

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

/** The aim of the row the tool opens on, which is what a click on the Floor is answered with. */
const aimOf = (cursor: Pt | null): OpeningAim | null => aimAt(emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID))(cursor)

function Harness({ cursor = null, onCancel = (): void => undefined }: {
  cursor?: Pt | null
  onCancel?: () => void
}): ReactNode {
  const [draft, setDraft] = useState<OpeningDraft>(() => emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID))
  return (
    <OpeningDraftOverlay
      draft={draft}
      onDraft={setDraft}
      aim={aimAt(draft)(cursor)}
      onCancel={onCancel}
      unit="mm"
      precision={0}
    />
  )
}

const layer = (): HTMLElement => screen.getByTestId('opening-draft-layer')
const picker = (): HTMLSelectElement => screen.getByTestId('opening-preset-picker') as HTMLSelectElement
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
    const { rerender } = render(<Harness />)
    expect(chipStart()).toBe('—')
    expect(chipEnd()).toBe('—')
    rerender(<Harness cursor={pt(1500, 0)} />)
    expect(chipStart()).toBe('1,050 mm')
    // The corner with W-2 takes the last 50 mm of W-1, which is what the second number counts to.
    expect(chipEnd()).toBe('1,000 mm')
  })

  it('says nothing while the Opening fits, and exactly one sentence when it does not', () => {
    const { rerender } = render(<Harness cursor={pt(1500, 0)} />)
    expect(message()).toBeNull()
    // Past the corner: the join with W-2 takes the last of W-1, and the sentence says so once.
    rerender(<Harness cursor={pt(2960, 0)} />)
    expect(message()).toBe("Bedroom door doesn't fit here: it would run past the end of W-1.")
    expect(screen.queryAllByTestId('opening-fit-message')).toHaveLength(1)
  })

  it('answers a click with an Opening only where the aim fits', () => {
    // The rule the Floor workspace applies to a click on the canvas, stated where the aim that
    // feeds it is built: a fitting aim is placed, a blocked one and no aim at all are not.
    const fits = aimOf(pt(1500, 0))
    expect(fits).toMatchObject({ hostWallId: 'w1', start: 1050, width: 900, fits: true })
    expect(aimOf(pt(2960, 0))?.fits).toBe(false)
    // Over the room rather than a Wall: nothing to place, and nothing to say.
    expect(aimOf(pt(1500, 1200))).toBeNull()
  })

  it('measures a typed distance from the end the chip has highlighted', () => {
    render(<Harness cursor={pt(1500, 0)} />)
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

  it('leaves the tool on Cancel', () => {
    const onCancel = vi.fn()
    render(<Harness onCancel={onCancel} />)
    fireEvent.click(screen.getByTestId('opening-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('lets the pointer through to the canvas except where its own controls are', () => {
    render(<Harness cursor={pt(1500, 0)} />)
    // The layer covers the canvas, so it must not answer for it: the ghost and the placement both
    // come from moves and clicks the canvas never sees if this layer keeps them.
    expect(layer().className).toContain('pointer-events-none')
    for (const testId of ['opening-tool-options', 'opening-draft-bar']) {
      expect(screen.getByTestId(testId).className).toContain('pointer-events-auto')
    }
  })
})
