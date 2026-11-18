interface Props {
  label: string
  onReturn: () => void
}

/**
 * The editor's way back to the Project Library (#53).
 *
 * The project bar used to hold one tab per Project and switch between them here. Switching is
 * the Library's now — a Project's session holds its lock, its undo stack and its unsaved work,
 * so leaving it is a decision with a dialog attached, not a tab click — and what is left of the
 * bar is the way out.
 *
 * It sits in the row the tabs occupied and keeps that row's box on purpose: the canvases below
 * are `h-full` inside a flex column, so a row of a different height would move every pixel of
 * the cabinet and floor-plan scenes the S0 baselines record (#53 criterion 12). The control is
 * therefore styled as the tab it replaces.
 */
export default function ProjectsNav({ label, onReturn }: Props) {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-divider bg-panel px-2 py-1">
      <button
        type="button"
        onClick={onReturn}
        data-testid="return-to-projects"
        className="flex items-center gap-1 rounded-t border border-divider bg-surface-raised px-3 py-1 text-sm text-text-primary shadow-sm select-none hover:bg-surface"
      >
        {label}
      </button>
    </nav>
  )
}
