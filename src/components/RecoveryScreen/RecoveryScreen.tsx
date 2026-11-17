import { useState } from 'react'
import ProblemList from '../ProblemList/ProblemList'
import { STORE_KEY, type StoredStateFailure } from '../../store/guardedStorage'

interface Props {
  failure: StoredStateFailure
}

/** `20261117-143005`, local time: the filename a user can line up with their own day. */
function downloadStamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * What the app shows instead of the editor when the stored data can't be opened (#40 §3).
 *
 * Nothing here changes the stored value: the guard in `guardedStorage` has already
 * stopped every write, and the only thing that removes it is the confirmed
 * Clear saved data action, which goes straight to `localStorage` to get past the guard.
 */
export default function RecoveryScreen({ failure }: Props) {
  const [showProblems, setShowProblems] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)

  function downloadRaw(): void {
    const blob = new Blob([failure.raw], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `buildbox-store-raw-${downloadStamp(new Date())}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  function clearSavedData(): void {
    localStorage.removeItem(STORE_KEY)
    window.location.reload()
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-surface p-6 text-sm text-text-muted"
      data-testid="recovery-screen"
    >
      <div className="w-full max-w-lg space-y-4 rounded-lg bg-panel p-6 shadow-xl">
        <h1 className="text-lg font-semibold text-text-primary">
          BuildBox can&apos;t open the designs saved in this browser
        </h1>
        <p>
          The saved data doesn&apos;t match what this version of BuildBox expects, so it hasn&apos;t
          been loaded. It is still stored in this browser and nothing has been changed.
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={downloadRaw}
            className="rounded bg-accent px-3 py-2 text-white hover:bg-accent-hover"
          >
            Download raw data
          </button>
          <button
            onClick={() => setShowProblems((shown) => !shown)}
            aria-expanded={showProblems}
            className="rounded border border-divider px-3 py-2 text-text-muted hover:bg-surface-raised"
          >
            {showProblems ? 'Hide problems' : 'Show problems'}
          </button>
          {showProblems && <ProblemList problems={failure.problems} />}
          <button
            onClick={() => window.location.reload()}
            className="rounded border border-divider px-3 py-2 text-text-muted hover:bg-surface-raised"
          >
            Reload
          </button>
          <button
            onClick={() => setConfirmingClear(true)}
            className="rounded px-3 py-2 text-red-400 hover:bg-surface-raised"
          >
            Clear saved data and start over…
          </button>
        </div>
      </div>

      {confirmingClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-lg bg-panel p-4 shadow-xl">
            <h2 className="mb-2 text-sm font-semibold text-text-primary">Clear saved data?</h2>
            <p className="mb-3 text-xs text-text-muted">
              This permanently removes the saved designs and floor plan from this browser. Download
              raw data first if you might need them.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setConfirmingClear(false)}
                className="rounded border border-divider px-3 py-2 text-sm text-text-muted hover:bg-surface-raised"
              >
                Cancel
              </button>
              <button
                onClick={clearSavedData}
                className="rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500"
              >
                Clear saved data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
