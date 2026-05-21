import { useRef } from 'react'
import ProjectTabs from './components/ProjectTabs/ProjectTabs'
import Toolbar from './components/Toolbar/Toolbar'
import { useStore } from './store/store'

export default function App() {
  const projects = useStore((state) => state.projects)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeDesign = projects.find((project) => project.id === activeProjectId) ?? projects[0]

  const createProject = useStore((state) => state.createProject)
  const deleteProject = useStore((state) => state.deleteProject)
  const setActiveProject = useStore((state) => state.setActiveProject)
  const updateSettings = useStore((state) => state.updateSettings)

  const svgRef = useRef<SVGSVGElement>(null)

  if (!activeDesign) {
    return <div className="min-h-screen bg-surface text-white">BuildBox</div>
  }

  return (
    <div className="min-h-screen bg-surface text-white flex flex-col">
      <Toolbar
        settings={activeDesign.globalSettings}
        onSettingsChange={updateSettings}
        svgRef={svgRef}
        designName={activeDesign.name}
      />
      <ProjectTabs
        projects={projects}
        activeId={activeProjectId}
        onSelect={setActiveProject}
        onCreate={createProject}
        onDelete={deleteProject}
      />
      <main className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-sm text-white/30">
          Canvas coming in Task 8
        </div>
      </main>
    </div>
  )
}
