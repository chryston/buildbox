/**
 * The mode bar (#70 §3, criterion 3).
 *
 * The four sentences are quoted in full rather than matched loosely: they are the issue's exact
 * words, they are the only place a person learns that the same keystroke means a correction in one
 * Display and a Design Option's own work in another, and a silent rewording is the kind of change
 * that passes every other test in the file.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { RenovationDisplay } from '../../../domain'
import { RenovationModeBar } from './RenovationModeBar'

/** The issue's §3 sentences, verbatim. */
const SENTENCES: { [D in RenovationDisplay]: string } = {
  existing: 'Surveying the shared baseline. Changes here are explicit corrections seen by every option.',
  demolition: 'Marking what the option removes or replaces.',
  proposed: 'Editing new work owned by the option. Demolished baseline is hidden.',
  combined: 'Everything together. All state-aware tools; overlaps cycle on repeated click.',
}

const NAMES: { [D in RenovationDisplay]: string } = {
  existing: 'Existing',
  demolition: 'Demolition',
  proposed: 'Proposed',
  combined: 'Combined',
}

describe('the mode bar', () => {
  for (const display of ['existing', 'demolition', 'proposed', 'combined'] as const) {
    it(`says what editing means in ${NAMES[display]} display, in the issue's words`, () => {
      render(<RenovationModeBar display={display} optionName="Option A · Open kitchen" />)
      expect(screen.getByTestId('mode-bar-display')).toHaveTextContent(NAMES[display])
      expect(screen.getByTestId('mode-bar-note').textContent).toBe(SENTENCES[display])
    })

    it(`wears the ${NAMES[display]} colour role`, () => {
      render(<RenovationModeBar display={display} optionName={null} />)
      const bar = screen.getByTestId('renovation-mode-bar')
      expect(bar.getAttribute('style')).toContain(`--bb-renovation-${display}-border`)
      expect(bar.getAttribute('style')).toContain(`--bb-renovation-${display}-tint`)
      // A 3px bottom border, as §3 asks for.
      expect(bar.getAttribute('style')).toContain('3px solid')
    })
  }

  it('names the Design Option the Display is looking through', () => {
    render(<RenovationModeBar display="combined" optionName="Option B · Widened opening" />)
    expect(screen.getByTestId('mode-bar-option')).toHaveTextContent('Option B · Widened opening')
  })

  it('says `No Design Option` rather than leaving the place empty', () => {
    render(<RenovationModeBar display="demolition" optionName={null} />)
    expect(screen.getByTestId('mode-bar-option')).toHaveTextContent('No Design Option')
  })
})
