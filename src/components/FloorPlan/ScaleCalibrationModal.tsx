import { useState } from 'react'

interface Props {
  distancePx: number
  onConfirm: (pixelsPerMm: number) => void
  onClose: () => void
}

export default function ScaleCalibrationModal({ distancePx, onConfirm, onClose }: Props) {
  const [mm, setMm] = useState(1000)

  function handleConfirm() {
    if (distancePx <= 0) return
    if (!Number.isFinite(mm) || mm <= 0) return
    onConfirm(distancePx / mm)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div role="dialog" aria-modal="true" aria-labelledby="cal-modal-title" className="w-80 rounded-lg bg-panel p-6 shadow-xl border border-divider">
        <h2 id="cal-modal-title" className="mb-4 text-lg font-semibold text-text-primary">Calibrate Scale</h2>
        <p className="mb-4 text-sm text-text-muted">
          You drew a line of <strong className="text-text-primary">{Math.round(distancePx)}px</strong>.<br />
          What is the real-world length of this line?
        </p>
        {distancePx <= 0 && (
          <p className="mb-4 text-sm text-red-400">
            Could not measure distance — try clicking two further-apart points.
          </p>
        )}
        <div className="mb-6">
          <label htmlFor="cal-mm" className="mb-1 block text-sm text-text-muted">Distance (mm)</label>
          <input
            id="cal-mm"
            type="number"
            min={1}
            value={mm}
            onChange={e => setMm(Number(e.target.value))}
            className="w-full rounded border border-divider bg-surface px-3 py-2 text-text-primary"
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded border border-divider bg-surface py-2 text-sm text-text-primary hover:bg-surface-raised"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
