import { useEffect, useMemo, useRef } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import ProjectsNav from './components/ProjectsNav/ProjectsNav'
import Sidebar from './components/Sidebar/Sidebar'
import Toolbar from './components/Toolbar/Toolbar'
import WarningBanner from './components/WarningBanner/WarningBanner'
import { computeSceneLayout, findNode } from './cabinet'
import type { LayoutVoid } from './cabinet'
import type { GlobalSettings } from './domain'
import { CabinetCanvas, FloorWorkspace, ItemDetailView, STRINGS, useNotesSession, useWorkspace, notesSessionStore } from './ui'
import type { CabinetDetail, CabinetNoteBadge, CabinetNotePin } from './ui'
import { useLegacyBindings } from './ui/legacy/bindings'
import { useProject } from './ui/legacy/useProject'
import { commentsForItemDetail, quantities } from './derive'
import type { QuantityScope } from './derive'
import { commentIsOpen } from './domain'
import type { Comment } from './domain'
import type { NotePinTone } from './drawing'

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
  // The workspace tool carries into Item Detail: arming `✎ Comment` on the Plan View and then opening
  // an Item Design should not silently disarm it (#80 §12).
  const tool = useWorkspace((state) => state.activeTool)
  const detailDesignId = itemDetail?.itemDesignId ?? null
  const overlayOn = useNotesSession((state) => state.overlayOn)
  const selectNote = (id: string): void => {
    notesSessionStore.getState().select(id)
  }
  const shownDesignId = detailDesignId ?? activeItemDesignId
  const activeUnit = units.find((unit) => unit.id === shownDesignId) ?? units[0]
  const editingCabinet = detailDesignId !== null && units.some((unit) => unit.id === detailDesignId)
  const svgRef = useRef<SVGSVGElement>(null)

  const selectedNode = useMemo(
    () => (selectedNodeId && activeUnit ? findNode(activeUnit.root, selectedNodeId) ?? null : null),
    [selectedNodeId, activeUnit],
  )
  // The panel shows the rows the CSV export writes for the same scope (#62 criterion 8). The
  // scope is a constant because the Lists dialog is where a scope becomes a choice; until it is,
  // the panel and a file must still say the same thing about the same Project.
  const { project, revision } = useProject()
  // The overlay's marks for the cabinet on screen (#80 §12). Feature Comments become one pin at the
  // centre of the node they are anchored to; Comments about the design itself become a single count on
  // the outline, because four pins on one box would be four marks saying one sentence.
  const cabinetNotes = useMemo(() => {
    if (detailDesignId === null || !overlayOn) return { pins: [] as CabinetNotePin[], badge: null as CabinetNoteBadge | null }
    const about = commentsForItemDetail(project, detailDesignId)
    const toneOf = (comment: Comment): NotePinTone =>
      !commentIsOpen(comment) ? 'resolved' : comment.priority === 'high' ? 'high' : comment.priority === 'low' ? 'low' : 'normal'
    const rank: Record<NotePinTone, number> = { resolved: 0, low: 1, normal: 2, high: 3 }
    const byNode = new Map<string, { count: number; tone: NotePinTone }>()
    let design = 0
    let designTone: NotePinTone = 'normal'
    for (const comment of about) {
      const tone = toneOf(comment)
      if (comment.anchor.kind === 'feature') {
        const seen = byNode.get(comment.anchor.featureId)
        byNode.set(comment.anchor.featureId, {
          count: (seen?.count ?? 0) + 1,
          tone: rank[tone] > (seen === undefined ? -1 : rank[seen.tone]) ? tone : seen!.tone,
        })
      } else if (comment.anchor.kind === 'item_design') {
        design += 1
        if (rank[tone] > rank[designTone]) designTone = tone
      }
    }
    return {
      pins: [...byNode.entries()].map(([nodeId, one]) => ({ id: `${detailDesignId}:${nodeId}`, nodeId, tone: one.tone })),
      badge: design === 0 ? null : { id: `${detailDesignId}:design`, count: design, tone: designTone },
    }
  }, [project, detailDesignId, overlayOn])
  const cabinetNotePins = cabinetNotes.pins
  const cabinetNoteBadge = cabinetNotes.badge
  const cutListScope = useMemo<QuantityScope>(
    () => ({
      floorIds: project.floors.length > 0 ? [project.floors[0]!.id] : [],
      designOptionIds: 'existing-only',
      renovationStates: ['existing'],
      drawingLayers: 'all',
    }),
    [project],
  )
  const cutList = useMemo(
    () => quantities(project, revision, cutListScope).cuts,
    [project, revision, cutListScope]
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
                  notePins={cabinetNotePins}
                  noteBadge={cabinetNoteBadge}
                  onNotePointerDown={(id) => selectNote(id)}
                  onUnlockNode={bindings.unlockNode}
                  // The Comment tool owns the click here too (#80 §12): a node makes a feature Comment
                  // about that node, empty canvas makes one about the Item Design as a whole. Both are
                  // passed only while the tool is armed, so the cabinet chrome never has to ask which
                  // tool is on — a handler that exists is the whole instruction.
                  onCommentNode={tool === 'comment' && detailDesignId !== null
                    ? (nodeId) => bindings.createComment({
                        kind: 'feature',
                        ownerId: detailDesignId,
                        featureId: nodeId,
                      })
                    : undefined}
                  onCommentCanvas={tool === 'comment' && detailDesignId !== null
                    ? () => bindings.createComment({ kind: 'item_design', itemDesignId: detailDesignId })
                    : undefined}
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
