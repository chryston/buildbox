/**
 * The tab's clipboard (#72 criterion 11).
 *
 * Criterion 11 is three claims about a thing deliberately not stored anywhere: a copy outlives
 * walking back to the Library and opening another Project, a reload ends it, and it is offered only
 * somewhere else. The first is checked against the real `workspaceStore.reset()` a Project switch
 * runs, the second by importing the module again as a fresh one — which is what a reload is to a
 * module singleton. That a copy leaves its source untouched is the capture's own promise and is
 * proved where the capture lives (`edit/paste.renovation.test.ts`); what lives here is the holding.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityId } from '../../domain'
import type { CopySet } from '../../edit'
import { canPasteHere, pasteClipboardStore } from './pasteClipboard'
import { workspaceStore } from './workspaceStore'

/** A copy from one Project: the clipboard never reads past its `sourceProjectId`. */
const copyFrom = (sourceProjectId: EntityId, sourceProjectName: string): CopySet => ({
  sourceProjectId,
  sourceProjectName,
  entities: { walls: [], wallJunctions: [], openings: [], rooms: [], beams: [], placedItems: [] },
  itemDesigns: [],
  layers: [],
  demolishedCount: 0,
  notes: [],
  annotations: [],
})

const FITOUT = copyFrom('project-fitout', 'Unit 4 Fitout')

beforeEach(() => {
  pasteClipboardStore.getState().clear()
})

describe('holding a copy (#72 criterion 11)', () => {
  it('holds what was copied, and which Project it came from', () => {
    pasteClipboardStore.getState().hold(FITOUT)
    expect(pasteClipboardStore.getState().copy).toEqual(FITOUT)
    expect(pasteClipboardStore.getState().sourceProjectId).toBe('project-fitout')
  })

  it('keeps the copy when the workspace is reset for another Project', () => {
    pasteClipboardStore.getState().hold(FITOUT)
    // What opening another Project does to the workspace: tool, selection, notices, viewports — all
    // of it gone. The clipboard is not in that snapshot precisely so this line keeps working.
    workspaceStore.getState().reset()

    expect(pasteClipboardStore.getState().copy).toEqual(FITOUT)
    expect(canPasteHere(pasteClipboardStore.getState(), 'project-elm-st')).toBe(true)
  })

  it('holds one copy, not a stack', () => {
    pasteClipboardStore.getState().hold(FITOUT)
    pasteClipboardStore.getState().hold(copyFrom('project-elm-st', '14 Elm St'))
    expect(pasteClipboardStore.getState().copy?.sourceProjectId).toBe('project-elm-st')
  })

  it('is empty again after a reload', async () => {
    pasteClipboardStore.getState().hold(FITOUT)
    // Nothing writes this to storage, so a reload is a fresh module with nothing in it. A static
    // import cannot show that: the module under test is already evaluated in this file, and only a
    // re-import after `resetModules` is the new instance a reload would build.
    vi.resetModules()
    const reloaded = await import('./pasteClipboard')
    expect(reloaded.pasteClipboardStore.getState().copy).toBeNull()
    expect(reloaded.pasteClipboardStore.getState().sourceProjectId).toBeNull()
  })
})

describe('offering the copy somewhere (#72 criterion 12)', () => {
  it('offers it only into a different Project', () => {
    expect(canPasteHere({ copy: FITOUT, sourceProjectId: FITOUT.sourceProjectId }, 'project-fitout')).toBe(false)
    expect(canPasteHere({ copy: FITOUT, sourceProjectId: FITOUT.sourceProjectId }, 'project-elm-st')).toBe(true)
  })

  it('offers nothing while the clipboard is empty', () => {
    expect(canPasteHere({ copy: null, sourceProjectId: null }, 'project-elm-st')).toBe(false)
  })
})
