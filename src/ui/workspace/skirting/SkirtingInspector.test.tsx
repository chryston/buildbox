// The Skirting inspector (#78 §4): the seven fields in the issue's order, the two lengths printed
// rather than typed, `Bottom` and `Height` answering for different things, and the two side buttons.
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { ComponentProps } from 'react'
import type { DerivedSkirting } from '../../../derive'
import type { Skirting } from '../../../domain'
import { SkirtingInspector } from './SkirtingInspector'

const skirting: Skirting = {
  id: 'skirting-1',
  floorId: 'floor-1',
  hostWallId: 'wall-a',
  side: 'left',
  start: 120,
  end: 3480,
  bottom: 0,
  height: 100,
  thickness: 15,
  label: 'Skirting SK-1',
}

const derived = (over: Partial<DerivedSkirting> = {}): DerivedSkirting => ({
  id: 'skirting-1',
  label: 'Skirting SK-1',
  hostWallId: 'wall-a',
  side: 'left',
  start: 120,
  end: 3480,
  bottom: 0,
  top: 100,
  thickness: 15,
  innerOffset: 100,
  outerOffset: 115,
  grossLength: 3360,
  netLength: 2985,
  gaps: [],
  runs: [],
  ...over,
})

function inspector(over: Partial<ComponentProps<typeof SkirtingInspector>> = {}) {
  const sent: string[] = []
  const call = (name: string) => (): void => {
    sent.push(name)
  }
  render(
    <SkirtingInspector
      skirting={skirting}
      derived={derived()}
      hostRef="W-1"
      sideName="Kitchen side"
      unit="mm"
      precision={0}
      onSelectHost={call('host')}
      onSetLabel={call('label')}
      onSetStart={call('start')}
      onSetEnd={call('end')}
      onSetBottom={call('bottom')}
      onSetHeight={call('height')}
      onSetThickness={call('thickness')}
      onFlipSide={call('flip')}
      onDuplicateOtherSide={call('duplicate')}
      onDelete={call('delete')}
      {...over}
    />,
  )
  return sent
}

afterEach(cleanup)

describe('the Skirting inspector', () => {
  it('prints the host, the side by its Room name, and both lengths', () => {
    inspector()
    expect(screen.getByTestId('skirting-field-wall')).toHaveTextContent('W-1')
    expect(screen.getByTestId('skirting-field-side')).toHaveTextContent('Kitchen side')
    expect(screen.getByTestId('skirting-field-side')).not.toHaveTextContent('left')
    expect(screen.getByTestId('skirting-field-gross')).toHaveTextContent('3,360 mm')
    expect(screen.getByTestId('skirting-field-net')).toHaveTextContent('2,985 mm')
    expect(screen.getByTestId('skirting-field-top')).toHaveTextContent('100 mm')
  })

  it('says the lengths have no answer when the host Wall does not stand', () => {
    inspector({ derived: null })
    expect(screen.getByTestId('skirting-field-gross')).toHaveTextContent('3,360 mm')
    expect(screen.getByTestId('skirting-field-net')).toHaveTextContent('—')
  })

  it('shows the stored range and the three measurements', () => {
    inspector()
    expect(screen.getByTestId('skirting-field-start')).toHaveValue(120)
    expect(screen.getByTestId('skirting-field-end')).toHaveValue(3480)
    expect(screen.getByTestId('skirting-field-bottom')).toHaveValue(0)
    expect(screen.getByTestId('skirting-field-height')).toHaveValue(100)
    expect(screen.getByTestId('skirting-field-thickness')).toHaveValue(15)
  })

  it('sends one Intent per committed field, and none for an unparseable box', async () => {
    const user = userEvent.setup()
    const sent = inspector()
    await user.clear(screen.getByTestId('skirting-field-start'))
    await user.type(screen.getByTestId('skirting-field-start'), '250')
    await user.tab()
    expect(sent).toEqual(['start'])
    fireEvent.blur(screen.getByTestId('skirting-field-end'), { target: { value: 'not a number' } })
    expect(sent).toEqual(['start'])
  })

  it('names the host Wall a click on the Wall field', () => {
    const sent = inspector()
    fireEvent.click(screen.getByTestId('skirting-field-wall'))
    expect(sent).toEqual(['host'])
  })

  it('flips the side and duplicates to the other side as separate commands', () => {
    const sent = inspector()
    fireEvent.click(screen.getByTestId('skirting-flip-side'))
    fireEvent.click(screen.getByTestId('skirting-duplicate-other-side'))
    fireEvent.click(screen.getByTestId('skirting-delete'))
    expect(sent).toEqual(['flip', 'duplicate', 'delete'])
  })

  it('renames on blur only when the name changed', async () => {
    const user = userEvent.setup()
    const sent = inspector()
    await user.click(screen.getByTestId('skirting-field-label'))
    await user.tab()
    expect(sent).toEqual([])
    await user.type(screen.getByTestId('skirting-field-label'), ' (north)')
    await user.tab()
    expect(sent).toEqual(['label'])
  })
})
