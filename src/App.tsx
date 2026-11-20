import { useEffect, useMemo, useRef } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import ProjectsNav from './components/ProjectsNav/ProjectsNav'
import Sidebar from './components/Sidebar/Sidebar'
import Toolbar from './components/Toolbar/Toolbar'
import WarningBanner from './components/WarningBanner/WarningBanner'
import { computeCutListForUnits, computeSceneLayout, findNode } from './cabinet'
import type { LayoutVoid } from './cabinet'
import type { GlobalSettings } from './domain'
import { CabinetCanvas, FloorWorkspace, ItemDetailView, STRINGS, useWorkspace } from './ui'
import type { CabinetDetail } from './ui'
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
  const { units, activeItemDesignId, selectedNodeId, setActiveItemDesign } = bindings
  // The Item Detail View (#57 §6) is the only way into the cabinet editor: the app opens on the
  // Floor workspace, and a design's editor appears when its Item Detail is opened. Which one is
  // on screen is workspace view state, never Project data and never history (#26).
  const itemDetail = useWorkspace((state) => state.itemDetail)
  const detailDesignId = itemDetail?.itemDesignId ?? null
  const shownDesignId = detailDesignId ?? activeItemDesignId
  const activeUnit = units.find((unit) => unit.id === shownDesignId) ?? units[0]
  const editingCabinet = detailDesignId !== null && units.some((unit) => unit.id === detailDesignId)
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
    () => (units.length > 0 ? computeSceneLayout(units, shownDesignId) : null),
    [units, shownDesignId]
  )
  const overConstrainedIds = sceneLayout?.units.flatMap(u => u.overConstrainedIds) ?? []

  // The cabinet canvas draws the same layout the sidebar and the cut list read, wrapped in the
  // one shape `drawing` accepts: an Item Detail of a cabinet (#60).
  const cabinetDetail = useMemo<CabinetDetail | null>(
    () => (sceneLayout === null || detailDesignId === null
      ? null
      : { kind: 'cabinet', designId: detailDesignId, layout: sceneLayout }),
    [sceneLayout, detailDesignId],
  )

  // The legacy editor writes to whichever Design it holds, so opening Item Detail moves that
  // pointer too. UI state, not a change to the Project (#26).
  useEffect(() => {
    if (detailDesignId !== null && detailDesignId !== activeItemDesignId) {
      setActiveItemDesign(detailDesignId)
    }
  }, [detailDesignId, activeItemDesignId, setActiveItemDesign])

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

  return (
    <ErrorBoundary>
    {itemDetail === null ? (
      /* The Floor workspace owns its chrome (#55): no cabinet Toolbar, no ProjectsNav,
         no warning banner — the header, toolbar and rail are the workspace's own. */
      <div className="h-screen overflow-hidden flex flex-col">
        <div className="flex flex-1 min-h-0">
          <FloorWorkspace />
        </div>
      </div>
    ) : (
    <div className="h-screen overflow-hidden flex flex-col">
      <ItemDetailView itemDesignId={itemDetail.itemDesignId}>
        {editingCabinet ? (
          <div className="flex flex-col min-h-0 bg-surface text-text-primary">
            <Toolbar
              settings={activeUnit?.settings ?? defaultSettings}
              onSettingsChange={(patch) => {
                const id = shownDesignId ?? units[0]?.id
                if (id) bindings.updateUnitSettings(id, patch)
              }}
              canUndo={bindings.canUndo}
              onUndo={bindings.undo}
              canRedo={bindings.canRedo}
              onRedo={bindings.redo}
              saveStatus={bindings.saveStatus}
              onSaveStatusClick={bindings.reopenSaveFailure}
            />
            <ProjectsNav label={STRINGS.returnToProjects} onReturn={bindings.returnToProjects} />
            {overConstrainedIds.length > 0 && (
              <div className="border-b border-divider bg-panel px-4 py-2">
                <WarningBanner overConstrainedIds={overConstrainedIds} />
              </div>
            )}
            <main className="flex flex-1 overflow-hidden">
              {cabinetDetail !== null && (
                <CabinetCanvas
                  detail={cabinetDetail}
                  svgRef={svgRef}
                  selectedNode={selectedNode}
                  selectedNodeId={selectedNodeId}
                  snapGrid={bindings.snapGrid}
                  onUnitClick={bindings.setActiveItemDesign}
                  onSelectNode={bindings.selectNode}
                  onCommitSize={bindings.setNodeSize}
                  onCommitLabel={bindings.setNodeLabel}
                  onCommitDrag={bindings.commitDrag}
                  onUnlockNode={bindings.unlockNode}
                />
              )}
              <Sidebar
                cutList={cutList}
                units={units}
                activeUnitId={shownDesignId}
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
            </main>
          </div>
        ) : null}
      </ItemDetailView>
    </div>
    )}
    </ErrorBoundary>
  )
}
