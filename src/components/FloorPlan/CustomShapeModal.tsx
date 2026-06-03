import { useState } from 'react'

interface Props {
  onConfirm: (label: string, w: number, h: number) => void
  onClose: () => void
}

export default function CustomShapeModal({ onConfirm, onClose }: Props) {
  const [label, setLabel] = useState('')
  const [w, setW] = useState(1000)
  const [h, setH] = useState(1000)

  function handleConfirm() {
    const trimmed = label.trim()
    if (!trimmed || w <= 0 || h <= 0) return
    onConfirm(trimmed, w, h)
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="cs-modal-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-80 rounded-lg bg-panel p-6 shadow-xl border border-divider">
        <h2 id="cs-modal-title" className="mb-4 text-lg font-semibold text-text-primary">Save Custom Template</h2>

        <label className="mb-1 block text-sm text-text-muted" htmlFor="cs-label">Label</label>
        <input
          id="cs-label"
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="e.g. Study Nook"
          className="mb-3 w-full rounded border border-divider bg-surface px-3 py-2 text-text-primary"
          autoFocus
        />

        <label className="mb-1 block text-sm text-text-muted" htmlFor="cs-width">Width (mm)</label>
        <input
          id="cs-width"
          type="number"
          min={10}
          value={w}
          onChange={e => setW(Number(e.target.value))}
          className="mb-3 w-full rounded border border-divider bg-surface px-3 py-2 text-text-primary"
        />

        <label className="mb-1 block text-sm text-text-muted" htmlFor="cs-depth">Depth (mm)</label>
        <input
          id="cs-depth"
          type="number"
          min={10}
          value={h}
          onChange={e => setH(Number(e.target.value))}
          className="mb-4 w-full rounded border border-divider bg-surface px-3 py-2 text-text-primary"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Save Template
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
