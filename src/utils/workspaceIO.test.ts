import { describe, expect, it } from 'vitest'
import { exportWorkspace, importWorkspace, WorkspaceImportError } from './workspaceIO'
import type { Design } from '../types'

function makeDesign(overrides: Partial<Design> = {}): Design {
  return {
    id: 'test-id',
    name: 'Test Cabinet',
    units: [{
      type: 'cabinet',
      id: 'unit-1',
      label: 'Unit 1',
      x: 0,
      y: 0,
      settings: {
        unit: 'mm', height: 800, width: 600, depth: 500,
        thickness: 18, backThickness: 6, toeKick: null, material: 'oak',
      },
      root: { id: 'root', elementType: 'void', accessories: [] },
    }],
    ...overrides,
  }
}

describe('exportWorkspace', () => {
  it('serializes projects with version 1 and exportedAt', () => {
    const json = exportWorkspace([makeDesign()], 'test-id')
    const parsed = JSON.parse(json)
    expect(parsed.version).toBe(1)
    expect(parsed.exportedAt).toBeTruthy()
    expect(parsed.projects).toHaveLength(1)
    expect(parsed.activeProjectId).toBe('test-id')
  })

  it('serializes multiple projects', () => {
    const json = exportWorkspace([makeDesign({ id: 'a' }), makeDesign({ id: 'b' })], 'a')
    const parsed = JSON.parse(json)
    expect(parsed.projects).toHaveLength(2)
  })
})

describe('importWorkspace', () => {
  it('round-trips: export then import returns same projects', () => {
    const projects = [makeDesign()]
    const json = exportWorkspace(projects, 'test-id')
    const result = importWorkspace(json)
    expect(result.projects).toEqual(projects)
    expect(result.activeProjectId).toBe('test-id')
  })

  it('migrates v0 design (root/globalSettings) to v1 (units[])', () => {
    const v0Project = {
      id: 'v0-id',
      name: 'Old Cabinet',
      globalSettings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, material: 'oak' },
      root: { id: 'r1', elementType: 'void', accessories: [] },
    }
    const json = JSON.stringify({ version: 0, exportedAt: '', projects: [v0Project], activeProjectId: 'v0-id' })
    const result = importWorkspace(json)
    expect(result.projects[0].units).toHaveLength(1)
    expect(result.projects[0].units[0].type).toBe('cabinet')
    expect(result.projects[0].units[0].settings.height).toBe(800)
    expect(result.projects[0].units[0].root).toEqual(v0Project.root)
  })

  it('throws WorkspaceImportError on empty string', () => {
    expect(() => importWorkspace('')).toThrow(WorkspaceImportError)
  })

  it('throws WorkspaceImportError on missing projects field', () => {
    expect(() => importWorkspace(JSON.stringify({ version: 1 }))).toThrow(WorkspaceImportError)
  })

  it('throws WorkspaceImportError when projects is not an array', () => {
    expect(() => importWorkspace(JSON.stringify({ version: 1, projects: 'bad' }))).toThrow(WorkspaceImportError)
  })
})
