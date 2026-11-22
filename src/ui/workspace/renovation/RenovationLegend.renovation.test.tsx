/**
 * The legend under the canvas (#70 §4, criterion 9).
 *
 * The words are the issue's, in its order, and the swatch beside each one is the swatch the Display
 * card already wears — the promise this test keeps is that the row says `Demolition (hatch overlay)`
 * next to the hatched mark and not next to something else, because a legend that disagrees with the
 * canvas is worse than no legend.
 *
 * The row's place in the layout is asserted too: it is a row of the shell *below* the body, never a
 * band inside the canvas host, which is what keeps the canvas the height the #55 layout tests pinned.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkspaceShell } from '../WorkspaceShell'
import { RenovationLegend } from './RenovationLegend'

const shell = (
  <WorkspaceShell
    header="h"
    toolbar="t"
    viewCard="v"
    inspector="i"
    canvas={<div data-testid="the-canvas" />}
    railOpen={false}
    renovationLegend={<RenovationLegend />}
  />
)

describe('the legend under the canvas (#70 §4)', () => {
  it('names the three marks in the issue’s words, in its order', () => {
    render(<RenovationLegend />)
    const items = screen.getByTestId('renovation-legend').querySelectorAll('.bb-renovation-legend-item')
    expect([...items].map((item) => item.textContent)).toEqual([
      'Existing',
      'Demolition (hatch overlay)',
      'Proposed (halo overlay)',
    ])
    expect(screen.getByTestId('renovation-legend-note').textContent).toBe(
      'Layer colour is kept underneath renovation graphics',
    )
  })

  it('puts the card’s own swatch beside each name', () => {
    render(<RenovationLegend />)
    const rows = [...screen.getByTestId('renovation-legend').querySelectorAll('.bb-renovation-legend-item')]
    expect(rows.map((row) => row.getAttribute('data-state'))).toEqual(['existing', 'demolition', 'proposed'])
    for (const row of rows) {
      const swatch = row.querySelector('.bb-renovation-swatch')
      expect(swatch?.className).toContain(`bb-renovation-swatch-${row.getAttribute('data-state')}`)
    }
  })

  it('sits below the canvas rather than inside it', () => {
    const { container } = render(shell)
    const body = container.querySelector('.bb-workspace-body')
    const row = container.querySelector('.bb-renovation-legend-row')
    expect(row).not.toBeNull()
    expect(screen.getByTestId('workspace-canvas-host').contains(row)).toBe(false)
    // A row of the shell after the body: the canvas host keeps its own height.
    expect(body?.nextElementSibling).toBe(row)
    expect(row?.contains(screen.getByTestId('renovation-legend'))).toBe(true)
  })

  it('is absent when the slot is not filled', () => {
    const { container } = render(
      <WorkspaceShell header="h" toolbar="t" viewCard="v" inspector="i" canvas="c" railOpen={false} />,
    )
    expect(container.querySelector('.bb-renovation-legend-row')).toBeNull()
  })
})
