import type { Design } from '../../types'

interface Props {
  incoming: { projects: Design[]; activeProjectId: string | null }
  onConfirm: (mode: 'replace' | 'merge') => void
  onClose: () => void
  error?: string
}

export default function ImportModal({ incoming, onConfirm, onClose, error }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-80 rounded-lg bg-white p-4 shadow-xl">
        <h2 className="mb-1 text-sm font-semibold text-text-primary">Import Workspace</h2>
        <p className="mb-3 text-xs text-text-muted">
          {incoming.projects.length} project{incoming.projects.length !== 1 ? 's' : ''} found
        </p>
        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => onConfirm('replace')}
            className="rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500"
          >
            Replace workspace
          </button>
          <button
            onClick={() => onConfirm('merge')}
            className="rounded bg-accent px-3 py-2 text-sm text-white hover:bg-accent-hover"
          >
            Merge projects
          </button>
          <button
            onClick={onClose}
            className="rounded border border-divider px-3 py-2 text-sm text-text-muted hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
