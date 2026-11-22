/**
 * The contextual tool strip (#70 §3, criteria 4, 5, 6), under `VITE_FF_RENOVATION=true`.
 *
 * The rows are asserted as a list rather than one by one: criterion 4 is about the set being exactly
 * the table's, and a strip that quietly grows a row in one Display is the failure mode a per-row
 * assertion would miss. The counts are read from the DOM, not from `hiddenToolCount`, because the
 * criterion is that the printed number matches the rows the user can count.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RenovationDisplay } from '../../../domain'
import { RenovationToolStrip } from './RenovationToolStrip'
import type { RenovationToolId } from './toolAvailability'

const ROWS: readonly RenovationToolId[] = ['select', 'markDemolition', 'replace', 'wall', 'opening', 'room', 'placeItem']

const props = (over: Partial<Parameters<typeof RenovationToolStrip>[0]> = {}): Parameters<typeof RenovationToolStrip>[0] => ({
  display: 'combined',
  hasDesignOption: true,
  activeTool: 'select',
  pickStates: [],
  notice: null,
  onTool: vi.fn(),
  onMarkDemolition: vi.fn(),
  onTogglePick: vi.fn(),
  onNotice: vi.fn(),
  ...over,
})

const shownRows = (): RenovationToolId[] => ROWS.filter((tool) => screen.queryByTestId(`renovation-tool-${tool}`) !== null)

const renderStrip = (over: Partial<Parameters<typeof RenovationToolStrip>[0]> = {}): void => {
  render(<RenovationToolStrip {...props(over)} />)
}

describe('the tool strip', () => {
  it('shows exactly the §3 table, and counts what it hides, for every Display', () => {
    const cases: { display: RenovationDisplay; hasDesignOption: boolean; rows: RenovationToolId[]; hidden: number }[] = [
      {
        display: 'existing',
        hasDesignOption: true,
        rows: ['select', 'wall', 'opening', 'room', 'placeItem'],
        hidden: 2,
      },
      { display: 'demolition', hasDesignOption: true, rows: ['select', 'markDemolition', 'replace'], hidden: 4 },
      {
        display: 'proposed',
        hasDesignOption: true,
        rows: ['select', 'wall', 'opening', 'room', 'placeItem'],
        hidden: 2,
      },
      { display: 'combined', hasDesignOption: true, rows: [...ROWS], hidden: 0 },
      // Criterion 9's everyday case: a Project with no Options is still surveyed on the Existing Display.
      {
        display: 'existing',
        hasDesignOption: false,
        rows: ['select', 'wall', 'opening', 'room', 'placeItem'],
        hidden: 2,
      },
      // §6's error state: only Select, and six hidden.
      { display: 'demolition', hasDesignOption: false, rows: ['select'], hidden: 6 },
      { display: 'proposed', hasDesignOption: false, rows: ['select'], hidden: 6 },
      { display: 'combined', hasDesignOption: false, rows: ['select'], hidden: 6 },
    ]
    for (const each of cases) {
      const view = render(
        <RenovationToolStrip
          display={each.display}
          hasDesignOption={each.hasDesignOption}
          activeTool="select"
          pickStates={[]}
          notice={null}
          onTool={vi.fn()}
          onMarkDemolition={vi.fn()}
          onTogglePick={vi.fn()}
          onNotice={vi.fn()}
        />,
      )
      const label = `${each.display}${each.hasDesignOption ? '' : ' without an Option'}`
      expect(shownRows(), label).toEqual(each.rows)
      const count = screen.queryByTestId('hidden-tool-count')
      if (each.hidden === 0) expect(count, label).toBeNull()
      else expect(count?.textContent, label).toBe(`${each.hidden} tools hidden in this display`)
      view.unmount()
    }
  })

  it('puts the `Pick:` chips at the strip’s right end', () => {
    renderStrip()
    const strip = screen.getByTestId('renovation-tool-strip')
    expect(strip.lastElementChild).toBe(screen.getByTestId('pick-filter'))
    expect(screen.getByText('Pick:')).toBeInTheDocument()
    for (const state of ['existing', 'demolition', 'proposed']) {
      expect(screen.getByTestId(`pick-${state}`)).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it('reports a chip pressed only while the filter holds it', () => {
    const onTogglePick = vi.fn()
    renderStrip({ pickStates: ['demolition'], onTogglePick })
    expect(screen.getByTestId('pick-demolition')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('pick-existing')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByTestId('pick-existing'))
    expect(onTogglePick).toHaveBeenCalledWith('existing')
  })

  it('drops back to Select when the Display forbids the tool in hand', () => {
    const onTool = vi.fn()
    renderStrip({ display: 'demolition', activeTool: 'wall', onTool })
    expect(onTool).toHaveBeenCalledWith('select')
  })

  it('leaves Pan alone: it moves the camera and writes nothing', () => {
    const onTool = vi.fn()
    renderStrip({ display: 'demolition', activeTool: 'pan', onTool })
    expect(onTool).not.toHaveBeenCalled()
  })

  it('says which Displays a hidden tool works in, and changes nothing', () => {
    const onTool = vi.fn()
    const onNotice = vi.fn()
    renderStrip({ display: 'existing', onTool, onNotice })
    fireEvent.keyDown(window, { key: 'd' })
    expect(onNotice).toHaveBeenCalledWith('Mark demolition works in Demolition / Combined display')
    expect(onTool).not.toHaveBeenCalled()
  })

  it('runs the shortcut of a tool the Display allows', () => {
    const onTool = vi.fn()
    const onNotice = vi.fn()
    renderStrip({ display: 'combined', onTool, onNotice })
    fireEvent.keyDown(window, { key: 'w' })
    expect(onTool).toHaveBeenCalledWith('wall')
    expect(onNotice).toHaveBeenCalledWith(null)
  })

  it('prints the reason a shown row cannot run, instead of doing nothing silently', () => {
    const onNotice = vi.fn()
    renderStrip({ display: 'combined', onNotice })
    fireEvent.keyDown(window, { key: 'r' })
    expect(onNotice).toHaveBeenCalledWith(
      'Replace… needs the dialog that asks what takes this one’s place, which is not in this build.',
    )
  })

  it('marks demolition through the #69 review seam when one thing is named', () => {
    const onMarkDemolition = vi.fn()
    renderStrip({ display: 'combined', blocked: {}, onMarkDemolition })
    fireEvent.click(screen.getByTestId('renovation-tool-markDemolition'))
    expect(onMarkDemolition).toHaveBeenCalled()
  })

  it('disables `Mark demolition` and says it needs one selection', () => {
    renderStrip({ display: 'combined', blocked: { markDemolition: 'Select one thing to mark for demolition.' } })
    const button = screen.getByTestId('renovation-tool-markDemolition')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Select one thing to mark for demolition.')
  })
})
