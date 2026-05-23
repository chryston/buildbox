import type { Design } from '../../types'
import { exportWorkspace } from '../../utils/workspaceIO'

interface Props {
  projects: Design[]
  activeProjectId: string | null
  onClose: () => void
}

function triggerDownload(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

export default function ExportModal({ projects, activeProjectId, onClose }: Props) {
  function handleExportActive(): void {
    const active = projects.find((p) => p.id === activeProjectId)
    if (!active) return
    const json = exportWorkspace([active], activeProjectId)
    triggerDownload(json, `${active.name.replace(/\s+/g, '-').toLowerCase()}.buildbox.json`)
    onClose()
  }

  function handleExportAll(): void {
    const json = exportWorkspace(projects, activeProjectId)
    triggerDownload(json, 'buildbox-workspace.buildbox.json')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-72 rounded-lg bg-panel p-4 shadow-xl">
        <h2 className="mb-3 text-sm font-semibold text-white">Export Workspace</h2>
        <div className="flex flex-col gap-2">
          <button
            onClick={handleExportActive}
            className="rounded bg-accent px-3 py-2 text-sm text-white hover:bg-accent/80"
          >
            Active project
          </button>
          <button
            onClick={handleExportAll}
            className="rounded bg-accent px-3 py-2 text-sm text-white hover:bg-accent/80"
          >
            All projects
          </button>
          <button
            onClick={onClose}
            className="rounded border border-white/20 px-3 py-2 text-sm text-white/60 hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
