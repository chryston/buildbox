import type { Design } from '../../types'
import type { ValidationProblem } from '../../package'
import ProblemList from '../ProblemList/ProblemList'

interface Props {
  onClose: () => void
}

/** A file the reader accepted: the user still chooses Replace or Merge. */
interface ChoiceProps extends Props {
  problems?: undefined
  incoming: { projects: Design[]; activeProjectId: string | null }
  onConfirm: (mode: 'replace' | 'merge') => void
}

/** A file the reader rejected: nothing has been staged, so there is nothing to choose. */
interface RejectedProps extends Props {
  problems: ValidationProblem[]
  incoming?: undefined
  onConfirm?: undefined
}

export type ImportModalProps = ChoiceProps | RejectedProps

export default function ImportModal(props: ImportModalProps) {
  const { onClose } = props
  if (props.problems) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="w-96 rounded-lg bg-panel p-4 shadow-xl">
          <h2 className="mb-1 text-sm font-semibold text-text-primary">This file can&apos;t be imported</h2>
          <p className="mb-2 text-xs text-text-muted">Nothing was changed. BuildBox found these problems:</p>
          <ProblemList problems={props.problems} />
          <button
            onClick={onClose}
            className="rounded border border-divider px-3 py-2 text-sm text-text-muted hover:bg-surface-raised"
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  const { incoming, onConfirm } = props
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-80 rounded-lg bg-panel p-4 shadow-xl">
        <h2 className="mb-1 text-sm font-semibold text-text-primary">Import Workspace</h2>
        <p className="mb-3 text-xs text-text-muted">
          {incoming.projects.length} project{incoming.projects.length !== 1 ? 's' : ''} found
        </p>
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
            className="rounded border border-divider px-3 py-2 text-sm text-text-muted hover:bg-surface-raised"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
