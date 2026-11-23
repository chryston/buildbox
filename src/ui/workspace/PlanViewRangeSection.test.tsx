/**
 * The **Plan View Range** control, as the card draws it (#74 §4, criteria 4, 5, 6).
 *
 * The gauge is the part a screenshot cannot settle: a stop's label has to read `Upper 1200` and not
 * `Upper 12…`, a drag has to write exactly one transaction on release and none on Esc, and the scale
 * has to have room for the Sump box at −150 and the ceiling at 2600 — the two numbers that make this
 * Floor 2750 mm tall and are the reason the gauge is not a 0–100% slider.
 *
 * The scene is the #74 fixture, so the numbers in these assertions are the numbers the criteria are
 * stated against. The drag measures against a stubbed track box, because jsdom lays nothing out: what
 * is asserted here is the *mapping* from a pointer to a millimetre and the transaction it commits,
 * while "the label is not clipped" is a layout fact, carried by the `max-content` column and
 * photographed by the screenshot.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PlanViewRange, Project } from '../../domain'
import { effectiveModel } from '../../derive'
import { STRINGS } from '../strings'
import { PlanViewRangeSection, rangeGaugeScale, rangeGaugeTicks } from './PlanViewRangeSection'
import type { PlanViewRangeSectionProps } from './PlanViewRangeSection'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures')

/** The #74 fixture scene, read the way a dom test reads a file. */
const scene = (
  JSON.parse(readFileSync(join(fixturesRoot, 'domain', 'v9', 'plan-range-scene.json'), 'utf8')) as {
    project: Project
  }
).project
const floor = scene.floors[0]!
const view = scene.views.find((candidate) => candidate.isDefault) ?? scene.views[0]!

/** The fixture's own range: 0–1200, the one criterion 1 counts the classes at. */
const RANGE: PlanViewRange = view.planViewRange
const SCALE = rangeGaugeScale(floor, effectiveModel(scene, floor.id, null), scene.itemDesigns, RANGE)

const open = (over: Partial<PlanViewRangeSectionProps> = {}) => {
  const onCommit = vi.fn()
  render(
    <PlanViewRangeSection
      range={RANGE}
      scale={SCALE}
      unit="mm"
      precision={0}
      onCommit={onCommit}
      {...over}
    />,
  )
  // jsdom lays nothing out, so the bar is given the box the drag is measured against: 200 px tall,
  // starting at the top of the window. What is under test is the mapping, not the layout.
  const track = screen.getByTestId('range-track')
  track.getBoundingClientRect = (): DOMRect => ({
    top: 0, left: 0, right: 12, bottom: 200, width: 12, height: 200, x: 0, y: 0, toJSON: () => ({}),
  })
  return { onCommit }
}

/** jsdom has no `PointerEvent` at all, so a drag is dispatched as the mouse event it stands in for:
 * the same event name React listens to, the same `clientY`, and nothing the handler can tell apart. */
const pointer = (el: Element, type: string, clientY: number): void => {
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientY }))
}

/** A press and one move to `clientY`; the release is the test's, because that is the commit. */
const dragStop = (stop: 'lower' | 'upper', clientY: number): void => {
  const el = screen.getByTestId(`range-stop-${stop}`)
  el.setPointerCapture = () => undefined
  pointer(el, 'pointerdown', clientY)
  pointer(el, 'pointermove', clientY)
}

describe('the gauge scale', () => {
  it('has room for the Sump box below the Datum and the ceiling above the Range', () => {
    // −150 is the Sump box's base, 2600 the Floor's upper limit; both are inside, with 5% of the
    // 2750 mm span of air outside them.
    expect(SCALE.lowerMm).toBeLessThanOrEqual(-150)
    expect(SCALE.upperMm).toBeGreaterThanOrEqual(2600)
    expect(SCALE.lowerMm).toBeCloseTo(-150 - 2750 * 0.05, 6)
    expect(SCALE.upperMm).toBeCloseTo(2600 + 2750 * 0.05, 6)
  })

  it('ticks at a round step and shows each one in full', () => {
    open()
    const gauge = screen.getByTestId('range-gauge')
    const ticks = rangeGaugeTicks(SCALE)
    expect(ticks.length).toBeGreaterThan(2)
    for (const tick of ticks) {
      const label = screen.getByTestId(`range-tick-${String(tick)}`)
      expect(label.textContent).toBe(String(tick))
      // Every label is a child of the gauge, in the column that is exactly as wide as the widest one.
      expect(gauge.contains(label)).toBe(true)
    }
  })
})

