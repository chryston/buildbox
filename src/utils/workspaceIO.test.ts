import { describe, expect, it } from 'vitest'
import { exportWorkspace } from './workspaceIO'
import { readLegacyWorkspaceFile } from '../package'
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
    const json = exportWorkspace([makeDesign()], 'test-id', '2026-11-17T09:00:00.000Z')
    const parsed = JSON.parse(json)
    expect(parsed.version).toBe(1)
    expect(parsed.exportedAt).toBe('2026-11-17T09:00:00.000Z')
    expect(parsed.projects).toHaveLength(1)
    expect(parsed.activeProjectId).toBe('test-id')
  })

  it('serializes multiple projects', () => {
    const json = exportWorkspace([makeDesign({ id: 'a' }), makeDesign({ id: 'b' })], 'a', '2026-11-17T09:00:00.000Z')
    const parsed = JSON.parse(json)
    expect(parsed.projects).toHaveLength(2)
  })

  // The import half of this pair lives in src/package/legacy/read.test.ts; `package` may
  // not import `utils`, so the round trip is written from this side of the boundary.
  it('round-trips through the legacy reader', () => {
    const projects = [makeDesign(), makeDesign({ id: 'other', name: 'Other' })]
    const read = readLegacyWorkspaceFile(
      exportWorkspace(projects, 'test-id', '2026-11-17T09:00:00.000Z'),
      () => 'unused-id',
    )
    expect(read.ok ? read.file.projects : read.problems).toEqual(projects)
    expect(read.ok && read.file.activeProjectId).toBe('test-id')
  })
})
