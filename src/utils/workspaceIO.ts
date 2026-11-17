import type { Design } from '../types'

/**
 * What the Export Workspace modal writes. Reading is the frozen legacy reader's job
 * (`src/package`, #40 §2); this stays until the S4 cutover replaces the export format.
 */
export interface WorkspaceFile {
  version: number
  exportedAt: string
  projects: Design[]
  activeProjectId: string | null
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
