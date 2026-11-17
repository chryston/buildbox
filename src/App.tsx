import { useEffect, useMemo, useRef } from 'react'
import CabinetCanvas from './components/CabinetCanvas/CabinetCanvas'
import ErrorBoundary from './components/ErrorBoundary'
import FloorPlanPage from './components/FloorPlan/FloorPlanPage'
import ModuleSwitcher from './components/ModuleSwitcher/ModuleSwitcher'
import ProjectTabs from './components/ProjectTabs/ProjectTabs'
import Sidebar from './components/Sidebar/Sidebar'
import Toolbar from './components/Toolbar/Toolbar'
import WarningBanner from './components/WarningBanner/WarningBanner'
import { computeCutListForUnits, computeSceneLayout, findNode } from './cabinet'
import type { LayoutVoid } from './cabinet'
import type { GlobalSettings } from './domain'
import { downloadSVG } from './utils/exportSVG'
import { useLegacyBindings } from './ui/legacy/bindings'

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
  const bindings = useLegacyBindings()
  const { units, activeItemDesignId, selectedNodeId, activeModule } = bindings
  const activeUnit = units.find((unit) => unit.id === activeItemDesignId) ?? units[0]
  const svgRef = useRef<SVGSVGElement>(null)

  const selectedNode = useMemo(
    () => (selectedNodeId && activeUnit ? findNode(activeUnit.root, selectedNodeId) ?? null : null),
    [selectedNodeId, activeUnit],
  )
  const cutList = useMemo(
    () => (units.length > 0 ? computeCutListForUnits(units) : []),
    [units]
  )
  const sceneLayout = useMemo(
    () => (units.length > 0 ? computeSceneLayout(units, activeItemDesignId) : null),
    [units, activeItemDesignId]
  )
  const overConstrainedIds = sceneLayout?.units.flatMap(u => u.overConstrainedIds) ?? []

  const selectedVoid = useMemo<LayoutVoid | null>(() => {
    if (!selectedNodeId || !sceneLayout) return null
    for (const unit of sceneLayout.units) {
      const v = unit.voids.find(v => v.nodeId === selectedNodeId)
      if (v) return v
    }
    return null
  }, [selectedNodeId, sceneLayout])

  const evenH = useMemo<number | null>(() => {
    if (!selectedVoid?.columnRootId || !sceneLayout) return null
    const allVoids: LayoutVoid[] = sceneLayout.units.flatMap(u => u.voids)
    const siblings = allVoids.filter(v => v.columnRootId === selectedVoid.columnRootId)
    if (siblings.length === 0) return null
    return siblings.reduce((sum, v) => sum + v.h, 0) / siblings.length
  }, [selectedVoid, sceneLayout])

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
        bindings.undo()
      }

      if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault()
        bindings.redo()
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [bindings])

  if (bindings.projects.length === 0) {
    return <div className="min-h-screen bg-surface text-text-primary">BuildBox</div>
  }

  return (
    <ErrorBoundary>
    <div className="h-screen overflow-hidden bg-surface text-text-primary flex flex-col">
      <Toolbar
        settings={activeUnit?.settings ?? defaultSettings}
        onSettingsChange={(patch) => {
          const id = activeItemDesignId ?? units[0]?.id
          if (id) bindings.updateUnitSettings(id, patch)
        }}
        canUndo={bindings.canUndo}
        onUndo={bindings.undo}
        canRedo={bindings.canRedo}
        onRedo={bindings.redo}
        onExport={() => {
          if (svgRef.current) {
            downloadSVG(svgRef.current, bindings.activeProjectName)
          }
        }}
        workspace={bindings.workspace}
        saveStatus={bindings.saveStatus}
      />
      <ModuleSwitcher activeModule={activeModule} onChange={bindings.setActiveModule} />
      <ProjectTabs
        projects={bindings.projects}
        activeId={bindings.activeProjectId}
        onSelect={bindings.selectProject}
        onCreate={bindings.createProject}
        onDelete={bindings.deleteProject}
      />
      {activeModule === 'cabinet' && overConstrainedIds.length > 0 && (
        <div className="border-b border-divider bg-panel px-4 py-2">
          <WarningBanner overConstrainedIds={overConstrainedIds} />
        </div>
      )}
      <main className="flex flex-1 overflow-hidden">
        {activeModule === 'floorplan' ? (
          <FloorPlanPage />
        ) : (
          <>
            {sceneLayout && (
              <CabinetCanvas
                sceneLayout={sceneLayout}
                svgRef={svgRef}
                onUnlockNode={bindings.unlockNode}
                onUnitClick={bindings.setActiveItemDesign}
                selectedNode={selectedNode}
              />
            )}
            <Sidebar
              cutList={cutList}
              units={units}
              activeUnitId={activeItemDesignId}
              onAddUnit={bindings.addUnit}
              onRemoveUnit={bindings.removeUnit}
              onSelectUnit={bindings.setActiveItemDesign}
              onRenameUnit={bindings.renameUnit}
              selectedId={selectedNodeId}
              selectedNode={selectedNode}
              onAddShelf={bindings.addShelf}
              onAddDivider={bindings.addDivider}
              onDelete={bindings.deleteBoard}
              onToggleLock={(id) => {
                if (selectedNode?.locked) bindings.unpinNode(id)
                else {
                  const sizeMm = selectedVoid?.parentSplitAxis === 'vertical' ? selectedVoid.w : (selectedVoid?.h ?? selectedNode?.fixedSize ?? 0)
                  if (sizeMm > 0) bindings.pinNode(id, sizeMm)
                }
              }}
              onSetCabinetMaterial={bindings.setCabinetMaterial}
              currentMaterial={activeUnit?.settings.material ?? 'oak'}
              selectedVoid={selectedVoid}
              evenH={evenH}
              onDistributeEvenly={bindings.distributeEvenly}
              onSetElementType={bindings.setElementType}
              onSetDrawerConfig={bindings.setDrawerConfig}
              onAddAccessory={bindings.addAccessory}
              onRemoveAccessory={bindings.removeAccessory}
              settings={activeUnit?.settings}
              onSettingsChange={(patch) => activeUnit && bindings.updateUnitSettings(activeUnit.id, patch)}
            />
          </>
        )}
      </main>
    </div>
    </ErrorBoundary>
  )
}
