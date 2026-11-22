/**
 * The `Pick:` filter's home (#70 §3, criterion 5), under `VITE_FF_RENOVATION=true`.
 *
 * The filter decides which Renovation States a click may take, which makes it a question about the
 * screen rather than about the building. So the tests are about where it is *not*: the Project
 * document — and with it every Backup, which is a serialization of that same document — must not
 * change when it is set, and it must not survive a move to another saved view.
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Project } from '../../domain'
import { workspaceStore } from './workspaceStore'

const fixture = (): Project => {
  const raw = JSON.parse(readFileSync(new URL('../../../fixtures/e2e/preview-seed/renovation-36.json', import.meta.url), 'utf8')) as {
    projects: { data: Project }[]
  }
  return structuredClone(raw.projects[0].data)
}

const state = (): string => JSON.stringify(workspaceStore.getState().pickStates)

const notice = (): string | null => workspaceStore.getState().hiddenToolNotice

const FLOOR = fixture().floors[0].id

describe('the Pick: filter', () => {
  beforeEach(() => {
    workspaceStore.getState().reset()
  })

  it('starts with every state allowed', () => {
    expect(state()).toBe('[]')
  })

  it('holds the states in their own order, whatever the order of clicks', () => {
    workspaceStore.getState().togglePickState('proposed')
    workspaceStore.getState().togglePickState('demolition')
    expect(state()).toBe('["demolition","proposed"]')
    workspaceStore.getState().togglePickState('demolition')
    expect(state()).toBe('["proposed"]')
  })

  it('resets when the saved view changes', () => {
    const project = fixture()
    const view = project.views.find((each) => each.floorId === FLOOR)
    if (view === undefined) throw new Error('the fixture has no saved view on its first Floor')
    workspaceStore.getState().setActiveFloor(FLOOR, view.id)
    workspaceStore.getState().togglePickState('existing')
    workspaceStore.getState().showHiddenToolNotice('Mark demolition works in Demolition / Combined display')
    expect(state()).toBe('["existing"]')
    // The store keys the open view by id and never reads the Project, so any other id is another view.
    workspaceStore.getState().setActiveView(FLOOR, 'another-view')
    expect(state()).toBe('[]')
    expect(notice()).toBeNull()
  })

  it('resets when another Floor opens', () => {
    workspaceStore.getState().togglePickState('demolition')
    workspaceStore.getState().showHiddenToolNotice('something')
    const other = fixture().floors[1] ?? fixture().floors[0]
    workspaceStore.getState().setActiveFloor(other.id, other.id)
    expect(state()).toBe('[]')
    expect(notice()).toBeNull()
  })

  it('is gone when another Project opens', () => {
    workspaceStore.getState().togglePickState('proposed')
    workspaceStore.getState().reset()
    expect(state()).toBe('[]')
    expect(notice()).toBeNull()
  })

  it('never reaches the Project document, and so never reaches a Backup', () => {
    const project = fixture()
    const before = JSON.stringify(project)
    workspaceStore.getState().togglePickState('demolition')
    workspaceStore.getState().showHiddenToolNotice('Mark demolition works in Demolition / Combined display')
    expect(JSON.stringify(project)).toBe(before)
    // A Backup is a serialization of this document, so a filter that never enters it can never be
    // carried by one. The names below are the only ones this feature could have used.
    expect(before).not.toMatch(/pickStates|hiddenToolNotice|pickFilter/)
  })
})
