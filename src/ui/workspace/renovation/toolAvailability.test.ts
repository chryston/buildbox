/**
 * The contextual tool strip's table (#70 §3, criterion 4). The counts are the acceptance test: they
 * are what the strip prints, and they come out of the rows rather than being written down twice.
 */
import { describe, expect, it } from 'vitest'
import type { RenovationDisplay } from '../../../domain'
import { RENOVATION_TOOL_ROWS, availableTools, displaysAllowing, hiddenToolCount, toolIsAvailable } from './toolAvailability'

const displays: RenovationDisplay[] = ['existing', 'demolition', 'proposed', 'combined']

describe('the tool table of #70 §3', () => {
  it('hides the number of tools each Display says it hides', () => {
    expect(hiddenToolCount('existing', true)).toBe(2)
    expect(hiddenToolCount('demolition', true)).toBe(6)
    expect(hiddenToolCount('proposed', true)).toBe(2)
    expect(hiddenToolCount('combined', true)).toBe(0)
    // §6: Demolition, Proposed or Combined with no Design Option — everything but looking is hidden.
    // Eight with the Service row in the table: it needs an Option like every tool that owns new
    // work, so the error state hides it too. The two rows that are never among the hidden are the
    // ones that own nothing — an Elevation View is a way of looking (#75 §3), and Select needs
    // nothing.
    expect(hiddenToolCount('demolition', false)).toBe(8)
    expect(hiddenToolCount('proposed', false)).toBe(8)
    expect(hiddenToolCount('combined', false)).toBe(8)
    // The Existing Display never needs an Option: the shared baseline is always there to survey.
    expect(hiddenToolCount('existing', false)).toBe(2)
  })

  it('shows Select in every column, and only Select and the view tool in the error state', () => {
    for (const display of displays) expect(toolIsAvailable('select', display, true)).toBe(true)
    // §6: Demolition, Proposed or Combined with no Option — nothing can be owned, so nothing that
    // owns anything is offered. An Elevation View owns nothing: it saves a way of looking, so the
    // error state is still a state you can draw a view from. The Existing Display is the other
    // exception: a Project with no Options at all is still drawn and edited on it, exactly as it was
    // before any of this existed.
    for (const display of ['demolition', 'proposed', 'combined'] as const)
      expect(availableTools(display, false)).toEqual(['select', 'elevation', 'comment', 'annotationText', 'annotationLeader', 'annotationArrow', 'annotationCloud', 'annotationMarker'])
    expect(availableTools('existing', false)).toEqual(['select', 'wall', 'opening', 'skirting', 'service', 'room', 'placeItem', 'elevation', 'comment', 'annotationText', 'annotationLeader', 'annotationArrow', 'annotationCloud', 'annotationMarker'])
  })

  it('offers the Comment tool everywhere, including the error state (#80 §9)', () => {
    // A Comment writes no geometry and no Design Option owns it, so the row is never hidden — not by
    // the Display, and not by a missing Option. The hidden counts above are unchanged by its presence.
    for (const display of displays) {
      expect(toolIsAvailable('comment', display, true)).toBe(true)
      expect(toolIsAvailable('comment', display, false)).toBe(true)
    }
    expect(displaysAllowing('comment')).toEqual(displays)
  })

  it('puts the renovation tools in Demolition and Combined only', () => {
    for (const tool of ['markDemolition', 'replace'] as const) {
      expect(displaysAllowing(tool)).toEqual(['demolition', 'combined'])
      expect(toolIsAvailable(tool, 'existing', true)).toBe(false)
      expect(toolIsAvailable(tool, 'proposed', true)).toBe(false)
      expect(toolIsAvailable(tool, 'combined', true)).toBe(true)
      // The Display is right and the Option is missing: still hidden, because there is nothing to
      // own the demolition record or the replacement.
      expect(toolIsAvailable(tool, 'combined', false)).toBe(false)
    }
  })

  it('keeps the shape tools for surveying and for new work, and off the Demolition Display', () => {
    for (const tool of ['wall', 'opening', 'skirting', 'room', 'placeItem'] as const) {
      expect(displaysAllowing(tool)).toEqual(['existing', 'proposed', 'combined'])
      expect(toolIsAvailable(tool, 'demolition', true)).toBe(false)
      expect(toolIsAvailable(tool, 'existing', true)).toBe(true)
      expect(toolIsAvailable(tool, 'existing', false)).toBe(true)
      expect(toolIsAvailable(tool, 'proposed', false)).toBe(false)
    }
  })

  it('offers the five Annotation tools everywhere, including the error state (#81 §3.1)', () => {
    // An Annotation writes no geometry and no Design Option owns it — the Comment row's answer,
    // given five times over. The rows are never hidden by the Display and never by a missing
    // Option; the Notes overlay gates them, and that gate is not the table's business (#81 §3.2).
    for (const tool of ['annotationText', 'annotationLeader', 'annotationArrow', 'annotationCloud', 'annotationMarker'] as const) {
      for (const display of displays) {
        expect(toolIsAvailable(tool, display, true)).toBe(true)
        expect(toolIsAvailable(tool, display, false)).toBe(true)
      }
      expect(displaysAllowing(tool)).toEqual(displays)
    }
  })

  it('is one row per tool, each reachable somewhere — so #81 adds a row and nothing else', () => {
    expect(RENOVATION_TOOL_ROWS).toHaveLength(16)
    for (const row of RENOVATION_TOOL_ROWS) {
      expect(row.allowedIn.length).toBeGreaterThan(0)
      expect(displaysAllowing(row.id)).toEqual(row.allowedIn)
    }
    // Every tool the table names is available in at least one Display, or it is a dead row.
    const reachable = new Set(displays.flatMap((display) => availableTools(display, true)))
    expect([...reachable].sort()).toEqual(RENOVATION_TOOL_ROWS.map((row) => row.id).sort())
  })
})
