/**
 * The Elevation View definition block, as the saved-view card draws it (#75 §3, criterion 3):
 * six controls, one Edit Transaction per committed change, and a refusal that says so under the
 * box instead of sending anything.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ElevationView } from '../../domain'
import { STRINGS } from '../strings'
import { formatMm, parseToMm } from './displayUnits'
import { FieldsLockedContext } from './fieldsLock'
import type { FieldsLock } from './fieldsLock'
import {
  ElevationDefinitionSection,
  elevationDepthProblem,
  elevationLineProblem,
  elevationNameProblem,
} from './ElevationDefinitionSection'
import type { ElevationDefinitionSectionProps } from './ElevationDefinitionSection'

/** A view standing on a 4 m line along the plan's x axis, 3 m deep, on the line's left side. */
const VIEW: ElevationView = {
  id: 'elev-1',
  kind: 'elevation',
  floorId: 'floor-1',
  name: 'Elevation 1',
  line: { start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } },
  side: 'left',
  depth: 3000,
}

const open = (over: Partial<ElevationDefinitionSectionProps> = {}) => {
  const onCommit = vi.fn()
  render(
    <ElevationDefinitionSection
      view={VIEW}
      nameTaken={() => false}
      unit="mm"
      precision={0}
      onCommit={onCommit}
      {...over}
    />,
  )
  return { onCommit }
}

/** What a box holds before anything is sent. */
const held = (testId: string): string => (screen.getByTestId(testId) as HTMLInputElement).value

describe('the block', () => {
  it('shows all six controls wearing the view’s own numbers', () => {
    open()
    expect(screen.getByTestId('elevation-definition-title').textContent).toBe(STRINGS.elevationView)
    expect(held('elevation-name-field')).toBe('Elevation 1')
    expect(held('elevation-depth-field')).toBe(formatMm(3000, 'mm', 0))
    expect(held('elevation-line-start-x')).toBe(formatMm(0, 'mm', 0))
    expect(held('elevation-line-start-y')).toBe(formatMm(0, 'mm', 0))
    expect(held('elevation-line-end-x')).toBe(formatMm(4000, 'mm', 0))
    expect(held('elevation-line-end-y')).toBe(formatMm(0, 'mm', 0))
    expect(screen.getByTestId('elevation-flip-side')).toBeTruthy()
  })
})

describe('the name', () => {
  it('commits once on Enter and never on the keystrokes', () => {
    const { onCommit } = open()
    const box = screen.getByTestId('elevation-name-field')
    fireEvent.change(box, { target: { value: 'Front wall' } })
    fireEvent.change(box, { target: { value: 'Front wall 2' } })
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith({ name: 'Front wall 2' })
  })

  it('commits on blur', () => {
    const { onCommit } = open()
    const box = screen.getByTestId('elevation-name-field')
    fireEvent.change(box, { target: { value: 'Garden side' } })
    fireEvent.blur(box)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith({ name: 'Garden side' })
  })

  it('refuses a name the Floor already has, case-insensitively, and sends nothing', () => {
    const { onCommit } = open({ nameTaken: (name) => name.toLowerCase() === 'front wall' })
    const box = screen.getByTestId('elevation-name-field')
    fireEvent.change(box, { target: { value: 'Front Wall' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(STRINGS.elevationNameTaken('Front Wall'))
    // The box keeps the word so the person can fix it.
    expect(held('elevation-name-field')).toBe('Front Wall')
  })

  it('refuses a blank name and sends nothing', () => {
    const { onCommit } = open()
    const box = screen.getByTestId('elevation-name-field')
    fireEvent.change(box, { target: { value: '   ' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(STRINGS.elevationNameRequired)
  })
})

describe('the direction', () => {
  it('flips the side in one commit', () => {
    const { onCommit } = open()
    fireEvent.click(screen.getByTestId('elevation-flip-side'))
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith({ side: 'right' })
  })
})

describe('the depth', () => {
  it('commits millimetres typed in the Project’s metres', () => {
    const { onCommit } = open({ unit: 'm', precision: 3 })
    expect(held('elevation-depth-field')).toBe(formatMm(3000, 'm', 3))
    const box = screen.getByTestId('elevation-depth-field')
    fireEvent.change(box, { target: { value: '2.16' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith({ depth: parseToMm(2.16, 'm') })
    expect(parseToMm(2.16, 'm')).toBe(2160)
  })

  it('refuses a depth of zero and sends nothing', () => {
    const { onCommit } = open()
    const box = screen.getByTestId('elevation-depth-field')
    fireEvent.change(box, { target: { value: '0' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByTestId('elevation-depth-field-error').textContent).toBe(STRINGS.elevationDepthProblem)
  })
})

describe('the line', () => {
  it('edits one coordinate and commits the whole line once, the other three unchanged', () => {
    const { onCommit } = open()
    const box = screen.getByTestId('elevation-line-start-x')
    fireEvent.change(box, { target: { value: '1200' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith({
      line: { start: { x: 1200, y: 0 }, end: { x: 4000, y: 0 } },
    })
  })

  it('refuses a line dragged onto its other end and sends nothing', () => {
    const { onCommit } = open()
    const box = screen.getByTestId('elevation-line-start-x')
    fireEvent.change(box, { target: { value: '4000' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByTestId('elevation-line-start-x-error').textContent).toBe(STRINGS.elevationLineProblem)
  })
})

describe('the lock', () => {
  const lockedOpen = (lock: FieldsLock) => {
    const onCommit = vi.fn()
    render(
      <FieldsLockedContext.Provider value={lock}>
        <ElevationDefinitionSection
          view={VIEW}
          nameTaken={() => false}
          unit="mm"
          precision={0}
          onCommit={onCommit}
        />
      </FieldsLockedContext.Provider>,
    )
    return { onCommit }
  }

  it('shuts every box and commits nothing', () => {
    const { onCommit } = lockedOpen({ locked: true, notice: 'Shared by every Option.' })
    for (const testId of [
      'elevation-name-field',
      'elevation-depth-field',
      'elevation-line-start-x',
      'elevation-line-start-y',
      'elevation-line-end-x',
      'elevation-line-end-y',
    ]) {
      expect((screen.getByTestId(testId) as HTMLInputElement).disabled).toBe(true)
    }
    expect((screen.getByTestId('elevation-flip-side') as HTMLButtonElement).disabled).toBe(true)
    // jsdom dispatches events onto disabled inputs the way a browser never would; the commit paths
    // honour the lock themselves, so even this sends nothing.
    const box = screen.getByTestId('elevation-name-field')
    fireEvent.change(box, { target: { value: 'Renamed anyway' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.blur(box)
    fireEvent.click(screen.getByTestId('elevation-flip-side'))
    expect(onCommit).not.toHaveBeenCalled()
  })
})

describe('the helpers', () => {
  it('say the three sentences and nothing else', () => {
    expect(elevationNameProblem(() => false, '  ')).toBe(STRINGS.elevationNameRequired)
    expect(elevationNameProblem(() => true, 'Front wall')).toBe(STRINGS.elevationNameTaken('Front wall'))
    expect(elevationNameProblem(() => false, 'Front wall')).toBeNull()
    expect(elevationDepthProblem(0)).toBe(STRINGS.elevationDepthProblem)
    expect(elevationDepthProblem(-5)).toBe(STRINGS.elevationDepthProblem)
    expect(elevationDepthProblem(1)).toBeNull()
    expect(elevationLineProblem({ start: { x: 4000, y: 0 }, end: { x: 4000, y: 0 } }))
      .toBe(STRINGS.elevationLineProblem)
    expect(elevationLineProblem({ start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } })).toBeNull()
  })
})
