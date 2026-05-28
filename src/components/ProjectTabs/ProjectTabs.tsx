interface Props {
  projects: { id: string; name: string }[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

export default function ProjectTabs({ projects, activeId, onSelect, onCreate, onDelete }: Props) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-divider bg-panel px-2 py-1">
      {projects.map((project) => (
        <div
          key={project.id}
          className={`flex items-center gap-1 rounded-t px-3 py-1 text-sm select-none ${
            project.id === activeId ? 'bg-white text-text-primary shadow-sm border border-divider' : 'text-text-muted hover:text-text-primary hover:bg-white'
          }`}
        >
          <button onClick={() => onSelect(project.id)}>{project.name}</button>
          {projects.length > 1 && (
            <button
              onClick={() => onDelete(project.id)}
              className="ml-1 text-xs text-text-muted hover:text-red-500"
              aria-label={`Delete ${project.name}`}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        onClick={onCreate}
        aria-label="New project"
        className="px-2 py-1 text-lg leading-none text-text-muted hover:text-text-primary"
      >
        +
      </button>
    </div>
  )
}