describe('the stops', () => {
  it('names each stop with its own value', () => {
    open()
    expect(screen.getByTestId('range-stop-lower-label').textContent).toBe('Lower 0')
    expect(screen.getByTestId('range-stop-upper-label').textContent).toBe('Upper 1200')
  })

  it('shows the live value while dragging and commits once on release', () => {
    const { onCommit } = open()
    dragStop('upper', 100)
    // Halfway up a 200 px bar of −287.5…2737.5 is 1225 mm, and the label says so before anything is sent.
    expect(screen.getByTestId('range-stop-upper-label').textContent).toBe('Upper 1225')
    expect(onCommit).not.toHaveBeenCalled()

    pointer(screen.getByTestId('range-stop-upper'), 'pointerup', 100)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(0, 1225)
  })

  it('gives the number back on Esc and sends nothing', () => {
    const { onCommit } = open()
    dragStop('upper', 100)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByTestId('range-stop-upper-label').textContent).toBe('Upper 1200')
    pointer(screen.getByTestId('range-stop-upper'), 'pointerup', 100)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('will not drag a stop past the other one', () => {
    const { onCommit } = open()
    // The very bottom of the bar, holding the Upper stop: the band cannot be inverted, so the pair
    // that reaches the Intent is the narrowest one the domain accepts.
    dragStop('upper', 200)
    pointer(screen.getByTestId('range-stop-upper'), 'pointerup', 100)
    expect(onCommit).toHaveBeenCalledWith(0, 1)
  })

  it('sends nothing when a press never moved the stop', () => {
    const { onCommit } = open()
    const el = screen.getByTestId('range-stop-upper')
    el.setPointerCapture = () => undefined
    pointer(el, 'pointerdown', 0)
    pointer(el, 'pointerup', 0)
    expect(onCommit).not.toHaveBeenCalled()
  })
})

describe('the fields', () => {
  it('commits on Enter and on blur, in the Project’s display unit', () => {
    const { onCommit } = open()
    const lower = screen.getByTestId('range-lower-field')
    fireEvent.change(lower, { target: { value: '300' } })
    fireEvent.keyDown(lower, { key: 'Enter' })
    expect(onCommit).toHaveBeenLastCalledWith(300, 1200)

    const upper = screen.getByTestId('range-upper-field')
    fireEvent.change(upper, { target: { value: '2000' } })
    fireEvent.blur(upper)
    expect(onCommit).toHaveBeenLastCalledWith(0, 2000)
  })

  it('refuses a Lower that is not below the Upper, and changes nothing', () => {
    const { onCommit } = open()
    const lower = screen.getByTestId('range-lower-field')
    fireEvent.change(lower, { target: { value: '1300' } })
    fireEvent.keyDown(lower, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByTestId('range-lower-field-error').textContent).toBe('Lower needs to be below Upper.')
    // The box keeps what the person typed so they can fix it, and the record still says 0.
    expect((lower as HTMLInputElement).value).toBe('1300')
  })

  it('refuses the same pair typed into the Upper field', () => {
    const { onCommit } = open()
    const upper = screen.getByTestId('range-upper-field')
    fireEvent.change(upper, { target: { value: '-500' } })
    fireEvent.keyDown(upper, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByTestId('range-upper-field-error').textContent).toBe('Lower needs to be below Upper.')
  })

  it('says `Enter a number.` for a box that holds nothing a number could be', () => {
    const { onCommit } = open()
    const lower = screen.getByTestId('range-lower-field')
    fireEvent.change(lower, { target: { value: 'two hundred' } })
    fireEvent.keyDown(lower, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByTestId('range-lower-field-error').textContent).toBe('Enter a number.')
  })

  it('gives the record’s number back on Esc', () => {
    const { onCommit } = open()
    const lower = screen.getByTestId('range-lower-field')
    fireEvent.change(lower, { target: { value: '900' } })
    fireEvent.keyDown(lower, { key: 'Escape' })
    expect((lower as HTMLInputElement).value).toBe('0')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('stores a metre input as exact millimetres', () => {
    const { onCommit } = open({ unit: 'm', precision: 3 })
    const upper = screen.getByTestId('range-upper-field')
    fireEvent.change(upper, { target: { value: '2.16' } })
    fireEvent.keyDown(upper, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(0, 2160)
  })
})

describe('the section', () => {
  it('is titled, and says what the three styles mean', () => {
    open()
    expect(screen.getByTestId('plan-view-range-title').textContent).toBe('Plan View Range')
    expect(screen.getByTestId('plan-view-range-legend').textContent).toBe(
      'In range: solid · Above range: dashed · Below range: faded. This range belongs to this Plan View only.',
    )
    expect(screen.getByTestId('plan-view-range-legend').textContent).toBe(STRINGS.planViewRangeLegend)
  })
})
