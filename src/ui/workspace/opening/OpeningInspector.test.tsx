/**
 * The Opening inspector (#65 §11, criterion 7's DOM half).
 *
 * The two numbers the issue names are the ones a person types back into the plan, so they are
 * asserted as arithmetic: `Distance from end` on a 3 000 mm host with a 900 door at 1 050 reads
 * 950, and typing 500 there means `start` 1 600 — the mirror the Plan View drew with, not a
 * second copy of the stored number. The sentences are asserted word for word because the
 * sentence is the promise: which face the leaf swings toward, in the words a plan reader has.
 */
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Opening, Wall } from '../../../domain'
import { pt } from '../../../derive'
import { OpeningInspector, swingSentence } from './OpeningInspector'

const host: Wall = {
  id: 'w3',
  ref: 'W-3',
  floorId: 'floor-main',
  line: { kind: 'line', start: pt(0, 0), end: pt(3000, 0) },
  thickness: 100,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
}

const door = (over: Partial<Opening> = {}): Opening => ({
  id: 'o1',
  floorId: 'floor-main',
  hostWallId: 'w3',
  kind: 'door',
  label: 'Door 1',
  start: 600,
  width: 900,
  sill: 0,
  head: 2100,
  swing: 'left',
  hingeSide: 'start',
  ...over,
})

/** Every callback the inspector fired, in order: what a button *asked for*. */
const log: (string | number)[][] = []
const reset = (): void => { log.length = 0 }

function Harness(props: { opening?: Opening }): ReactNode {
  const opening = props.opening ?? door()
  return (
    <OpeningInspector
      opening={opening}
      host={host}
      end={opening.start + opening.width}
      hostLength={3000}
      unit="mm"
      precision={0}
      onRename={(label) => log.push(['rename', label])}
      onSetWidth={(width) => log.push(['width', width])}
      onSetStart={(start) => log.push(['start', start])}
      onFlipHinge={() => log.push(['hinge'])}
      onFlipSwing={() => log.push(['swing'])}
      onSelectHost={() => log.push(['host'])}
      onDelete={() => log.push(['delete'])}
    />
  )
}

const type = (testId: string, value: string): void => {
  const field = screen.getByTestId(testId)
  fireEvent.change(field, { target: { value } })
  fireEvent.keyDown(field, { key: 'Enter' })
}

describe('OpeningInspector', () => {
  it('reads the kind, the host and the vertical extent the issue writes', () => {
    reset()
    render(<Harness />)
    expect(screen.getByTestId('opening-inspector-kind').textContent).toBe('Door')
    expect(screen.getByTestId('opening-inspector-host').textContent).toBe('W-3')
    expect(screen.getByTestId('opening-inspector-sill').textContent).toBe('0 mm')
    expect(screen.getByTestId('opening-inspector-head').textContent).toBe('2,100 mm')
    fireEvent.click(screen.getByTestId('opening-inspector-host'))
    expect(log).toEqual([['host']])
  })

  it('reads the same stored distance from either end and writes it back as start', () => {
    reset()
    render(<Harness />)
    expect(screen.getByTestId('opening-inspector-distance')).toHaveValue(600)
    fireEvent.click(screen.getByTestId('opening-inspector-from-end'))
    // 3,000 − 1,500: the far jamb is where the plan draws it, not start + width of an arc.
    expect(screen.getByTestId('opening-inspector-distance')).toHaveValue(1500)
    type('opening-inspector-distance', '500')
    expect(log).toEqual([['start', 1600]])
  })

  it('writes a typed width as its own Intent', () => {
    reset()
    render(<Harness />)
    type('opening-inspector-width', '1000')
    expect(log).toEqual([['width', 1000]])
  })

  it('says which face the leaf swings toward and offers both flips', () => {
    reset()
    render(<Harness />)
    expect(screen.getByTestId('opening-inspector-swing').textContent).toBe('Opens toward this side of W-3')
    fireEvent.click(screen.getByTestId('opening-inspector-flip-hinge'))
    fireEvent.click(screen.getByTestId('opening-inspector-flip-swing'))
    expect(log).toEqual([['hinge'], ['swing']])
  })

  it('names the face on the other side of the host', () => {
    render(<Harness opening={door({ swing: 'right' })} />)
    expect(screen.getByTestId('opening-inspector-swing').textContent).toBe("Opens toward W-3's other side")
  })

  it('offers neither flip to a sliding door, because it has no leaf', () => {
    render(<Harness opening={door({ swing: 'sliding', hingeSide: undefined })} />)
    expect(screen.queryByTestId('opening-inspector-flip-hinge')).toBeNull()
    expect(screen.queryByTestId('opening-inspector-flip-swing')).toBeNull()
    expect(screen.queryByTestId('opening-inspector-swing')).toBeNull()
  })

  it('renames on Enter and on blur, and never on an empty name', () => {
    reset()
    render(<Harness />)
    type('opening-inspector-label', 'Front door')
    expect(log).toEqual([['rename', 'Front door']])
    reset()
    const field = screen.getByTestId('opening-inspector-label')
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.blur(field)
    expect(log).toEqual([])
  })

  it('deletes the Opening and nothing else', () => {
    reset()
    render(<Harness />)
    fireEvent.click(screen.getByTestId('opening-inspector-delete'))
    expect(log).toEqual([['delete']])
  })

  it('names the other side the way the issue writes it', () => {
    expect(swingSentence('left', 'W-3')).toBe('Opens toward this side of W-3')
    expect(swingSentence('right', 'W-3')).toBe("Opens toward W-3's other side")
  })
})
