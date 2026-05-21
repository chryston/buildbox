import { useMemo, useRef } from 'react'
import CabinetCanvas from './components/CabinetCanvas/CabinetCanvas'
import ProjectTabs from './components/ProjectTabs/ProjectTabs'
import Sidebar from './components/Sidebar/Sidebar'
import Toolbar from './components/Toolbar/Toolbar'
import { findNode } from './engine/treeMutations'
import { useStore } from './store/store'

export default function App() {
  const projects = useStore((state) => state.projects)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeDesign = projects.find((project) => project.id === activeProjectId) ?? projects[0]

  const createProject = useStore((state) => state.createProject)
  const deleteProject = useStore((state) => state.deleteProject)
  const setActiveProject = useStore((state) => state.setActiveProject)
  const updateSettings = useStore((state) => state.updateSettings)
  const storeAddShelf = useStore((state) => state.addShelf)
  const storeAddDivider = useStore((state) => state.addDivider)
  const storeDeleteBoard = useStore((state) => state.deleteBoard)
  const storeLocked = useStore((state) => state.setLocked)
  const storeMaterial = useStore((state) => state.setMaterial)
  const storeDrawerConfig = useStore((state) => state.setDrawerConfig)
  const storeSetElementType = useStore((state) => state.setElementType)
  const selectedId = useStore((state) => state.selectedId)

  const svgRef = useRef<SVGSVGElement>(null)
  const selectedNode = useMemo(
    () => (selectedId && activeDesign ? findNode(activeDesign.root, selectedId) ?? null : null),
    [selectedId, activeDesign],
  )

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
        {activeDesign && <CabinetCanvas design={activeDesign} svgRef={svgRef} />}
        <Sidebar
          selectedId={selectedId}
          selectedNode={selectedNode}
          onAddShelf={storeAddShelf}
          onAddDivider={storeAddDivider}
          onDelete={storeDeleteBoard}
          onToggleLock={storeLocked}
          onSetMaterial={storeMaterial}
          onSetElementType={storeSetElementType}
          onSetDrawerConfig={storeDrawerConfig}
        />
      </main>
    </div>
  )
}
