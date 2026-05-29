import { useEffect, useMemo, useRef, useState } from 'react'
import CabinetCanvas from './components/CabinetCanvas/CabinetCanvas'
import ErrorBoundary from './components/ErrorBoundary'
import FloorPlanPlaceholder from './components/FloorPlanPlaceholder/FloorPlanPlaceholder'
import ModuleSwitcher from './components/ModuleSwitcher/ModuleSwitcher'
import type { AppModule } from './types'
import ProjectTabs from './components/ProjectTabs/ProjectTabs'
import Sidebar from './components/Sidebar/Sidebar'
import Toolbar from './components/Toolbar/Toolbar'
import WarningBanner from './components/WarningBanner/WarningBanner'
import { computeCutListForUnits } from './engine/cutList'
import { computeSceneLayout } from './engine/layoutEngine'
import { findNode } from './engine/treeMutations'
import { downloadSVG } from './utils/exportSVG'
import { useStore } from './store/store'
import type { GlobalSettings, LayoutVoid } from './types'

const defaultSettings: GlobalSettings = {
  unit: 'mm',
  height: 800,
  width: 600,
  depth: 500,
  thickness: 18,
  backThickness: 6,
  toeKick: null,
  material: 'oak',
}

export default function App() {
  const projects = useStore((state) => state.projects)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeUnitId = useStore((state) => state.activeUnitId)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0]
  const activeUnit = activeProject?.units.find(u => u.id === activeUnitId) ?? activeProject?.units[0]
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [activeModule, setActiveModule] = useState<AppModule>('cabinet')

  const createProject = useStore((state) => state.createProject)
  const deleteProject = useStore((state) => state.deleteProject)
  const setActiveProject = useStore((state) => state.setActiveProject)
  const updateUnitSettings = useStore((state) => state.updateUnitSettings)
  const storeAddShelf = useStore((state) => state.addShelf)
  const storeAddDivider = useStore((state) => state.addDivider)
  const storeDeleteBoard = useStore((state) => state.deleteBoard)
  const storeUnpinNode = useStore((state) => state.unpinNode)
  const storePinNode = useStore((state) => state.pinNode)
  const storeUnlockNode = useStore((state) => state.unlockNode)
  const storeSetCabinetMaterial = useStore((state) => state.setCabinetMaterial)
  const storeSetNodeLabel = useStore((state) => state.setNodeLabel)
  const storeDistributeEvenly = useStore((state) => state.distributeEvenly)
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

  const selectedVoid = useMemo<LayoutVoid | null>(() => {
    if (!selectedId || !sceneLayout) return null
    for (const unit of sceneLayout.units) {
      const v = unit.voids.find(v => v.nodeId === selectedId)
      if (v) return v
    }
    return null
  }, [selectedId, sceneLayout])

  const evenH = useMemo<number | null>(() => {
    if (!selectedVoid?.columnRootId || !sceneLayout) return null
    const allVoids: LayoutVoid[] = sceneLayout.units.flatMap(u => u.voids)
    const siblings = allVoids.filter(v => v.columnRootId === selectedVoid.columnRootId)
    if (siblings.length === 0) return null
    return siblings.reduce((sum, v) => sum + v.h, 0) / siblings.length
  }, [selectedVoid, sceneLayout])

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
    return <div className="min-h-screen bg-surface text-text-primary">BuildBox</div>
  }

  return (
    <ErrorBoundary>
    <div className="h-screen overflow-hidden bg-surface text-text-primary flex flex-col">
      <Toolbar
        settings={activeUnit?.settings ?? defaultSettings}
        onSettingsChange={(patch) => {
          const id = activeUnitId ?? activeProject?.units[0]?.id
          if (id) updateUnitSettings(id, patch)
        }}
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
      <ModuleSwitcher activeModule={activeModule} onChange={setActiveModule} />
      <ProjectTabs
        projects={projects}
        activeId={activeProjectId}
        onSelect={setActiveProject}
        onCreate={createProject}
        onDelete={deleteProject}
      />
      {activeModule === 'cabinet' && overConstrainedIds.length > 0 && (
        <div className="border-b border-divider bg-panel px-4 py-2">
          <WarningBanner overConstrainedIds={overConstrainedIds} />
        </div>
      )}
      <main className="flex flex-1 overflow-hidden">
        {activeModule === 'floorplan' ? (
          <FloorPlanPlaceholder />
        ) : (
          <>
            {sceneLayout && (
              <CabinetCanvas
                sceneLayout={sceneLayout}
                svgRef={svgRef}
                onUnlockNode={storeUnlockNode}
                onUnitClick={setActiveUnit}
                selectedNode={selectedNode}
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
                if (selectedNode?.locked) storeUnpinNode(id)
                else storePinNode(id, selectedNode?.fixedSize ?? selectedVoid?.h ?? 0)
              }}
              onSetCabinetMaterial={storeSetCabinetMaterial}
              currentMaterial={activeUnit?.settings.material ?? 'oak'}
              selectedVoid={selectedVoid}
              evenH={evenH}
              onDistributeEvenly={(colId, h) => storeDistributeEvenly(colId, h)}
              onSetElementType={storeSetElementType}
              onSetDrawerConfig={storeDrawerConfig}
              onAddAccessory={(nodeId, type) => storeAddAccessory(nodeId, { id: crypto.randomUUID(), type })}
              onRemoveAccessory={storeRemoveAccessory}
            />
          </>
        )}
      </main>
    </div>
    </ErrorBoundary>
  )
}
