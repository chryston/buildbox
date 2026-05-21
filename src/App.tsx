import { useEffect, useMemo, useRef, useState } from 'react'
import CabinetCanvas from './components/CabinetCanvas/CabinetCanvas'
import CutListPanel from './components/CutListPanel/CutListPanel'
import ProjectTabs from './components/ProjectTabs/ProjectTabs'
import Sidebar from './components/Sidebar/Sidebar'
import Toolbar from './components/Toolbar/Toolbar'
import WarningBanner from './components/WarningBanner/WarningBanner'
import { computeCutList } from './engine/cutList'
import { computeLayout } from './engine/layoutEngine'
import { findNode } from './engine/treeMutations'
import { downloadSVG } from './utils/exportSVG'
import { useStore } from './store/store'

export default function App() {
  const projects = useStore((state) => state.projects)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeDesign = projects.find((project) => project.id === activeProjectId) ?? projects[0]
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const createProject = useStore((state) => state.createProject)
  const deleteProject = useStore((state) => state.deleteProject)
  const setActiveProject = useStore((state) => state.setActiveProject)
  const updateSettings = useStore((state) => state.updateSettings)
  const storeAddShelf = useStore((state) => state.addShelf)
  const storeAddDivider = useStore((state) => state.addDivider)
  const storeDeleteBoard = useStore((state) => state.deleteBoard)
  const storeLocked = useStore((state) => state.setLocked)
  const storeUnlockNode = useStore((state) => state.unlockNode)
  const storeMaterial = useStore((state) => state.setMaterial)
  const storeDrawerConfig = useStore((state) => state.setDrawerConfig)
  const storeSetElementType = useStore((state) => state.setElementType)
  const selectedId = useStore((state) => state.selectedId)

  const svgRef = useRef<SVGSVGElement>(null)
  const selectedNode = useMemo(
    () => (selectedId && activeDesign ? findNode(activeDesign.root, selectedId) ?? null : null),
    [selectedId, activeDesign],
  )
  const cutList = activeDesign ? computeCutList(activeDesign) : []
  // TODO: pass layout result down to CabinetCanvas to avoid computing twice per render
  const layout = activeDesign ? computeLayout(activeDesign) : null
  const overConstrainedIds = layout?.overConstrainedIds ?? []

  useEffect(() => {
    const syncTemporalState = () => {
      const state = useStore.temporal.getState()
      setCanUndo(state.pastStates.length > 0)
      setCanRedo(state.futureStates.length > 0)
    }

    syncTemporalState()
    const unsubscribe = useStore.temporal.subscribe(syncTemporalState)

    return unsubscribe
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      const key = e.key.toLowerCase()

      if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        useStore.temporal.getState().undo()
      }

      if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault()
        useStore.temporal.getState().redo()
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  if (!activeDesign) {
    return <div className="min-h-screen bg-surface text-white">BuildBox</div>
  }

  return (
    <div className="min-h-screen bg-surface text-white flex flex-col">
      <Toolbar
        settings={activeDesign.globalSettings}
        onSettingsChange={updateSettings}
        canUndo={canUndo}
        onUndo={() => useStore.temporal.getState().undo()}
        canRedo={canRedo}
        onRedo={() => useStore.temporal.getState().redo()}
        onExport={() => {
          if (svgRef.current) {
            downloadSVG(svgRef.current, activeDesign.name)
          }
        }}
      />
      <ProjectTabs
        projects={projects}
        activeId={activeProjectId}
        onSelect={setActiveProject}
        onCreate={createProject}
        onDelete={deleteProject}
      />
      {overConstrainedIds.length > 0 && (
        <div className="border-b border-white/10 bg-panel px-4 py-2">
          <WarningBanner overConstrainedIds={overConstrainedIds} />
        </div>
      )}
      <main className="flex flex-1 overflow-hidden">
        {activeDesign && <CabinetCanvas design={activeDesign} svgRef={svgRef} />}
        <Sidebar
          selectedId={selectedId}
          selectedNode={selectedNode}
          onAddShelf={storeAddShelf}
          onAddDivider={storeAddDivider}
          onDelete={storeDeleteBoard}
          onToggleLock={(id) => {
            if (selectedNode?.locked) storeUnlockNode(id)
            else storeLocked(id, true)
          }}
          onSetMaterial={storeMaterial}
          onSetElementType={storeSetElementType}
          onSetDrawerConfig={storeDrawerConfig}
        />
        <div className="flex w-72 flex-col overflow-y-auto border-l border-white/10 bg-panel">
          <details open className="p-2">
            <summary className="cursor-pointer select-none text-sm font-semibold text-white/60">
              Cut List ({cutList.length} parts)
            </summary>
            <CutListPanel entries={cutList} />
          </details>
        </div>
      </main>
    </div>
  )
}
