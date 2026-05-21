interface Props {
  canUndo: boolean
  onUndo: () => void
  canRedo: boolean
  onRedo: () => void
}

export default function UndoRedo({ canUndo, onUndo, canRedo, onRedo }: Props) {
  return (
    <div className="flex gap-1">
      <button
        aria-label="Undo"
        onClick={onUndo}
        disabled={!canUndo}
        className="px-2 py-1 rounded text-sm text-white/70 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
        title="Undo (Ctrl+Z)"
      >
        ↩
      </button>
      <button
        aria-label="Redo"
        onClick={onRedo}
        disabled={!canRedo}
        className="px-2 py-1 rounded text-sm text-white/70 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
        title="Redo (Ctrl+Y)"
      >
        ↪
      </button>
    </div>
  )
}
