import type { Design, GlobalSettings, CabinetNode } from '../types'

export interface WorkspaceFile {
  version: number
  exportedAt: string
  projects: Design[]
  activeProjectId: string | null
}

export class WorkspaceImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceImportError'
  }
}

function migrateDesign(raw: unknown): Design {
  const r = raw as Record<string, unknown>
  // v0: has root/globalSettings at top level, no units array
  if (!r.units && r.root && r.globalSettings) {
    const settings = r.globalSettings as GlobalSettings
    const unitId = crypto.randomUUID()
    return {
      ...r,
      units: [{
        type: 'cabinet',
        id: unitId,
        label: 'Unit 1',
        x: 0,
        y: 0,
        settings,
        root: r.root as CabinetNode,
      }],
    } as Design
  }
  return raw as Design
}

export function exportWorkspace(projects: Design[], activeProjectId: string | null): string {
  const file: WorkspaceFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    projects,
    activeProjectId,
  }
  return JSON.stringify(file, null, 2)
}

export function importWorkspace(json: string): WorkspaceFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new WorkspaceImportError('Invalid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new WorkspaceImportError('Expected an object')
  }
  const file = parsed as Record<string, unknown>
  if (!Array.isArray(file.projects)) {
    throw new WorkspaceImportError('Missing or invalid "projects" field')
  }
  const migratedProjects = file.projects.map(migrateDesign)
  return {
    version: typeof file.version === 'number' ? file.version : 1,
    exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : '',
    projects: migratedProjects,
    activeProjectId: typeof file.activeProjectId === 'string' ? file.activeProjectId : null,
  }
}
