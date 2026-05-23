import { useEffect, useMemo, useRef, useState } from 'react'
import CabinetCanvas from './components/CabinetCanvas/CabinetCanvas'
import ErrorBoundary from './components/ErrorBoundary'
import ProjectTabs from './components/ProjectTabs/ProjectTabs'
import Sidebar from './components/Sidebar/Sidebar'
import Toolbar from './components/Toolbar/Toolbar'
import WarningBanner from './components/WarningBanner/WarningBanner'
import { computeCutListForUnits } from './engine/cutList'
import { computeSceneLayout } from './engine/layoutEngine'
import { findNode } from './engine/treeMutations'
import { downloadSVG } from './utils/exportSVG'
import { useStore } from './store/store'
import type { GlobalSettings } from './types'

const defaultSettings: GlobalSettings = {
  unit: 'mm',
  height: 800,
  width: 600,
  depth: 500,
  thickness: 18,
  backThickness: 6,
  toeKick: null,
  defaultMaterial: 'oak',
}

export default function App() {
  const projects = useStore((state) => state.projects)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeUnitId = useStore((state) => state.activeUnitId)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0]
  const activeUnit = activeProject?.units.find(u => u.id === activeUnitId) ?? activeProject?.units[0]
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const createProject = useStore((state) => state.createProject)
  const deleteProject = useStore((state) => state.deleteProject)
  const setActiveProject = useStore((state) => state.setActiveProject)
  const updateUnitSettings = useStore((state) => state.updateUnitSettings)
  const storeAddShelf = useStore((state) => state.addShelf)
  const storeAddDivider = useStore((state) => state.addDivider)
  const storeDeleteBoard = useStore((state) => state.deleteBoard)
  const storeLocked = useStore((state) => state.setLocked)
  const storeUnlockNode = useStore((state) => state.unlockNode)
  const storeMaterial = useStore((state) => state.setMaterial)
  const storeDrawerConfig = useStore((state) => state.setDrawerConfig)
  const storeSetElementType = useStore((state) => state.setElementType)
  const storeAddAccessory = useStore((state) => state.addAccessory)
  const storeRemoveAccessory = useStore((state) => state.removeAccessory)
  const addUnit = useStore((state) => state.addUnit)
  const removeUnit = useStore((state) => state.removeUnit)
  const setActiveUnit = useStore((state) => state.setActiveUnit)
  const renameUnit = useStore((state) => state.renameUnit)
  const selectedId = useStore((state) => state.selectedId)

  const storeImportWorkspace = useStore((state) => state.importWorkspace)
  const svgRef = useRef<SVGSVGElement>(null)
  const selectedNode = useMemo(
    () => (selectedId && activeUnit ? findNode(activeUnit.root, selectedId) ?? null : null),
    [selectedId, activeUnit],
  )
  const cutList = useMemo(
    () => (activeProject ? computeCutListForUnits(activeProject.units) : []),
    [activeProject]
  )
  const sceneLayout = useMemo(
    () => (activeProject ? computeSceneLayout(activeProject.units, activeUnitId) : null),
    [activeProject, activeUnitId]
  )
  const overConstrainedIds = sceneLayout?.units.flatMap(u => u.overConstrainedIds) ?? []

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
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) return

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

  if (!activeProject) {
    return <div className="min-h-screen bg-surface text-white">BuildBox</div>
  }

  return (
    <ErrorBoundary>
    <div className="min-h-screen bg-surface text-white flex flex-col">
      <Toolbar
        settings={activeUnit?.settings ?? defaultSettings}
        onSettingsChange={(patch) => activeUnitId && updateUnitSettings(activeUnitId, patch)}
        canUndo={canUndo}
        onUndo={() => useStore.temporal.getState().undo()}
        canRedo={canRedo}
        onRedo={() => useStore.temporal.getState().redo()}
        onExport={() => {
          if (svgRef.current) {
            downloadSVG(svgRef.current, activeProject.name)
          }
        }}
        projects={projects}
        activeProjectId={activeProjectId}
        onImportWorkspace={(incoming, mode) => storeImportWorkspace(incoming.projects, mode)}
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
        {sceneLayout && (
          <CabinetCanvas
            sceneLayout={sceneLayout}
            svgRef={svgRef}
            onUnlockNode={storeUnlockNode}
            onUnitClick={setActiveUnit}
          />
        )}
        <Sidebar
          cutList={cutList}
          units={activeProject?.units ?? []}
          activeUnitId={activeUnitId}
          onAddUnit={addUnit}
          onRemoveUnit={removeUnit}
          onSelectUnit={setActiveUnit}
          onRenameUnit={renameUnit}
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
          onAddAccessory={(nodeId, type) => storeAddAccessory(nodeId, { id: crypto.randomUUID(), type })}
          onRemoveAccessory={storeRemoveAccessory}
        />
      </main>
    </div>
    </ErrorBoundary>
  )
}
