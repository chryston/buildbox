/**
 * The Floor workspace (#55, #56): the production Plan View and the chrome the issues
 * prescribe — header (`← Projects`, name, save status, Undo/Redo, Project settings), one
 * fixed-height toolbar, a left rail of view card above selection inspector, the canvas, and
 * slots for the draft bar and warning strip.
 *
 * Every write is one Intent through the session, exactly as the flagged floor plan wrote
 * since #49: a drag is one `plan.updateObject` at the end of the gesture, an upload is one
 * `plan.setImage` with its Asset, a calibration is one `plan.calibrate`, a Floor rename is
 * one `floor.rename`. The viewport and which Floor and view are open are the one thing that
 * bypasses the session — device-local view state, never history (#20 §4) — and they go
 * through the `ViewportCache` port instead.
 *
 * The Floor and Plan View the workspace is looking at are pointers into the Project, never
 * owners of it (#25): every selector below takes the Floor id, so nothing drawn, snapped or
 * selected can cross a Floor boundary.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { originSnapCandidates, usableIntervals, deriveWarnings, roomDeleteBlockFor, roomFaceCandidates, SNAP_ACQUISITION_PX, displayModel, effectiveFloor, effectiveModel, deriveRooms, deriveWalls, FF_RENOVATION, layerAccessOf, effectiveLayerOrder, effectiveLayerSetting, snapCandidateAllowed } from '../../derive'
import type { DisplayModel, LayerAccess, Pt, RenovationState, RoomFaceCandidate, Warning } from '../../derive'
import { wallOpenings } from '../../drawing'
import type { BadgeSubject, OpeningPreview, RoomProposal } from '../../drawing'
import type { Point2, Project, RenovationDisplay, WallClassification } from '../../domain'
import { designOptionsOf, nextOpeningLabel, summarizeFloorDependencies, viewDesignOptionId, viewRenovationDisplay, drawingLayerById, drawingLayersOf, NEW_LAYER_COLOR, UNLAYERED_LAYER_KEY, viewLayerSettingOverride } from '../../domain'
import type { SessionAsset } from '../../session'
import type { DeleteWallReview, Intent, IntentType, PayloadOf, RoomOutlineShape } from '../../edit'
import {
  usePlanImageSrc,
  useSaveStatus,
  useWorkspaceDispatch,
  useWorkspaceProject,
  useWorkspaceRoot,
} from './WorkspaceRoot'
import type { PreparedPlanImage } from './WorkspaceRoot'
import {
  decodeActiveViews,
  encodeActiveViews,
  itemLibrary,
  planImageForView,
  planItemsForFloor,
  planViewKey,
  planViewsForFloor,
  placedOrigin,
  resolvePlanView,
} from './planModel'
import { CALIBRATION_REQUIRED_HINT, DRAW_TOOLS, WORKSPACE_TOOLS, floorNeedsCalibration, toolIsGated, toolTitle } from './toolbarRegistry'
import { WallDraftOverlay, emptyWallDraft } from './wall/WallDraftOverlay'
import { OpeningDraftOverlay } from './opening/OpeningDraftOverlay'
import { OpeningInspector } from './opening/OpeningInspector'
import { DeleteWallReviewDialog } from './wall/DeleteWallReviewDialog'
import { emptyOpeningDraft, openingAim } from './opening/openingDraft'
import type { OpeningAim, OpeningDraft } from './opening/openingDraft'
import { DEFAULT_OPENING_PRESET_ID, openingPresetRow, resolveOpeningPreset } from './opening/openingPresets'
import { readoutMm } from './displayUnits'
import { WallInspector } from './wall/WallInspector'
import { RoomInspector } from './rooms/RoomInspector'
import { RoomDraftOverlay } from './rooms/RoomDraftOverlay'
import { ShelterLayer } from './rooms/ShelterLayer'
import { roomDraftOutline, roomOutlineShapePath, roomOverlapPreview, shelterName, shelterOutline, shelterPackName } from './rooms/roomDraft'
import { roomMembershipSentence } from './rooms/membership'
import { RoomFacePicker, roomEdgeRows } from './rooms/RoomFacePicker'
import { FacePickLayer } from './rooms/FacePickLayer'
import type { PathDraft } from './shape/draftPath'
import { mergeableNeighbour } from './wall/wallDraft'
import type { WallChainDraft, WallDraft } from './wall/wallDraft'
import { fitRect, fitViewport } from './viewport'
import type { Viewport } from './viewport'
import { WarningStrip } from './warnings/WarningStrip'
import { subjectBoxes, warningBox } from './warnings/locateWarning'
import type { Box } from './warnings/locateWarning'
import { enabledKindsOf, useWorkspace, workspaceStore } from './workspaceStore'
import { WorkspaceShell } from './WorkspaceShell'
import { ToolbarMenu, ToolbarMenuItem, WorkspaceToolbar } from './WorkspaceToolbar'
import type { ToolbarGroup } from './WorkspaceToolbar'
import { PlanViewCanvas } from './PlanViewCanvas'
import type { LayerGates } from './PlanViewCanvas'
import { SavedViewCard } from './SavedViewCard'
import { SelectionInspector } from './SelectionInspector'
import type { DesignEdit } from './SelectionInspector'
import { quarterTurn } from './rotateHandle'
import { ProjectSettingsDialog } from './ProjectSettingsDialog'
// #69: the whole renovation surface is reached from `FF_RENOVATION` branches only, so a flag-off
// build drops these three names — and every word they say — out of the bundle. #70 adds the
// saved-view block and the words its undo labels are built from.
import {
  DesignOptionsSection,
  MoveToOptionAction,
  RenovationErrorBanner,
  RenovationLegend,
  RenovationModeBar,
  RenovationOverlays,
  RenovationToolStrip,
  RenovationViewSection,
  RenovationLayers,
  layerSettingWord,
  DISPLAY_LABELS,
  DISPLAY_STATES,
  RenovationInspector,
  displayLabel,
  entityFields,
  openDemolishDialog,
  openForcedChoiceDialog,
  openCorrectExistingDialog,
  openRestoreDialog,
  openDeleteLayerDialog,
  baselineEditLocked,
  subjectOfIntent,
  successorOf,
} from './renovation'
import type { RenovationInspectorAction, RenovationInspectorLayer, RenovationInspectorLink, RenovationInspectorTarget, RenovationToolId, LayerSettingPatch } from './renovation'
import { RENOVATION_STRINGS } from '../strings/renovation'
import { FIELDS_UNLOCKED, FieldsLockedContext } from './fieldsLock'
import type { FieldsLock } from './fieldsLock'
import { ForkDesignDialog, NewItemDialog } from './ItemDialogs'
import { ManageFloorsDialog } from './ManageFloorsDialog'
import { DeleteFloorDialog } from './DeleteFloorDialog'
import { DuplicateFloorDialog } from './DuplicateFloorDialog'
import type { DuplicateFloorInput } from './DuplicateFloorDialog'
import { TransferToFloorDialog } from './TransferToFloorDialog'
import type { TransferTarget } from './TransferToFloorDialog'
import { CalibrationOverlay } from './CalibrationOverlay'
import { ScaleCalibrationModal } from './ScaleCalibrationModal'
import { STRINGS } from '../strings'
import { ExportDialog } from './export/ExportDialog'

/** The package's per-file limit (#6): the largest Plan Image a file may be. */
const MAX_PLAN_IMAGE_BYTES = 50 * 1024 * 1024

/**
 * The id the proposal the Plan View paints is drawn under. It is never a Room's id: a proposal is
 * not in the model, and nothing may select it (#67 §7).
 */
const ROOM_PROPOSAL = '@room-proposal'

/**
 * The commands that take a record out of the model. Outside the Existing display these mean a
 * demolition record rather than a deletion (#70 criterion 26), which is why they are listed once here
 * instead of being recognised where each delete happens to be sent.
 */
const DELETES_ARE_DEMOLITIONS: readonly IntentType[] = [
  'wall.delete',
  'opening.delete',
  'plan.removeObject',
]

/** The last placement on this Floor: the one a just-committed add has made. */
function lastPlacedId(project: Project, floorId: string): string | null {
  const { placedItems } = project.existingModel
  for (let index = placedItems.length - 1; index >= 0; index -= 1) {
    if (placedItems[index].floorId === floorId) return placedItems[index].id
  }
  return null
}

/** Below 1024 px the rail is a drawer and the toolbar gains `View & selection`. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia('(max-width: 1023.98px)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023.98px)')
    const onChange = (): void => setNarrow(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return narrow
}

export function FloorWorkspace(): ReactNode {
  const { session, services, host } = useWorkspaceRoot()
  const project = useWorkspaceProject(session)
  const dispatch = useWorkspaceDispatch()
  const save = useSaveStatus(session)
  const history = session.getSnapshot().history

  // Which Floor and Plan View are open: device-local view state, resolved against the live
  // Project so a Floor deleted underneath the pointer falls back instead of blanking.
  const storedFloorId = useWorkspace((state) => state.activeFloorId)
  const viewsByFloor = useWorkspace((state) => state.activeViewByFloor)
  const activeHydrated = useWorkspace((state) => state.activeHydrated)
  const floorId = project.floors.some((each) => each.id === storedFloorId)
    ? storedFloorId
    : project.floors[0]?.id ?? null
  const floor = project.floors.find((entry) => entry.id === floorId) ?? null
  const views = planViewsForFloor(project, floorId)
  const view = resolvePlanView(project, floorId, floorId === null ? null : viewsByFloor[floorId] ?? null)
  const planImage = floor?.planImage ?? null
  const imageSrc = usePlanImageSrc(services.assetUrls, planImage?.assetHash ?? null)
  const image = planImageForView(project, view, imageSrc)
  const items = planItemsForFloor(project, floorId)
  const library = itemLibrary(project)
  /**
   * The Design Option this view draws (#70 §F). Flag-off, or a view with no Option, is `null`, and
   * every derivation below is the Existing Model exactly as it has always been.
   */
  const renovationOptionId = FF_RENOVATION && view !== null ? viewDesignOptionId(view) : null
  /**
   * The State of every entity this view's Renovation Display draws, and the only list of what the
   * Display draws at all: an entity absent from it is not on the canvas (#70 criterion 7). The
   * overlays themselves are `drawing`'s rules, laid on the outlines the canvas already has.
   */
  const renovationStates: ReadonlyMap<string, RenovationState> | null =
    renovationOptionId === null || floorId === null || view === null
      ? null
      : statesOf(displayModel(effectiveModel(project, floorId, renovationOptionId), viewRenovationDisplay(view)))
  /**
   * The Project the canvas's geometry is derived from. `deriveWalls` and `deriveRooms` derive the
   * standing set, but a Wall marked for demolition is still drawn — with the demolition overlay on it
   * (#70 §The four Renovation Displays) — so with an Option open the geometry comes from the same
   * Project with that Option's `demolishedIds` set aside. This decides only what *can* be drawn, and
   * junctions and faces are then computed over the Walls that are actually on screen; the Display's
   * own list above still decides what reaches the canvas.
   */
  const drawingProject = useMemo<Project>(() => {
    if (renovationOptionId === null) return project
    return {
      ...project,
      designOptions: designOptionsOf(project).map((option) =>
        option.id === renovationOptionId ? { ...option, demolishedIds: [] } : option,
      ),
    }
  }, [project, renovationOptionId])
  /** The Floor the canvas draws, from the session's one derive cache (#60 criterion 3). */
  const derivedFloor =
    floorId === null
      ? null
      : renovationOptionId === null
        ? session.deriveFloor(floorId, null)
        : effectiveFloor(drawingProject, session.getSnapshot().revision, floorId, renovationOptionId)
  /** The tidied Walls, faces and corners the Wall tool snaps to, from the same cache (#64 §6). */
  const floorWalls =
    floorId === null
      ? null
      : renovationOptionId === null
        ? session.deriveWalls(floorId, null)
        : deriveWalls(drawingProject, floorId, renovationOptionId)
  /**
   * The Floor's Rooms: their areas, label anchors and Placed Item membership, from the same cache
   * (#67 §3). A view drawing a Design Option sees that Option's Rooms standing where its own walls
   * put them, which is what `optionId` is for (#69).
   */
  const floorRooms =
    floorId === null
      ? null
      : renovationOptionId === null
        ? session.deriveRooms(floorId, null)
        : deriveRooms(drawingProject, floorId, renovationOptionId)
  /**
   * What an entity is called, in the words the drawing already uses for it: a Wall's display
   * reference (`W-2′`), a Placed Item's Design name, a Room's name. The overlap list prints these
   * in full — `W-2` and `W-2′` are one character apart, so a shortened name is a list that cannot be
   * read (#70 criterion 16).
   */
  const nameOfEntity = useCallback(
    (id: string): string => {
      const wall = floorWalls?.byId.get(id)
      if (wall !== undefined) return wall.ref
      const placement = derivedFloor?.placements.find((item) => item.id === id)
      if (placement !== undefined) return placement.label
      const room = floorRooms?.rooms.find((each) => each.id === id)
      if (room !== undefined) return room.name
      return id
    },
    [floorWalls, derivedFloor, floorRooms],
  )
  /**
   * The chain being drawn, or `null` (#64 §12). Local like the shape draft: a half-drawn chain is
   * not a proposal and must not survive a reload, a Floor change or the tool being put down.
   */
  const [wallDraft, setWallDraft] = useState<WallDraft | null>(null)
  /** The tool options (#64 §13): what the next Wall inherits. UI state, never Project data. */
  const [wallOptions, setWallOptions] = useState<{
    thickness: number
    justification: 'left' | 'centre' | 'right'
    classification: WallClassification | null
    constructionLabel: string
  }>({ thickness: 100, justification: 'centre', classification: null, constructionLabel: '' })

  const tool = useWorkspace((state) => state.activeTool)
  const setTool = useWorkspace((state) => state.setTool)
  // #70 §3: the strip's temporary filter and its notice — UI session state, reset with the saved view.
  const pickStates = useWorkspace((state) => state.pickStates)
  const hiddenToolNotice = useWorkspace((state) => state.hiddenToolNotice)
  const togglePickState = useWorkspace((state) => state.togglePickState)
  const showHiddenToolNotice = useWorkspace((state) => state.showHiddenToolNotice)
  const clearHiddenToolNotice = useWorkspace((state) => state.clearHiddenToolNotice)
  // §7c: the one Existing entity `Correct Existing Model…` has handed its handles and fields back.
  const correctionUnlocked = useWorkspace((state) => state.correctionUnlocked)
  const unlockCorrection = useWorkspace((state) => state.unlockCorrection)
  const lockCorrection = useWorkspace((state) => state.lockCorrection)
  // #70 §8: what the last click reached, and the candidates it left behind for the list.
  const cycle = useWorkspace((state) => state.cycle)
  const cycleCandidates = useWorkspace((state) => state.cycleCandidates)
  const setCycle = useWorkspace((state) => state.setCycle)
  const clearCycle = useWorkspace((state) => state.clearCycle)
  /**
   * The Room Outline being drawn, or `null` (#67 §4). Local like the Wall draft: a half-drawn
   * outline is not a proposal, and it must not survive a Floor change or the tool being put down.
   */
  const [roomDraft, setRoomDraft] = useState<PathDraft | null>(null)
  /** The Room whose Outline the open draft restates; `null` while drawing a new one (#67 §7). */
  const [roomDraftTarget, setRoomDraftTarget] = useState<string | null>(null)
  /** Which of the three shape tools is in hand: the one thing that says a Room is being drawn. */
  const drawTool = tool === 'line' || tool === 'arc' || tool === 'ellipticalArc' ? tool : null
  /** The fixed shelter entry, armed from `Shapes ▾` and placed by one click (#67 §17). */
  const [shelterArmed, setShelterArmed] = useState(false)
  const [shelterCentre, setShelterCentre] = useState<Pt | null>(null)
  /** A Room that has just been created gets its name field focused, with the text selected. */
  const [roomNameFocus, setRoomNameFocus] = useState(false)
  /**
   * The Edge whose list of Wall faces is open, and the face being previewed (#67 §10–§11). Local
   * like the draft: a preview is not a proposal the Project holds, and it belongs to the Room it
   * was opened for.
   */
  const [faceEdge, setFaceEdge] = useState<string | null>(null)
  /** The face being previewed, and the Room the preview was opened for. */
  const [facePick, setFacePick] = useState<{ roomId: string; candidate: RoomFaceCandidate } | null>(null)
  /** `Pick on canvas` is armed: the canvas offers every parallel face, however far away. */
  const [facePicking, setFacePicking] = useState(false)
  /**
   * The Rooms the live overlap check is asked about: this Floor's, in the shape the domain check
   * takes. A derived Room carries its own outline, but overlapping is a domain question (#67 §2).
   */
  const floorDomainRooms = useMemo(
    () => project.existingModel.rooms.filter((room) => room.floorId === floorId),
    [project.existingModel.rooms, floorId],
  )
  const draftOutline = roomDraft === null ? null : roomDraftOutline(roomDraft)
  const draftOverlap = roomOverlapPreview(roomDraftTarget, draftOutline, floorDomainRooms)
  const shelterProposal = shelterArmed && shelterCentre !== null ? shelterOutline(shelterCentre, 0) : null
  const shelterOverlap = roomOverlapPreview(null, shelterProposal, floorDomainRooms)
  /**
   * The attach preview: the Outline the Edge would take on the face it is pointing at, checked
   * like every other proposal so the picker and the canvas cannot disagree (#67 §11).
   */
  const facePreview = facePick?.candidate.outline ?? null
  const faceOverlap = roomOverlapPreview(facePick?.roomId ?? null, facePreview, floorDomainRooms)
  /** The one proposal the Plan View paints: the outline being drawn, or the shelter being aimed. */
  const roomProposal: RoomProposal | null = draftOutline !== null
    ? {
      id: ROOM_PROPOSAL,
      path: roomOutlineShapePath(draftOutline),
      blocked: draftOverlap.blocked,
      overlaps: draftOverlap.regions,
    }
    : facePreview !== null
      ? {
        id: ROOM_PROPOSAL,
        path: roomOutlineShapePath(facePreview),
        blocked: faceOverlap.blocked,
        overlaps: faceOverlap.regions,
      }
      : shelterProposal === null
      ? null
      : {
        id: ROOM_PROPOSAL,
        path: roomOutlineShapePath(shelterProposal),
        blocked: shelterOverlap.blocked,
        overlaps: shelterOverlap.regions,
      }
  /** The Outlines a draft snaps to, so a Room can be drawn corner-to-corner with its neighbour. */
  const roomSnapGeometry = useMemo(
    () => (floorRooms === null ? [] : floorRooms.rooms.map((room) => ({ path: room.path, name: room.name, ownerId: room.id }))),
    [floorRooms],
  )
  /**
   * The Opening being placed, or `null` (#65 §9). Local like the Wall draft: a ghost is not a
   * proposal, and it belongs to the tool and the Floor it was started on.
   */
  const [openingDraft, setOpeningDraft] = useState<OpeningDraft | null>(null)
  /** Where the tool's pointer stands; the ghost follows it, so it is state and not a ref. */
  const [openingCursor, setOpeningCursor] = useState<Pt | null>(null)
  const selection = useWorkspace((state) => state.selection)
  const select = useWorkspace((state) => state.select)
  /** The Wall the inspector edits, or `null` (#64 §14). A Wall and an Item are never both. */
  const wallSelection = useWorkspace((state) => state.wallSelection)
  const selectWall = useWorkspace((state) => state.selectWall)
  /** The Wall the inspector edits: its own numbers, its tidied length, its merge candidate. */
  const selectedWallData = wallSelection === null
    ? null
    : project.existingModel.walls.find((wall) => wall.id === wallSelection) ?? null
  const selectedWallDerived = selectedWallData === null || floorWalls === null
    ? null
    : floorWalls.byId.get(selectedWallData.id) ?? null
  const selectedWall = selectedWallData === null || selectedWallDerived === null || floorWalls === null
    ? null
    : {
        wall: selectedWallData,
        derived: selectedWallDerived,
        mergeableWith: mergeableNeighbour(project.existingModel.walls, floorWalls, selectedWallData.id),
      }
  const dragPreview = useWorkspace((state) => state.dragPreview)
  const setDragPreview = useWorkspace((state) => state.setDragPreview)
  /** The Opening the inspector edits, or `null` (#65 §11). One thing is inspected at a time. */
  const openingSelection = useWorkspace((state) => state.openingSelection)
  const selectOpening = useWorkspace((state) => state.selectOpening)
  /** This Floor's Openings, in the order the Project lists them. */
  const floorOpenings = useMemo(
    () => project.existingModel.openings.filter((opening) => opening.floorId === floorId),
    [project.existingModel.openings, floorId],
  )
  /**
   * The Openings resolved against their hosts for the Plan View (#65 §12), and the stretches
   * each Wall can still hold for the tool's aim (#65 §5). Both are recomputed when the Walls or
   * the Openings move, never on a pointer move.
   */
  const openingLayer = useMemo(
    () => wallOpenings(project.existingModel.walls, project.existingModel.wallJunctions, floorOpenings),
    [project.existingModel.walls, project.existingModel.wallJunctions, floorOpenings],
  )
  const usableByWall = useMemo(
    () => usableIntervals(project.existingModel.walls, project.existingModel.wallJunctions),
    [project.existingModel.walls, project.existingModel.wallJunctions],
  )
  /**
   * The Opening the inspector edits, with the two numbers its distance toggle needs and cannot
   * derive from the stored record alone: the far jamb the Plan View actually drew (an arc length
   * on an arc Wall, where the stored `width` stays the chord) and the host's own reference-line
   * length, which is what `Distance from end` counts back from (#65 §11).
   */
  const selectedOpening = useMemo(() => {
    if (openingSelection === null) return null
    const opening = floorOpenings.find((each) => each.id === openingSelection) ?? null
    if (opening === null) return null
    const host = project.existingModel.walls.find((wall) => wall.id === opening.hostWallId) ?? null
    if (host === null) return null
    const symbol = openingLayer.flatMap((wall) => wall.symbols).find((each) => each.id === opening.id) ?? null
    return {
      opening,
      host,
      end: symbol?.end ?? opening.start + opening.width,
      hostLength: usableByWall.get(host.id)?.length ?? 0,
    }
  }, [openingSelection, floorOpenings, project.existingModel.walls, openingLayer, usableByWall])
  /** The Room the inspector edits, or `null` (#67 behaviour 3). One thing is inspected at a time. */
  const roomSelection = useWorkspace((state) => state.roomSelection)
  const selectRoom = useWorkspace((state) => state.selectRoom)
  /** The Room and its measurements together: the record names it, the derive measures it. */
  const selectedRoom = useMemo(() => {
    if (roomSelection === null || floorRooms === null) return null
    const room = project.existingModel.rooms.find((each) => each.id === roomSelection) ?? null
    const derived = floorRooms.rooms.find((each) => each.id === roomSelection) ?? null
    return room === null || derived === null ? null : { room, derived }
  }, [roomSelection, floorRooms, project.existingModel.rooms])
  const angleSnap = useWorkspace((state) => state.snapSettings.angle)
  const snapSettings = useWorkspace((state) => state.snapSettings)
  /** The kinds the nine `Snaps ▾` rows switch on, recomputed only when a row changes. */
  const snapKinds = useMemo(() => enabledKindsOf(snapSettings), [snapSettings])
  // A half-drawn chain belongs to the tool and to the Floor it was started on (#64 §12). The same
  // holds for a Room Outline and for an armed shelter: putting the tool down puts the draft down.
  useEffect(() => {
    if (tool !== 'wall') setWallDraft(null)
    if (tool !== 'line' && tool !== 'arc' && tool !== 'ellipticalArc') {
      setRoomDraft(null)
      setRoomDraftTarget(null)
    }
    if (tool !== 'select') {
      setShelterArmed(false)
      setShelterCentre(null)
      setFaceEdge(null)
      setFacePick(null)
    }
  }, [tool])
  useEffect(() => {
    setWallDraft(null)
    setRoomDraft(null)
    setRoomDraftTarget(null)
    setShelterArmed(false)
    setShelterCentre(null)
    setFaceEdge(null)
    setFacePick(null)
  }, [floorId])
  // A preview belongs to the Room it was opened for: selecting another Room, or nothing, changing
  // Floor, or putting the Select tool down puts it down — the canvas must not go on painting an
  // attach nobody is looking at, nor offer faces for an Edge whose list is shut.
  useEffect(() => {
    setFaceEdge(null)
    setFacePick(null)
    setFacePicking(false)
  }, [roomSelection, floorId, tool])
  useEffect(() => {
    // Entering the tool hands it its draft. The aim needs the row being placed, so a tool that
    // waited for the picker to be touched before it knew what it was placing would draw no ghost
    // and place nothing at all. Leaving it, or the Floor under it, takes the draft back.
    setOpeningDraft(tool === 'opening' ? emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID) : null)
    setOpeningCursor(null)
  }, [tool, floorId])
  /** What the next Wall gets: the tool options plus the Floor's or Project's default height (#64 §16). */
  const wallDefaults = {
    ...wallOptions,
    baseElevation: 0,
    height: floor?.defaultWallHeight ?? project.preferences.defaultWallHeight,
  }
  const designPreview = useWorkspace((state) => state.designPreview)
  const setDesignPreview = useWorkspace((state) => state.setDesignPreview)
  const pickingOrigin = useWorkspace((state) => state.pickingOrigin)
  const setPickingOrigin = useWorkspace((state) => state.setPickingOrigin)
  const openItemDetail = useWorkspace((state) => state.openItemDetail)
  const viewKey = view === null ? null : planViewKey(view)
  const viewport = useWorkspace((state) => (viewKey === null ? undefined : state.viewports[viewKey]))
  const hydrated = useWorkspace((state) => (viewKey === null ? true : state.hydrated[viewKey] === true))
  const railOpen = useWorkspace((state) => state.railOpen)
  const setRailOpen = useWorkspace((state) => state.setRailOpen)
  /** The faces the open Edge may claim, nearest first, within twelve CSS pixels of reach (#67 §10). */
  const faceCandidates = useMemo(() => {
    if (faceEdge === null || roomSelection === null || floorWalls === null) return []
    const room = project.existingModel.rooms.find((each) => each.id === roomSelection)
    if (room === undefined) return []
    // The canvas reports its own millimetres per pixel, so zooming in reaches further across the
    // Floor and zooming out less — the reach is a screen distance, never a fixed number of mm.
    return roomFaceCandidates(room, faceEdge, floorWalls, floorDomainRooms, SNAP_ACQUISITION_PX / (viewport?.zoom ?? 1))
  }, [faceEdge, roomSelection, floorWalls, floorDomainRooms, viewport?.zoom])
  /**
   * What `Pick on canvas` offers: every face parallel to the Edge, however far away. The reach is
   * the list's, not the canvas's — a band twelve pixels wide is aimed at by eye, and the Flat may
   * hold the right face on the far side of the house (#67 §10).
   */
  const facePickCandidates = useMemo(() => {
    if (!facePicking || faceEdge === null || roomSelection === null || floorWalls === null) return []
    const room = project.existingModel.rooms.find((each) => each.id === roomSelection)
    if (room === undefined) return []
    return roomFaceCandidates(room, faceEdge, floorWalls, floorDomainRooms, Number.POSITIVE_INFINITY)
  }, [facePicking, faceEdge, roomSelection, floorWalls, floorDomainRooms])

  const hostRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [isCalibrating, setIsCalibrating] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [pendingDistancePx, setPendingDistancePx] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [manageFloorsOpen, setManageFloorsOpen] = useState(false)
  const [deleteFloorId, setDeleteFloorId] = useState<string | null>(null)
  const [duplicateFloorId, setDuplicateFloorId] = useState<string | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [newItemOpen, setNewItemOpen] = useState(false)
  const [forkOpen, setForkOpen] = useState(false)

  const narrow = useNarrow()
  const uncalibrated = floorNeedsCalibration(planImage)

  // Another Project opened: its placements, Floors and open view are not this one's. The store
  // was already emptied when its Project was opened (`WorkspaceProvider` owns that), so arriving
  // here from Item Detail — which unmounts this view and mounts it again — keeps the Placed Item
  // the back link navigated to (#57 §6).
  useEffect(() => {
    let live = true
    void services.viewportCache.readActive().then((active) => {
      if (!live) return
      workspaceStore.getState().hydrateActive(
        active?.floorId ?? null,
        decodeActiveViews(session.getSnapshot().project, active?.viewsByFloor ?? {}),
      )
    })
    return () => {
      live = false
    }
  }, [session.id, services])

  // …and the open pair goes back the way it came: one record per Project, device-local.
  useEffect(() => {
    if (!activeHydrated) return
    services.viewportCache.writeActive({ floorId, viewsByFloor: encodeActiveViews(project, viewsByFloor) })
  }, [activeHydrated, floorId, viewsByFloor, project, services])

  // Undo and redo navigate to what they touched (#26): the Floor and view the edit was about.
  // An Edit Transaction that touched no Floor — a Project preference — leaves the pointer
  // where it was rather than blanking the Plan View, and arriving back at the pair already on
  // screen is the common case, so it changes nothing at all: the Placed Item the transaction
  // was about stays selected, which is what lets it be edited back.
  useEffect(() => {
    const openFloorId = floorId
    const openViewId = view?.id ?? null
    return session.onNavigate((locator) => {
      if (locator.floorId === null) return
      if (locator.floorId === openFloorId && (locator.viewId === null || locator.viewId === openViewId)) return
      workspaceStore.getState().setActiveFloor(locator.floorId, locator.viewId)
    })
  }, [session, floorId, view?.id])

  const setViewport = useCallback((next: Viewport) => {
    if (viewKey === null) return
    workspaceStore.getState().setViewport(viewKey, next)
    services.viewportCache.write(viewKey, next)
  }, [viewKey, services])

  // The cache answers once per view key; no entry leaves `Fit` to the canvas.
  useEffect(() => {
    if (viewKey === null || hydrated) return
    let live = true
    void services.viewportCache.read(viewKey).then((cached) => {
      if (!live) return
      if (cached !== undefined) workspaceStore.getState().setViewport(viewKey, cached)
      workspaceStore.getState().markHydrated(viewKey)
    })
    return () => {
      live = false
    }
  }, [viewKey, hydrated, services])

  const fit = (): void => {
    const el = hostRef.current
    if (el === null) return
    const { width, height } = el.getBoundingClientRect()
    if (width <= 0 || height <= 0) return
    setViewport(fitViewport(width, height, image?.widthMm ?? 800, image?.heightMm ?? 600))
  }

  /**
   * The active Floor's warnings, under the Existing-only option (#66 §11).
   *
   * The engine memoises on `(revision, floorId, optionId)` itself, so this is a pointer at the
   * cached answer rather than a recompute; and because a warning is a function of the model
   * alone, nothing the reader does to the view — pan, zoom, another saved view, the strip
   * itself — can move a status (#66 criterion 2).
   */
  const floorWarnings = useMemo<readonly Warning[]>(
    () => (floorId === null ? [] : deriveWarnings(project, floorId, null).warnings),
    [project, floorId],
  )

  /**
   * Select what a warning is about and put all of it on screen (#66 §13).
   *
   * Navigation, never an Edit Transaction: no Intent, so no history entry and no revision
   * change, which is what lets a person walk the whole list with an Undo stack that never
   * grows. A warning standing on another Floor opens that Floor first, because a selection
   * the reader cannot see is not a locate.
   */
  const locateWarning = (warning: Warning): void => {
    if (warning.floorId !== floorId) workspaceStore.getState().setActiveFloor(warning.floorId, null)
    const primary = warning.subjects[0]
    if (primary !== undefined) {
      if (primary.type === 'wall') selectWall(primary.id)
      else if (primary.type === 'opening') selectOpening(primary.id)
      else select(primary.id)
    }
    const el = hostRef.current
    if (el === null) return
    const { width, height } = el.getBoundingClientRect()
    if (width <= 0 || height <= 0) return
    const box = warningBox(warning, project, derivedFloor?.placements ?? [])
    if (box === null) return
    setViewport(fitRect(width, height, box))
  }

  /**
   * One badge per entity the open warnings name (#66 §14). Acknowledged warnings contribute
   * nothing — criterion 7's "acknowledged warnings show none" is this one filter — and an entity
   * named by three warnings still gets exactly one, because the map is keyed by the entity.
   */
  const warningSubjects = useMemo<readonly BadgeSubject[]>(() => {
    const boxes = new Map<string, Box>()
    for (const warning of floorWarnings) {
      if (warning.status === 'acknowledged') continue
      const boxesOf = subjectBoxes(warning, project, derivedFloor?.placements ?? [])
      for (let index = 0; index < warning.subjects.length; index += 1) {
        const id = warning.subjects[index]!.id
        const box = boxesOf[index]
        if (box !== undefined && !boxes.has(id)) boxes.set(id, box)
      }
    }
    return [...boxes].map(([id, bounds]) => ({ id, bounds }))
  }, [floorWarnings, project, derivedFloor])

  /**
   * Which row the strip must show, and how many times it has been asked (#66 §14).
   *
   * The counter is not decoration: clicking the same badge twice has to scroll there twice, and
   * a prop that compared equal would do nothing the second time.
   */
  const [warningFocus, setWarningFocus] = useState<{ key: string; nonce: number } | null>(null)

  /**
   * A badge was clicked: open the strip and put that entity's first row in view.
   *
   * The key is the warning's, not the entity's, so the strip scrolls to the *first* row of the
   * entity it was asked about rather than to whichever row the engine happened to list first.
   */
  const selectWarningBadge = useCallback((id: string): void => {
    const first = floorWarnings.find((warning) => warning.status !== 'acknowledged'
      && warning.subjects.some((subject) => subject.id === id))
    if (first === undefined) return
    setWarningFocus((previous) => ({ key: first.key, nonce: (previous?.nonce ?? 0) + 1 }))
  }, [floorWarnings])

  /**
   * One transaction, and the two renovation answers a refusal can lead to (#70 §7a, criterion 26).
   *
   * Both are dark unless the flag is on, and both rest on the same fact: the Existing Model is the
   * baseline every Design Option is drawn against, so outside the Existing display an edit of it is
   * refused instead of run. A refusal is exactly the moment to ask — nothing has been committed, the
   * revision is where it was, and Cancel changes nothing. In the Existing display the same edit is
   * today's bare rejection: there the baseline is what a person is working on (#70 §7c).
   */
  const sendIntent = (intent: Intent): void => {
    if (FF_RENOVATION) {
      const demolition = deleteAsDemolition(intent)
      if (demolition !== null) {
        dispatch(demolition)
        return
      }
    }
    const result = dispatch(intent)
    if (!FF_RENOVATION || result.ok) return
    if (result.code === 'layer-blocked') {
      // New content had nowhere it was allowed to go (#71 §2): the tool's own press is undone, the
      // revision never moved, and the notice says which layer stood in the way and what would move it.
      const problem = result.problems[0]
      if (problem !== undefined) showHiddenToolNotice(problem.message)
      return
    }
    if (result.code !== 'baseline-correction-required') return
    const entityId = subjectOfIntent(intent)
    if (renovationOptionId === null) return
    if (renovationDisplayNow === 'existing') {
      // The Existing display is where a survey edit is meant, so a refusal there is never noise about
      // a stray drag: it is the one edit this build cannot answer alone, whether the person unlocked
      // the record's fields (§7c), pressed `Delete` on it, or drew a new record with a survey tool.
      // The answer owed is what the change does to every Design Option (#70 §7b, §7e) — and a tool
      // that has not drawn the record yet gives the refusal no subject to name.
      openCorrectExistingDialog(intent, entityId)
      return
    }
    // A refusal in a Design Option's own display is the forced choice: replace the record with a
    // Design Option entity, or correct the Existing Model. Both answers need the entity that was
    // refused, so a refusal naming none has no choice to offer.
    if (entityId === null) return
    openForcedChoiceDialog(intent, entityId, renovationDisplayNow, renovationOptionId)
  }
  const send = <T extends IntentType>(type: T, payload: PayloadOf<T>): void => {
    sendIntent(services.intent.build(type, payload))
  }
  /**
   * The same transaction with a label that names what was chosen (#70 §2). Only the caller knows
   * which Design Option or Renovation Display was clicked, and the undo tooltip has to say so.
   */
  const sendLabelled = <T extends IntentType>(type: T, payload: PayloadOf<T>, label: string): void => {
    sendIntent(services.intent.build(type, payload, label))
  }

  /**
   * `Delete` of an Existing entity outside the Existing display, turned into the demolition record it
   * means (criterion 26): the survey keeps what it said and this Option records that it takes the
   * entity down. `null` says send the Intent as asked — inside the Existing display, where deleting
   * from the baseline is the job, or for an entity that is not baseline work, or for a command that
   * is not a delete.
   */
  const deleteAsDemolition = (intent: Intent): Intent | null => {
    if (renovationDisplayNow === 'existing' || renovationOptionId === null) return null
    if (!DELETES_ARE_DEMOLITIONS.includes(intent.type)) return null
    const entityId = subjectOfIntent(intent)
    if (entityId === null || renovationStates?.get(entityId) !== 'existing') return null
    const ref = entityFields(project, entityId)?.ref ?? entityId
    return services.intent.build(
      'renovation.demolish',
      { entityId, target: { designOptionId: renovationOptionId } },
      RENOVATION_STRINGS.markDemolitionLabel(ref),
    )
  }

  /**
   * A Replace that landed: the successor it wrote takes the inspector as soon as the Project does,
   * because the work a person is about to do belongs to the successor, not to the baseline record
   * that has just become a memory of it (#70 §7a, §7e).
   */
  const pendingReplace = useRef<{ predecessorId: string; optionId: string } | null>(null)
  useEffect(() => {
    const pending = pendingReplace.current
    if (pending === null) return
    pendingReplace.current = null
    const proposed = designOptionsOf(project).find((each) => each.id === pending.optionId)?.proposed
    const hit = proposed === undefined ? null : successorOf(proposed, pending.predecessorId)
    if (hit === null) return
    if (hit.kind === 'wall') selectWall(hit.id)
    else if (hit.kind === 'opening') selectOpening(hit.id)
    else if (hit.kind === 'room') selectRoom(hit.id)
    else select(hit.id)
  }, [project])

  /**
   * The `Move to a Design Option…` action for the Existing entity being inspected (#69 §13).
   *
   * A flagged build only: with the flag off there is no such command, and the branch is gone before
   * the bundle is written. Whether the action shows at all is the component's question — it stays
   * hidden while the Project holds no Option, because a move with nowhere to go can only be refused.
   */
  const renovationAction = (entityId: string): ReactNode =>
    FF_RENOVATION ? <MoveToOptionAction entityId={entityId} /> : null

  /**
   * A Room the workspace has just created takes the inspector, and its name field takes the
   * keyboard with its text selected (#67 §4). The id is not handed back by the Intent, so the new
   * Room is the one the Project did not have a moment ago.
   */
  const knownRooms = useRef<ReadonlySet<string>>(new Set())
  const pendingRoomFocus = useRef(false)
  useEffect(() => {
    const ids = new Set(project.existingModel.rooms.map((room) => room.id))
    const fresh = [...ids].filter((id) => !knownRooms.current.has(id))
    knownRooms.current = ids
    if (!pendingRoomFocus.current) return
    pendingRoomFocus.current = false
    const created = fresh[fresh.length - 1]
    if (created === undefined) return
    selectRoom(created)
    setRoomNameFocus(true)
  }, [project.existingModel.rooms, selectRoom])

  /**
   * `Close` on a Room draft: one Room, one Intent, one undo step (#67 §4).
   *
   * A draft opened on empty Floor creates; one opened with a Room selected restates that Room,
   * which is the same overlap-checked path a Shape-tab edit follows. The overlay has already
   * refused to close a proposal that overlaps, and the Intent checks again — the model cannot be
   * reached with an overlap by any route.
   */
  const commitRoomDraft = (outline: RoomOutlineShape): void => {
    if (floorId === null) return
    if (roomDraftTarget === null) {
      pendingRoomFocus.current = true
      send('room.create', { floorId, outline })
    } else {
      send('room.setOutline', { roomId: roomDraftTarget, outline })
    }
    setRoomDraft(null)
    setRoomDraftTarget(null)
    setTool('select')
  }

  /**
   * The click that places the household shelter: Room, four Walls, four references and one door,
   * in one transaction (#67 §17). The orientation is the pack's own — the Shape tab's Orientation
   * field is where a turned shelter comes from, and it is editable afterwards like everything else
   * the entry creates.
   */
  const placeShelter = (centre: Pt): void => {
    if (floorId === null) return
    send('room.placeShelter', { floorId, centre, orientationDeg: 0 })
    setShelterArmed(false)
    setShelterCentre(null)
  }

  /**
   * One Edit Transaction per decision (#66 §6).
   *
   * The subjects go in sorted, not in the engine's primary-first order: the key sorts them, and
   * a record stored in display order would be a second key for the same warning the moment two
   * Walls changed refs.
   */
  const acknowledgeWarning = (warning: Warning, note: string): void => {
    send('warning.acknowledge', {
      warningType: warning.type,
      subjectIds: warning.subjects.map((subject) => subject.id).sort(),
      designOptionId: warning.optionId,
      signature: warning.signature,
      note,
    })
  }

  const editWarningNote = (warning: Warning, note: string): void => {
    send('warning.editNote', {
      warningType: warning.type,
      subjectIds: warning.subjects.map((subject) => subject.id).sort(),
      designOptionId: warning.optionId,
      note,
    })
  }

  /**
   * Where the Opening would go if the pointer were here (#65 §10). The reach is a fixed number
   * of pixels rather than millimetres, so the tool is as forgiving zoomed out as zoomed in, and
   * the answer comes from the same kernel the Intent consults — a ghost the click would refuse
   * is the one bug this file exists to prevent.
   */
  const aimAtOpening = (cursor: Pt | null): OpeningAim | null => {
    if (cursor === null || openingDraft === null) return null
    const { walls, wallJunctions } = project.existingModel
    return openingAim(cursor, openingDraft, {
      walls,
      junctions: wallJunctions,
      usable: usableByWall,
      preset: openingPresetRow(openingDraft.presetId),
      hostHeightOf: (wallId) => walls.find((wall) => wall.id === wallId)?.height ?? 0,
      reach: 12 / (viewport?.zoom ?? 1),
      refOf: (wallId) => walls.find((wall) => wall.id === wallId)?.ref ?? wallId,
      format: (mm) => readoutMm(mm, project.preferences.displayUnit, project.preferences.displayPrecision),
    })
  }

  /**
   * The click that lands on a valid preview: one Opening, one Intent, one undo step (#26). The
   * label is the next free one of its kind, because a person placing six doors is not going to
   * name six doors.
   */
  const placeOpening = (aim: OpeningAim): void => {
    if (floorId === null) return
    const row = openingPresetRow(openingDraft?.presetId ?? DEFAULT_OPENING_PRESET_ID)
    const host = project.existingModel.walls.find((wall) => wall.id === aim.hostWallId)
    const preset = resolveOpeningPreset(row, host?.height ?? 0)
    send('opening.create', {
      floorId,
      hostWallId: aim.hostWallId,
      kind: preset.kind,
      label: nextOpeningLabel(project.existingModel.openings, preset.kind),
      start: aim.start,
      width: preset.width,
      sill: preset.sill,
      head: preset.head,
      ...(preset.swing === undefined ? {} : { swing: preset.swing, hingeSide: 'start' }),
    })
  }

  /**
   * A click on the Floor while the Door / window tool is in hand: place where the ghost stands,
   * and where it does not fit do nothing at all — the bar has already said why in the sentence
   * that names the Opening and the Wall (#65 criterion 1). The aim is recomputed for the point
   * clicked rather than trusted from the last pointer move, because a click can be handled before
   * the move that preceded it has been rendered.
   */
  const clickOnCanvas = (at: Pt): void => {
    if (tool !== 'opening') return
    const aimed = aimAtOpening(at)
    if (aimed !== null && aimed.fits) placeOpening(aimed)
  }

  /** The ghost for where the pointer stands now, in the shape the Wall list takes (#65 §10). */
  const openingAimNow = aimAtOpening(openingCursor)
  const openingPreview: OpeningPreview | null = openingAimNow === null
    ? null
    : { symbols: [openingAimNow.symbol], blocked: !openingAimNow.fits, gap: openingAimNow.violated }

  /**
   * The delete a Wall with Openings has to be answered before it runs (#65 §8). The button asks
   * the question by asking the same kernel the Intent consults what it would take with it, and
   * the ids the answer lists are what the confirmed Intent carries back — so an Opening added
   * after the question was asked makes the answer stale, and the Intent is refused rather than
   * deleting something nobody agreed to.
   */
  const [deleteReview, setDeleteReview] = useState<DeleteWallReview | null>(null)
  const deleteWall = (wallId: string): void => {
    const { review } = services.intent.preview(project, services.intent.build('wall.delete', { wallId }))
    // `wall.delete` answers with the Wall review or nothing; the Option review of #69 is another
    // dialog's business and never arrives here.
    if (review?.kind === 'delete-wall') {
      setDeleteReview(review)
      return
    }
    send('wall.delete', { wallId })
    selectWall(null)
  }
  const confirmDeleteWall = (): void => {
    if (deleteReview === null) return
    send('wall.delete', {
      wallId: deleteReview.wallId,
      openings: deleteReview.openings.map((opening) => opening.id),
    })
    setDeleteReview(null)
    selectWall(null)
  }

  const selected = items.find((item) => item.id === selection) ?? null
  const selectedDesign = selected === null
    ? null
    : project.itemDesigns.find((design) => design.id === selected.designId) ?? null

  /** Where the Item Origin stands: what a drag and `Position X` / `Position Y` both mean. */
  const setPosition = (x: number, y: number): void => {
    if (selection === null) return
    send('plan.movePlacement', { placedItemId: selection, translation: { x, y } })
  }

  /** One turn about the Item Origin; the handler normalises to `[0, 360)`. */
  const setRotation = (rotationDeg: number): void => {
    if (selection === null) return
    send('plan.rotatePlacement', { placedItemId: selection, rotationDeg })
  }

  /**
   * An Item Design edit is shared, so more than one placement opens the preview (D3) and
   * nothing is written until `Apply`. With one placement there is nothing to preview.
   */
  const editDesign = (edit: DesignEdit): void => {
    if (selected === null) return
    if (selected.placementCount <= 1) {
      send('design.update', { itemDesignId: selected.designId, patch: edit })
      return
    }
    setDesignPreview({
      itemDesignId: selected.designId,
      origin: designPreview?.origin ?? null,
      name: edit.name ?? designPreview?.name ?? null,
      footprint: designPreview?.footprint ?? null,
      color: edit.color ?? designPreview?.color ?? null,
    })
  }

  /** An Item Origin choice always previews: the footprints stay put, the markers move. */
  const previewOrigin = (origin: Point2): void => {
    if (selected === null) return
    setDesignPreview({
      itemDesignId: selected.designId,
      origin,
      name: null,
      footprint: null,
      color: null,
    })
    setPickingOrigin(false)
  }

  const applyPreview = (): void => {
    if (designPreview === null) return
    const { itemDesignId, origin, name, footprint, color } = designPreview
    setDesignPreview(null)
    setPickingOrigin(false)
    if (origin !== null) {
      send('design.setOrigin', { itemDesignId, origin })
      return
    }
    if (footprint !== null) {
      send('design.setFootprint', { itemDesignId, footprint })
      return
    }
    send('design.update', {
      itemDesignId,
      patch: {
        ...(name === null ? {} : { name }),
        ...(color === null ? {} : { color }),
      },
    })
  }

  const cancelPreview = (): void => {
    setDesignPreview(null)
    setPickingOrigin(false)
  }

  /** `Fork design…`: the placement gets its own deep copy and the selection follows it. */
  const forkDesign = (name: string): void => {
    if (selected === null) return
    const originalDesignId = selected.designId
    send('design.fork', { placedItemId: selected.id, name })
    setForkOpen(false)
    const next = session.getSnapshot().project
    const design = next.itemDesigns.find((candidate) => candidate.id !== originalDesignId && candidate.name === name)
    const placed = next.existingModel.placedItems.find((placement) => placement.itemDesignId === design?.id)
    select(placed?.id ?? null)
  }

  const openDetail = (): void => {
    if (selected === null || floorId === null || view === null) return
    openItemDetail(selected.designId, { floorId, viewId: view.id, placedItemId: selected.id })
  }

  const addObject = (catalogKey: string): void => {
    if (floorId === null) return
    send('plan.addObject', { floorId, catalogKey })
    select(lastPlacedId(session.getSnapshot().project, floorId))
  }

  /** Placing a design from the library is reuse: the same design, one more placement. */
  const placeDesign = (itemDesignId: string): void => {
    if (floorId === null) return
    send('plan.placeDesign', { floorId, itemDesignId })
    select(lastPlacedId(session.getSnapshot().project, floorId))
  }

  /** `New item…` authors a design nobody has placed, then places this one copy. */
  const addItemDesign = (label: string, w: number, h: number, color: string): void => {
    if (floorId === null) return
    send('plan.addTemplate', { label, w, h, color })
    setNewItemOpen(false)
    select(lastPlacedId(session.getSnapshot().project, floorId))
  }

  // `[` and `]` turn the selected Placed Item a quarter turn about its Item Origin, and
  // Escape backs out of a pending design preview or a disarmed `Pick on canvas` (#57 §4).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // An unlocked correction is abandoned first: the handles and fields shut again and nothing
        // was written, which is the whole point of the press being reversible (#70 criterion 20).
        if (FF_RENOVATION && correctionUnlocked !== null) {
          event.preventDefault()
          lockCorrection()
          return
        }
        // A running overlap cycle backs out first: Esc ends the cycle (#70 criterion 18) and the
        // selection it made stays, because the click that made it was a real selection.
        if (FF_RENOVATION && cycle !== null) {
          event.preventDefault()
          clearCycle()
          return
        }
        // The Door / window tool backs out first: its controls float over the canvas and hold no
        // focus of their own to take the key (#65 §9).
        if (tool === 'opening') {
          event.preventDefault()
          setOpeningDraft(null)
          setOpeningCursor(null)
          setTool('select')
          return
        }
        if (designPreview === null && !pickingOrigin) return
        event.preventDefault()
        setDesignPreview(null)
        setPickingOrigin(false)
        return
      }
      const target = event.target as HTMLElement | null
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      // Enter places the Opening the ghost is standing on, exactly as a click there would.
      if (tool === 'opening') {
        if (event.key !== 'Enter') return
        event.preventDefault()
        if (openingAimNow !== null && openingAimNow.fits) placeOpening(openingAimNow)
        return
      }
      if (selected === null) return
      if (event.key === '[') send('plan.rotatePlacement', { placedItemId: selected.id, rotationDeg: quarterTurn(selected.rotationDeg, -1) })
      if (event.key === ']') send('plan.rotatePlacement', { placedItemId: selected.id, rotationDeg: quarterTurn(selected.rotationDeg, 1) })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, designPreview, pickingOrigin, setDesignPreview, setPickingOrigin, send, tool, openingAimNow, placeOpening, setTool, cycle, clearCycle, correctionUnlocked, lockCorrection])

  const commitImage = (prepared: PreparedPlanImage): void => {
    const asset = prepared.asset
    if (asset === null || floorId === null) return
    services.assetUrls.put(asset.sha256, asset.bytes)
    const sessionAsset: SessionAsset = {
      sha256: asset.sha256,
      bytes: asset.bytes,
      mediaType: asset.mediaType,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
    }
    dispatch(
      services.intent.build('plan.setImage', {
        floorId,
        image: {
          assetHash: asset.sha256,
          mediaType: asset.mediaType,
          widthPx: asset.widthPx,
          heightPx: asset.heightPx,
        },
      }),
      [sessionAsset],
    )
  }

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (file === undefined) return
    setUploadError(null)
    if (!file.type.startsWith('image/')) {
      setUploadError(STRINGS.imageInvalidFile)
      input.value = ''
      return
    }
    if (file.size > MAX_PLAN_IMAGE_BYTES) {
      setUploadError(STRINGS.imageTooLarge)
      input.value = ''
      return
    }
    const read = await services.readPlanImage(file)
    input.value = ''
    if ('message' in read) {
      setUploadError(STRINGS.notAnImage)
      return
    }
    // A new picture never clears the objects drawn over it (#56): the upload is the upload.
    // Replacing one resets the scale, because the old one described different pixels.
    commitImage(read.image)
  }

  const openExport = (): void => {
    select(null)
    setIsExporting(true)
  }

  const openFloor = (nextFloorId: string): void => {
    const next = resolvePlanView(project, nextFloorId, viewsByFloor[nextFloorId] ?? null)
    workspaceStore.getState().setActiveFloor(nextFloorId, next?.id ?? null)
  }

  const openView = (viewId: string): void => {
    if (floorId === null) return
    workspaceStore.getState().setActiveView(floorId, viewId)
  }

  const addPlanView = (name: string): void => {
    if (floorId === null) return
    send('view.create', { floorId, name })
    const created = session.getSnapshot().project.views.find(
      (candidate) => candidate.floorId === floorId && candidate.name === name.trim(),
    )
    if (created !== undefined) workspaceStore.getState().setActiveView(floorId, created.id)
  }

  const addFloor = (): void => {
    send('floor.create', {})
    const floors = session.getSnapshot().project.floors
    const created = floors[floors.length - 1]
    if (created !== undefined) {
      const createdView = session.getSnapshot().project.views.find(
        (candidate) => candidate.floorId === created.id && candidate.isDefault,
      )
      workspaceStore.getState().setActiveFloor(created.id, createdView?.id ?? null)
    }
  }

  const duplicateFloor = (input: DuplicateFloorInput): void => {
    if (duplicateFloorId === null) return
    send('floor.duplicate', { floorId: duplicateFloorId, ...input })
    setDuplicateFloorId(null)
    const after = session.getSnapshot().project
    const created = after.floors.find((candidate) => candidate.name === input.name)
    if (created !== undefined) {
      const createdView = after.views.find((candidate) => candidate.floorId === created.id && candidate.isDefault)
      workspaceStore.getState().setActiveFloor(created.id, createdView?.id ?? null)
    }
  }

  const deleteFloor = (targetId: string): void => {
    const index = project.floors.findIndex((candidate) => candidate.id === targetId)
    send('floor.delete', { floorId: targetId })
    setDeleteFloorId(null)
    setManageFloorsOpen(false)
    // The Floor is gone, so the pointer has to move somewhere that exists: the neighbour the
    // deleted Floor sat next to, which is the one the person was reading past.
    const remaining = session.getSnapshot().project.floors
    const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? null
    workspaceStore.getState().setActiveFloor(
      next?.id ?? null,
      next === null ? null : resolvePlanView(session.getSnapshot().project, next.id, null)?.id ?? null,
    )
  }

  /** The delete dialog's `Show`: open the thing that is leaning on this Floor. */
  const showDependant = (kindId: string): void => {
    if (deleteFloorId === null) return
    const target = session.getSnapshot().project
    if (kindId === 'planViews') {
      const named = target.views.find((candidate) => candidate.floorId === deleteFloorId && !candidate.isDefault)
      workspaceStore.getState().setActiveFloor(deleteFloorId, named?.id ?? null)
    } else {
      const fallback = resolvePlanView(target, deleteFloorId, null)
      workspaceStore.getState().setActiveFloor(deleteFloorId, fallback?.id ?? null)
      if (kindId === 'placedItems') {
        const first = target.existingModel.placedItems.find((item) => item.floorId === deleteFloorId)
        select(first?.id ?? null)
      }
    }
    setDeleteFloorId(null)
    setManageFloorsOpen(false)
  }

  const transfer = (mode: 'copy' | 'move', target: TransferTarget): void => {
    if (selection === null) return
    send(mode === 'copy' ? 'plan.copyToFloor' : 'plan.moveToFloor', {
      placedItemIds: [selection],
      toFloorId: target.floorId,
      translation: { x: target.x, y: target.y },
      baseElevation: target.baseElevation,
    })
    setTransferOpen(false)
    select(null)
    const after = session.getSnapshot().project
    workspaceStore.getState().setActiveFloor(
      target.floorId,
      resolvePlanView(after, target.floorId, null)?.id ?? null,
    )
  }

  const groups: ToolbarGroup[] = [
    {
      id: 'tools',
      width: 196,
      label: STRINGS.tools,
      content: (
        <>
          {WORKSPACE_TOOLS.map((definition) => {
            const gated = toolIsGated(definition, planImage)
            return (
              <button
                key={definition.id}
                type="button"
                data-testid={definition.testId}
                aria-pressed={tool === definition.id ? 'true' : 'false'}
                title={toolTitle(definition, planImage)}
                className="bb-workspace-tool-button"
                disabled={gated}
                onClick={() => setTool(definition.id)}
              >
                {definition.label}
              </button>
            )
          })}
        </>
      ),
    },
    {
      /**
       * `Shapes ▾` (#67 §4, §17): the three drawing tools that make a Room Outline, then the
       * shipped pack's own entry. The group is the pack's, not a list of hard-coded objects — a
       * second pack would fill the same menu from its own manifest.
       */
      id: 'shapes',
      width: 124,
      label: STRINGS.shapes,
      content: (
        <ToolbarMenu label={STRINGS.shapes} testId="shapes-menu">
          {DRAW_TOOLS.map((definition) => (
            <ToolbarMenuItem
              key={definition.id}
              label={definition.label}
              testId={definition.testId}
              title={toolTitle(definition, planImage)}
              disabled={toolIsGated(definition, planImage)}
              onSelect={() => {
                setShelterArmed(false)
                // A Room selected first is the Room this Outline restates (#67 §7); on empty
                // Floor the same clicks draw a new one.
                setRoomDraftTarget(roomSelection)
                setTool(definition.id)
              }}
            />
          ))}
          <div className="bb-workspace-menu-heading">{shelterPackName()}</div>
          <ToolbarMenuItem
            label={shelterName()}
            testId="place-household-shelter"
            title={floorNeedsCalibration(planImage) ? CALIBRATION_REQUIRED_HINT : undefined}
            disabled={floorNeedsCalibration(planImage)}
            onSelect={() => {
              setRoomDraft(null)
              setRoomDraftTarget(null)
              setShelterCentre(null)
              setShelterArmed(true)
              setTool('select')
            }}
          />
        </ToolbarMenu>
      ),
    },
    {
      id: 'add',
      width: 112,
      label: STRINGS.addItem,
      content: (
        <ToolbarMenu label={STRINGS.addItem} testId="add-item-menu">
          {/* Three sections (#57 §3): what this Project already has, the shipped catalogue,
              and the one way to author a shape of your own. */}
          <div className="bb-workspace-menu-heading">{STRINGS.inThisProject}</div>
          {library.length === 0 && (
            <div className="bb-workspace-library-item" data-testid="library-empty">{STRINGS.nothingHereYet}</div>
          )}
          {library.map((entry) => (
            <button
              key={entry.itemDesignId}
              type="button"
              className="bb-workspace-library-item"
              data-testid={`add-design-${entry.itemDesignId}`}
              onClick={() => placeDesign(entry.itemDesignId)}
            >
              <span className="bb-workspace-library-swatch" style={{ background: entry.color }} />
              <span className="bb-workspace-library-name">{entry.label}</span>
              <span className="bb-workspace-library-meta">
                {entry.isCabinet ? STRINGS.cabinet : `${Math.round(entry.width)} × ${Math.round(entry.depth)}`}
              </span>
              <span className="bb-workspace-library-meta" data-testid={`library-count-${entry.itemDesignId}`}>
                {entry.placementCount}
              </span>
            </button>
          ))}
          <div className="bb-workspace-menu-heading">{STRINGS.catalog}</div>
          {services.planCatalogue.map((option) => (
            <ToolbarMenuItem
              key={option.key}
              label={option.label}
              testId={`add-${option.key}`}
              onSelect={() => addObject(option.key)}
            />
          ))}
          <ToolbarMenuItem label={STRINGS.newItemEllipsis} testId="add-new-item" onSelect={() => setNewItemOpen(true)} />
        </ToolbarMenu>
      ),
    },
    {
      id: 'plan-image',
      width: 132,
      label: STRINGS.planImage,
      content: (
        <ToolbarMenu label={STRINGS.planImage} testId="plan-image-menu">
          <ToolbarMenuItem
            label={STRINGS.uploadEllipsis}
            testId="upload-image"
            disabled={planImage !== null}
            onSelect={() => fileInputRef.current?.click()}
          />
          <ToolbarMenuItem
            label={STRINGS.replaceEllipsis}
            testId="replace-image"
            disabled={planImage === null}
            onSelect={() => fileInputRef.current?.click()}
          />
          <ToolbarMenuItem
            label={STRINGS.remove}
            testId="remove-plan-image"
            disabled={planImage === null}
            onSelect={() => {
              if (floorId !== null) send('plan.removeImage', { floorId })
            }}
          />
          <ToolbarMenuItem
            label={STRINGS.calibrateEllipsis}
            testId="calibrate-scale"
            disabled={planImage === null}
            onSelect={() => setIsCalibrating(true)}
          />
        </ToolbarMenu>
      ),
    },
    {
      id: 'export',
      width: 104,
      label: STRINGS.exportGroup,
      content: (
        <button
          type="button"
          data-testid="export-open"
          className="bb-workspace-tool-button"
          disabled={view === null}
          onClick={openExport}
        >
          {STRINGS.exportAction}
        </button>
      ),
    },
  ]
  if (narrow) {
    groups.push({
      id: 'rail',
      width: 156,
      label: STRINGS.viewAndSelection,
      content: (
        <button
          type="button"
          data-testid="rail-toggle"
          aria-pressed={railOpen ? 'true' : 'false'}
          className="bb-workspace-tool-button"
          onClick={() => setRailOpen(!railOpen)}
        >
          View &amp; selection
        </button>
      ),
    })
  }

  const deleteFloorTarget = project.floors.find((candidate) => candidate.id === deleteFloorId) ?? null
  const origin = placedOrigin(project, selection)

  // #70 §3: the two things only this component knows, which the strip cannot derive from the table —
  // whether one thing is named well enough to mark, and which Design Option would own the record.
  const renovationSelectedIds = [wallSelection, openingSelection, roomSelection, selection].filter((id) => id !== null)
  const renovationBlocked: Partial<Record<RenovationToolId, string>> =
    renovationSelectedIds.length === 1 ? {} : { markDemolition: RENOVATION_STRINGS.markDemolitionNeedsOne }
  const markRenovationDemolition = (): void => {
    const entityId = renovationSelectedIds[0]
    if (renovationOptionId === null || entityId === undefined) return
    // §7e: a demolition record is only ever about baseline work. The Option's own work is deleted, and
    // something already marked down has no second demolition to record — the tool says so instead of
    // opening a dialog whose answer would be refused.
    const state = renovationStates?.get(entityId)
    if (state !== undefined && state !== 'existing') {
      const ref = entityFields(project, entityId)?.ref ?? entityId
      showRenovationNotice(RENOVATION_STRINGS.notExisting(ref, DISPLAY_LABELS[state]))
      return
    }
    openDemolishDialog(entityId, renovationOptionId)
  }
  const showRenovationNotice = (next: string | null): void => {
    if (next === null) clearHiddenToolNotice()
    else showHiddenToolNotice(next)
  }

  /**
   * Which Drawing Layer each entity of the model this view draws stands on (#71 §4). One lookup
   * serves the canvas gates and the snap gate, which must agree: an entity the canvas will not let be
   * picked is the same entity a tool must not snap to.
   */
  const entityLayerKey = useMemo(() => {
    if (!FF_RENOVATION || floorId === null) return null
    const model = effectiveModel(project, floorId, renovationOptionId)
    const layerOf = new Map<string, string>()
    for (const { entity } of model.walls) layerOf.set(entity.id, entity.drawingLayerId ?? UNLAYERED_LAYER_KEY)
    for (const { entity } of model.openings) layerOf.set(entity.id, entity.drawingLayerId ?? UNLAYERED_LAYER_KEY)
    for (const { entity } of model.rooms) layerOf.set(entity.id, entity.drawingLayerId ?? UNLAYERED_LAYER_KEY)
    for (const { entity } of model.placedItems) layerOf.set(entity.id, entity.drawingLayerId ?? UNLAYERED_LAYER_KEY)
    return layerOf
  }, [project, floorId, renovationOptionId])

  /**
   * The Drawing Layer gates of this view (#71 §4), one answer per entity, composed from `derive`'s
   * pure rules over the model the canvas is drawing. The canvas may not read the domain, so the
   * entity → layer lookup happens here and the canvas is handed four booleans, a colour, an order and
   * a name.
   *
   * `displayIncluded` is `true` because the Display's own subset is already applied by `states`: the
   * layer gate is the second of the two, and `layerAccessOf` intersects them.
   */
  const layerGates: LayerGates | null = useMemo(() => {
    if (!FF_RENOVATION || view === null || entityLayerKey === null) return null
    const keyOf = (id: string): string => entityLayerKey.get(id) ?? UNLAYERED_LAYER_KEY
    const access = (id: string): LayerAccess => layerAccessOf(project, view, keyOf(id), { displayIncluded: true })
    const order = effectiveLayerOrder(project, view)
    return {
      drawn: (id) => access(id).drawn,
      pickable: (id) => access(id).pickable,
      modifiable: (id) => access(id).modifiable,
      // The colour that paints content is the one this view was given — `Colour in this view` — and
      // not the Project default, because the default is a swatch that names the row while the
      // Renovation Display's own palette (#70) is what paints the drawing. A view that says "draw
      // Structure in this colour" is a deliberate act, and it is the one that repaints.
      colorOf: (id) => viewLayerSettingOverride(view, keyOf(id))?.color ?? null,
      orderOf: (id) => order.indexOf(keyOf(id)),
      readOnlyLayerOf: (id) =>
        access(id).modifiable ? null : drawingLayerById(project, keyOf(id))?.name ?? RENOVATION_STRINGS.layerUnlayered,
      onRefusal: (name) => showHiddenToolNotice(RENOVATION_STRINGS.layerReadOnlyNotice(name)),
    }
  }, [project, view, entityLayerKey, showHiddenToolNotice])

  /**
   * Whether one entity's geometry may be snapped to in this view (#71 criterion 12): hidden or
   * non-selectable content is not a target, and `Snap to hidden content` is the one switch that puts
   * it back. Picking stays impossible either way — that answer is `layerAccessOf`'s, above.
   */
  const snapLayerAllowed = useMemo(() => {
    if (!FF_RENOVATION || view === null || entityLayerKey === null) return undefined
    return (ownerId: string): boolean =>
      snapCandidateAllowed(project, view, entityLayerKey.get(ownerId) ?? UNLAYERED_LAYER_KEY)
  }, [project, view, entityLayerKey])

  /** The entity the inspector is showing, whichever picker named it (#70 §5, #71 §5). */
  const inspectedEntityId = wallSelection ?? openingSelection ?? roomSelection ?? selection

  /**
   * The inspector's `Layer` row (#71 §5): every layer in Project order, then `Unlayered`, with this
   * entity's own layer current.
   *
   * The row is disabled when the entity's layer is read-only in this view — the same promise that
   * takes the handles off the canvas, read from the layer's own switch rather than from the Display's
   * edit rules, because `Editable` is a statement about this layer and not about the Display.
   */
  const inspectorLayer: RenovationInspectorLayer | null = useMemo(() => {
    if (!FF_RENOVATION || view === null || inspectedEntityId === null) return null
    const key = entityLayerKey?.get(inspectedEntityId) ?? UNLAYERED_LAYER_KEY
    return {
      current: key === UNLAYERED_LAYER_KEY ? null : key,
      options: [
        ...drawingLayersOf(project).map((each) => ({ id: each.id as string | null, name: each.name })),
        { id: null, name: RENOVATION_STRINGS.layerUnlayered },
      ],
      readOnlyLayer: effectiveLayerSetting(project, view, key).editable
        ? null
        : drawingLayerById(project, key)?.name ?? RENOVATION_STRINGS.layerUnlayered,
    }
  }, [project, view, entityLayerKey, inspectedEntityId])

  /** Whether the inspected entity stands on a read-only layer: its fields are shown and disabled (#71 criterion 11). */
  const inspectedReadOnly = (inspectorLayer?.readOnlyLayer ?? null) !== null

  /**
   * One Edit Transaction: file the inspected entity under another layer (`null` is `Unlayered`).
   *
   * It changes presentation only. An Existing Model entity keeps its renovation ownership — the
   * record is still the survey's, whichever layer it is drawn on — so this is never a baseline
   * correction and never opens a protected-edit dialog (#71 §5).
   */
  const moveInspectedEntityToLayer = (layerId: string | null): void => {
    if (inspectedEntityId === null) return
    const name = layerId === null ? RENOVATION_STRINGS.layerUnlayered : drawingLayerById(project, layerId)?.name ?? layerId
    sendLabelled('entity.setLayer', { entityId: inspectedEntityId, layerId }, RENOVATION_STRINGS.entitySetLayerLabel(name))
  }

  /**
   * The strip's suffix for a warning whose subject this view does not draw (#71 §7, criterion 9).
   *
   * The row stays because the warning is a fact about the model, not about this view's drawing; the
   * words say why the thing it warns about is nowhere on screen. `Locate` is untouched — it still
   * selects the subject, and it never changes a layer's visibility to make a warning visible.
   */
  const warningLayerSuffix = useMemo(() => {
    if (!FF_RENOVATION || view === null || entityLayerKey === null) return undefined
    return (warning: Warning): string => {
      const hidden = warning.subjects
        .map((subject) => entityLayerKey.get(subject.id) ?? UNLAYERED_LAYER_KEY)
        .find((key) => !effectiveLayerSetting(project, view, key).visible)
      if (hidden === undefined) return ''
      // The sentence above it ends in a full stop, and the suffix the issue writes begins with a
      // middot — without a space between them the strip reads `…is outside.· Furniture hidden…`.
      return ` ${RENOVATION_STRINGS.warningHiddenSuffix(
        drawingLayerById(project, hidden)?.name ?? RENOVATION_STRINGS.layerUnlayered,
      )}`
    }
  }, [project, view, entityLayerKey])

  // ---- the inspector's renovation block (#70 §5)
  /**
   * What the inspector prints about the selection. The lookup covers the open Option's own work as
   * well as the Existing Model, because a Proposed Wall answers a click exactly like a baseline one
   * and the per-kind inspectors only know the Existing Model. `Replaces` and `Successor` come from
   * the same predecessor references the Replace Intent wrote (#69 §5), so the links are the model's
   * own history rather than a guess from geometry.
   */
  const renovationDisplayNow: RenovationDisplay = view === null ? 'existing' : viewRenovationDisplay(view)
  const renovationTarget = useMemo((): RenovationInspectorTarget | null => {
    const id = wallSelection ?? openingSelection ?? roomSelection ?? selection
    if (id === null || renovationStates === null) return null
    const state = renovationStates.get(id)
    if (state === undefined) return null
    const model = project.existingModel
    const option = designOptionsOf(project).find((each) => each.id === renovationOptionId) ?? null
    const proposed = option?.proposed ?? null
    const describe = (
      entityId: string,
    ): { ref: string; kind: string; predecessors: readonly string[] } | null => {
      const wall = [...model.walls, ...(proposed?.walls ?? [])].find((each) => each.id === entityId)
      if (wall !== undefined) return { ref: wall.ref, kind: RENOVATION_STRINGS.kindWall, predecessors: wall.predecessorIds ?? [] }
      const opening = [...model.openings, ...(proposed?.openings ?? [])].find((each) => each.id === entityId)
      if (opening !== undefined)
        return { ref: opening.label, kind: RENOVATION_STRINGS.kindOpening, predecessors: opening.predecessorIds ?? [] }
      const room = [...model.rooms, ...(proposed?.rooms ?? [])].find((each) => each.id === entityId)
      if (room !== undefined) return { ref: room.name, kind: RENOVATION_STRINGS.kindRoom, predecessors: room.predecessorIds ?? [] }
      const placed = [...model.placedItems, ...(proposed?.placedItems ?? [])].find((each) => each.id === entityId)
      if (placed !== undefined) {
        const design = project.itemDesigns.find((each) => each.id === placed.itemDesignId)
        return {
          ref: design?.name ?? entityId,
          kind: RENOVATION_STRINGS.kindPlacedItem,
          predecessors: placed.predecessorIds ?? [],
        }
      }
      return null
    }
    const self = describe(id)
    if (self === null) return null
    // The shortest Display that draws an entity: the one worth switching to when the current one
    // does not draw it at all.
    const displayOf = (entityId: string): RenovationDisplay => {
      const each = renovationStates.get(entityId)
      return each === 'demolition' ? 'demolition' : each === 'proposed' ? 'proposed' : 'existing'
    }
    const link = (entityId: string): RenovationInspectorLink | null => {
      const each = describe(entityId)
      if (each === null) return null
      const display = displayOf(entityId)
      return { id: entityId, ref: each.ref, display, drawn: DISPLAY_STATES[renovationDisplayNow].includes(renovationStates.get(entityId) ?? 'existing') }
    }
    const successors = [
      ...(proposed?.walls ?? []),
      ...(proposed?.openings ?? []),
      ...(proposed?.rooms ?? []),
      ...(proposed?.placedItems ?? []),
    ]
      .filter((each) => (each.predecessorIds ?? []).includes(id))
      .map((each) => link(each.id))
      .filter((each): each is RenovationInspectorLink => each !== null)
    return {
      id,
      ref: self.ref,
      kind: self.kind,
      state,
      owner:
        state === 'proposed'
          ? option?.name ?? RENOVATION_STRINGS.noDesignOptionShort
          : RENOVATION_STRINGS.ownerExistingModel,
      replaces: self.predecessors.map(link).filter((each): each is RenovationInspectorLink => each !== null),
      successors,
    }
  }, [wallSelection, openingSelection, roomSelection, selection, renovationStates, renovationOptionId, project, view])

  const renovationSubject = wallSelection ?? openingSelection ?? roomSelection ?? selection
  /**
   * §7c: whether the selection is a baseline record being looked at in the Existing display while the
   * Project carries a Design Option — the one case its handles, its grip and its fields stay shut. The
   * Project's own count is the test because it is the test the edit layer makes: with no Option there
   * is nothing sharing the record, and an Existing edit commits as it always did (criterion 24).
   */
  const baselineLocked = FF_RENOVATION && baselineEditLocked({
    display: renovationDisplayNow,
    hasOptions: designOptionsOf(project).length > 0,
    state: renovationStates?.get(renovationSubject ?? '') ?? 'existing',
    unlockedId: correctionUnlocked,
    entityId: renovationSubject ?? '',
  })
  /**
   * §7c: what the inspector's shut fields say. The sentence comes from the renovation copy table,
   * which only this branch reaches — the fields read the words off the context, so a flag-off build
   * never pulls that table in to explain a field it always lets people type in.
   */
  const fieldsLock: FieldsLock = baselineLocked
    ? { locked: true, notice: RENOVATION_STRINGS.correctLocked }
    : FF_RENOVATION && inspectedReadOnly
      ? { locked: true, notice: RENOVATION_STRINGS.layerReadOnlyNotice(inspectorLayer?.readOnlyLayer ?? '') }
      : FIELDS_UNLOCKED

  const runRenovationAction = (action: RenovationInspectorAction): void => {
    const id = wallSelection ?? openingSelection ?? roomSelection ?? selection
    if (id === null) return
    if (action === 'move') {
      // The move itself is the canvas's own drag; the button hands the canvas the focus so the
      // selected entity is the thing the next drag takes hold of.
      setTool('select')
      hostRef.current?.focus()
      return
    }
    if (action === 'demolish') {
      markRenovationDemolition()
      return
    }
    if (action === 'correct') {
      // §7c: the press is the unlock. This entity gets its handles, its grip and its fields back, and
      // the edit made with them is the one that asks what it does to every Design Option. It needs no
      // Option of its own to be pressed against — the record it opens is the shared one.
      unlockCorrection(id)
      return
    }
    if (renovationOptionId === null) return
    if (action === 'restore') {
      // §7d: taking a demolition record out of one Option can bring the Option's own successors down
      // with it, so the press asks before anything is written. The transaction keeps the label the
      // handler gives it — nothing to do with a Display change, which is what this used to claim.
      openRestoreDialog(id, renovationOptionId)
      return
    }
    if (action === 'replace') {
      // §7e: the inspector's `Replace…` is §7a's Replace with the geometry left alone — one demolition
      // record and one successor standing exactly where the baseline record stood, which the person
      // then edits. `edit: {}` is that: every field copied (#69 §7).
      send('renovation.replace', { entityId: id, edit: {}, target: { designOptionId: renovationOptionId } })
      pendingReplace.current = { predecessorId: id, optionId: renovationOptionId }
      return
    }
    if (action === 'delete') {
      // A Design Option's own work has no demolition to keep: `renovation.demolish` deletes the
      // record and the things that hung off it in one transaction (#69 §7).
      send('renovation.demolish', { entityId: id, target: { designOptionId: renovationOptionId } })
    }
  }

  /**
   * A `Replaces` / `Successor` link: select the entity, and switch Display only when the current one
   * does not draw it — which makes the switch navigation plus one undoable Display change, not a
   * silent repaint.
   */
  const selectRenovationEntity = (id: string, display: RenovationDisplay): void => {
    const state = renovationStates?.get(id)
    if (view !== null && state !== undefined && !DISPLAY_STATES[renovationDisplayNow].includes(state)) {
      sendLabelled(
        'view.setRenovationDisplay',
        { viewId: view.id, renovationDisplay: display },
        RENOVATION_STRINGS.setRenovationDisplay(displayLabel(display)),
      )
    }
    const model = project.existingModel
    const proposed = designOptionsOf(project).find((each) => each.id === renovationOptionId)?.proposed ?? null
    if ([...model.walls, ...(proposed?.walls ?? [])].some((each) => each.id === id)) selectWall(id)
    else if ([...model.openings, ...(proposed?.openings ?? [])].some((each) => each.id === id)) selectOpening(id)
    else if ([...model.rooms, ...(proposed?.rooms ?? [])].some((each) => each.id === id)) selectRoom(id)
    else select(id)
  }

  return (
    <>
      <WorkspaceShell
        railOpen={railOpen}
        canvasHostRef={hostRef}
        header={
          <>
            <button
              type="button"
              data-testid="return-to-projects"
              className="bb-workspace-tool-button"
              onClick={host.returnToProjects}
            >
              ← Projects
            </button>
            <span className="bb-workspace-project-name">{project.meta.name}</span>
            <span className="bb-workspace-spacer" />
            {save !== null && (
              // The legacy shape the S4 specs assert: a `role="status"` span whose failed
              // state is a button, because the dialog is the answer to the red words.
              <span
                role="status"
                data-testid="save-status"
                data-failed={save.failed ? 'true' : 'false'}
                className="bb-workspace-save-status"
              >
                {save.failed ? (
                  <button type="button" onClick={host.showSaveFailure}>
                    {save.text}
                  </button>
                ) : (
                  save.text
                )}
              </span>
            )}
            <button
              type="button"
              data-testid="undo-button"
              aria-label={STRINGS.undo}
              disabled={!history.canUndo}
              className="bb-workspace-tool-button"
              onClick={() => session.undo()}
            >
              {STRINGS.undo}
            </button>
            <button
              type="button"
              data-testid="redo-button"
              aria-label={STRINGS.redo}
              disabled={!history.canRedo}
              className="bb-workspace-tool-button"
              onClick={() => session.redo()}
            >
              {STRINGS.redo}
            </button>
            <button
              type="button"
              data-testid="project-settings"
              className="bb-workspace-tool-button"
              onClick={() => setSettingsOpen(true)}
            >
              Project settings
            </button>
          </>
        }
        toolbar={<WorkspaceToolbar groups={groups} />}
        renovationLegend={FF_RENOVATION && view !== null ? <RenovationLegend /> : undefined}
        renovationBar={
          FF_RENOVATION && view !== null ? (
            <>
              <RenovationModeBar
                display={viewRenovationDisplay(view)}
                optionName={designOptionsOf(project).find((option) => option.id === viewDesignOptionId(view))?.name ?? null}
              />
              <RenovationToolStrip
                display={viewRenovationDisplay(view)}
                hasDesignOption={renovationOptionId !== null}
                activeTool={tool}
                pickStates={pickStates}
                notice={hiddenToolNotice}
                blocked={renovationBlocked}
                onTool={setTool}
                onMarkDemolition={markRenovationDemolition}
                onTogglePick={togglePickState}
                onNotice={showRenovationNotice}
              />
              {viewRenovationDisplay(view) !== 'existing' && renovationOptionId === null ? (
                <RenovationErrorBanner
                  display={viewRenovationDisplay(view)}
                  options={designOptionsOf(project)}
                  onSetDesignOption={(designOptionId) => {
                    const name = designOptionsOf(project).find((option) => option.id === designOptionId)?.name ?? null
                    sendLabelled(
                      'view.setDesignOption',
                      { viewId: view.id, designOptionId },
                      RENOVATION_STRINGS.setDesignOption(name),
                    )
                  }}
                  onShowExisting={() =>
                    sendLabelled(
                      'view.setRenovationDisplay',
                      { viewId: view.id, renovationDisplay: 'existing' },
                      RENOVATION_STRINGS.setRenovationDisplay(displayLabel('existing')),
                    )
                  }
                />
              ) : undefined}
            </>
          ) : undefined
        }
        viewCard={
          <SavedViewCard
            project={project}
            floor={floor}
            views={views}
            view={view}
            planImage={planImage}
            unit={project.preferences.displayUnit}
            precision={project.preferences.displayPrecision}
            onFloor={openFloor}
            onView={openView}
            onAddPlanView={addPlanView}
            onManageFloors={() => setManageFloorsOpen(true)}
            onShowPlanImage={(showPlanImage) => {
              if (view !== null) send('view.setShowPlanImage', { viewId: view.id, showPlanImage })
            }}
            onCalibrate={() => setIsCalibrating(true)}
            renovation={
              FF_RENOVATION ? (
                <>
                  <RenovationViewSection
                  view={view}
                  options={designOptionsOf(project)}
                  onSetDesignOption={(designOptionId) => {
                    if (view === null) return
                    const name = designOptionsOf(project).find((option) => option.id === designOptionId)?.name ?? null
                    sendLabelled(
                      'view.setDesignOption',
                      { viewId: view.id, designOptionId },
                      RENOVATION_STRINGS.setDesignOption(name),
                    )
                  }}
                  onSetRenovationDisplay={(renovationDisplay) => {
                    if (view === null) return
                    sendLabelled(
                      'view.setRenovationDisplay',
                      { viewId: view.id, renovationDisplay },
                      RENOVATION_STRINGS.setRenovationDisplay(displayLabel(renovationDisplay)),
                    )
                  }}
                  layers={
                    <RenovationLayers
                      project={project}
                      view={view}
                      // `+` is one transaction whose undo reads `New layer: New layer`; the id comes
                      // back so the row opens with its name focused (#71 §3).
                      onAddLayer={() => {
                        const intent = services.intent.build(
                          'layer.add',
                          { name: RENOVATION_STRINGS.layerNewName, color: NEW_LAYER_COLOR },
                          RENOVATION_STRINGS.layerAddLabel(RENOVATION_STRINGS.layerNewName),
                        )
                        void sendIntent(intent)
                        return intent.ids[0] ?? null
                      }}
                      onRenameLayer={(layerId, name) =>
                        sendLabelled('layer.rename', { layerId, name }, RENOVATION_STRINGS.layerRenameLabel(name))
                      }
                      onSetProjectColor={(layerId, color) =>
                        sendLabelled(
                          'layer.setColor',
                          { layerId, color },
                          RENOVATION_STRINGS.layerSetColorLabel(drawingLayerById(project, layerId)?.name ?? ''),
                        )
                      }
                      onMoveProject={(layerId, direction) =>
                        sendLabelled(
                          'layer.move',
                          { layerId, direction },
                          RENOVATION_STRINGS.layerMoveLabel(
                            drawingLayerById(project, layerId)?.name ?? '',
                            direction === 'forward' ? RENOVATION_STRINGS.layerEdgeFront : RENOVATION_STRINGS.layerEdgeBack,
                          ),
                        )
                      }
                      onDeleteLayer={(layerId) => openDeleteLayerDialog(layerId, view?.id ?? null)}
                      onSetSetting={(layerKey, setting: LayerSettingPatch) => {
                        if (view === null) return
                        sendLabelled(
                          'view.setLayerSetting',
                          { viewId: view.id, layerKey, setting },
                          RENOVATION_STRINGS.layerSettingLabel(
                            drawingLayerById(project, layerKey)?.name ?? RENOVATION_STRINGS.layerUnlayered,
                            layerSettingWord(setting),
                          ),
                        )
                      }}
                      onSetViewOrder={(layerOrder, movedLayerId) => {
                        if (view === null) return
                        sendLabelled(
                          'view.setLayerOrder',
                          { viewId: view.id, layerOrder },
                          RENOVATION_STRINGS.layerOrderLabel(
                            drawingLayerById(project, movedLayerId)?.name ?? RENOVATION_STRINGS.layerUnlayered,
                          ),
                        )
                      }}
                      onUseProjectOrder={() => {
                        if (view === null) return
                        sendLabelled(
                          'view.setLayerOrder',
                          { viewId: view.id, layerOrder: null },
                          RENOVATION_STRINGS.layerOrderLabel(view.name),
                        )
                      }}
                      onSetActiveLayer={(layerId) => {
                        if (view === null) return
                        sendLabelled(
                          'view.setActiveLayer',
                          { viewId: view.id, layerId },
                          RENOVATION_STRINGS.layerActiveLabel(
                            drawingLayerById(project, layerId)?.name ?? RENOVATION_STRINGS.layerUnlayered,
                          ),
                        )
                      }}
                      onSetSnapToHidden={(snapToHidden) => {
                        if (view === null) return
                        sendLabelled(
                          'view.setSnapToHidden',
                          { viewId: view.id, snapToHidden },
                          RENOVATION_STRINGS.layerSnapLabel(snapToHidden ? RENOVATION_STRINGS.layerOn : RENOVATION_STRINGS.layerOff),
                        )
                      }}
                    />
                  }
                  onExport={() => setIsExporting(true)}
                />
                  <RenovationInspector
                    target={renovationTarget}
                    display={renovationDisplayNow}
                    hasDesignOption={designOptionsOf(project).length > 0}
                    layer={inspectorLayer}
                    onLayerChange={moveInspectedEntityToLayer}
                    onAction={runRenovationAction}
                    onSelectEntity={selectRenovationEntity}
                  />
                </>
              ) : undefined
            }
            onFit={fit}
          />
        }
        inspector={
          // §7c: the inspector rail reads one flag for whether its fields are shut, instead of a prop
          // threaded through four inspectors that each have to remember to honour it.
          <FieldsLockedContext.Provider value={fieldsLock}>
          {selectedRoom !== null
            ? <RoomInspector
                room={selectedRoom.room}
                derived={selectedRoom.derived}
                unit={project.preferences.displayUnit}
                precision={project.preferences.displayPrecision}
                onRename={(name) => send('room.rename', { roomId: selectedRoom.room.id, name })}
                focusName={roomNameFocus}
                renovationAction={renovationAction(selectedRoom.room.id)}
              >
                <RoomFacePicker
                  edges={roomEdgeRows(selectedRoom.room, floorWalls, floorDomainRooms)}
                  openEdge={faceEdge}
                  candidates={faceCandidates}
                  previewKey={facePick === null ? null : `${facePick.candidate.wallId}|${facePick.candidate.side}`}
                  blocked={faceOverlap.blocked ? faceOverlap.message : null}
                  onOpen={(segmentId) => {
                    setFaceEdge(segmentId)
                    setFacePick(null)
                  }}
                  onPickOnCanvas={() => setFacePicking(true)}
                  onPreview={(candidate) => setFacePick(candidate === null
                    ? null
                    : { roomId: selectedRoom.room.id, candidate })}
                  onAttach={(candidate) => {
                    if (faceEdge === null) return
                    send('room.attachFace', {
                      roomId: selectedRoom.room.id,
                      segmentId: faceEdge,
                      wallId: candidate.wallId,
                      side: candidate.side,
                    })
                    setFacePick(null)
                    setFaceEdge(null)
                  }}
                  onDetach={(segmentId) => {
                    send('room.detachFace', { roomId: selectedRoom.room.id, segmentId })
                    setFacePick(null)
                  }}
                  unit={project.preferences.displayUnit}
                  precision={project.preferences.displayPrecision}
                />
              </RoomInspector>
            : selectedOpening !== null
            ? <OpeningInspector
                opening={selectedOpening.opening}
                host={selectedOpening.host}
                end={selectedOpening.end}
                hostLength={selectedOpening.hostLength}
                unit={project.preferences.displayUnit}
                precision={project.preferences.displayPrecision}
                onRename={(label) => send('opening.rename', { openingId: selectedOpening.opening.id, label })}
                onSetWidth={(width) => send('opening.setWidth', { openingId: selectedOpening.opening.id, width })}
                onSetStart={(start) => send('opening.setStart', { openingId: selectedOpening.opening.id, start })}
                onFlipHinge={() => send('opening.flipHinge', { openingId: selectedOpening.opening.id })}
                onFlipSwing={() => send('opening.flipSwing', { openingId: selectedOpening.opening.id })}
                onSelectHost={() => selectWall(selectedOpening.opening.hostWallId)}
                renovationAction={renovationAction(selectedOpening.opening.id)}
                onDelete={() => {
                  send('opening.delete', { openingId: selectedOpening.opening.id })
                  selectOpening(null)
                }}
              />
            : selectedWall === null
            ? <SelectionInspector
            item={selected}
            renovationAction={renovationAction(selection ?? '')}
            bounds={selection === null || derivedFloor === null
              ? null
              : derivedFloor.placements.find((p) => p.id === selection)?.worldBounds ?? null}
            design={selectedDesign}
            unit={project.preferences.displayUnit}
            precision={project.preferences.displayPrecision}
            canTransfer={selected !== null && project.floors.length > 1}
            preview={designPreview}
            pickingOrigin={pickingOrigin}
            membership={floorRooms === null || floorRooms.rooms.length === 0 || selection === null
              ? undefined
              : roomMembershipSentence(floorRooms.membership.get(selection))}
            onSetPosition={setPosition}
            onSetRotation={setRotation}
            onEditDesign={editDesign}
            onPreviewOrigin={previewOrigin}
            onApplyPreview={applyPreview}
            onCancelPreview={cancelPreview}
            onTogglePick={() => setPickingOrigin(!pickingOrigin)}
            onFork={() => setForkOpen(true)}
            onOpenDetail={openDetail}
            onTransfer={() => setTransferOpen(true)}
            onDelete={() => {
              if (selection === null) return
              send('plan.removeObject', { placedItemId: selection })
              select(null)
            }}
          />
            : <WallInspector
                wall={selectedWall.wall}
                derived={selectedWall.derived}
                mergeableWith={selectedWall.mergeableWith}
                unit={project.preferences.displayUnit}
                precision={project.preferences.displayPrecision}
                onSetLength={(length) => send('wall.setLength', {
                  wallId: selectedWall.wall.id,
                  length,
                  keepFixed: 'start',
                })}
                onSetRadius={(radius) => send('wall.setArc', { wallId: selectedWall.wall.id, radius })}
                onSetThickness={(thickness) => send('wall.setThickness', { wallId: selectedWall.wall.id, thickness })}
                onOffset={(distance, side) => send('wall.offset', { wallId: selectedWall.wall.id, distance, side })}
                onSplit={() => send('wall.split', { wallId: selectedWall.wall.id, at: selectedWall.derived.length / 2 })}
                onMerge={(otherId) => send('wall.merge', { wallIds: [selectedWall.wall.id, otherId] as const })}
                onDelete={() => deleteWall(selectedWall.wall.id)}
                deleteBlocked={roomDeleteBlockFor(project, selectedWall.wall)}
                renovationAction={renovationAction(selectedWall.wall.id)}
              />
          }
          </FieldsLockedContext.Provider>
        }
        canvas={
          <>
            {derivedFloor !== null && (
            <PlanViewCanvas
              hostRef={hostRef}
              svgRef={svgRef}
              floor={derivedFloor}
              showPlanImage={view?.showPlanImage ?? false}
              imageSrc={imageSrc}
              viewport={viewport ?? null}
              onViewport={setViewport}
              tool={tool}
              selection={selection}
              editLocked={baselineLocked}
              onSelect={select}
              onCursorChange={setOpeningCursor}
              onCanvasClick={clickOnCanvas}
              warningSubjects={warningSubjects}
              onSelectWarningBadge={selectWarningBadge}
              dragPreview={dragPreview}
              onDragPreview={setDragPreview}
              onMoveItem={(id, x, y) => send('plan.movePlacement', { placedItemId: id, translation: { x, y } })}
              onRotateItem={(id, rotationDeg) => send('plan.rotatePlacement', { placedItemId: id, rotationDeg })}
              designPreview={designPreview}
              pickingOrigin={pickingOrigin}
              originCandidates={selectedDesign === null ? [] : originSnapCandidates(selectedDesign)}
              snapKinds={snapKinds}
              onPickOrigin={previewOrigin}
              unit={project.preferences.displayUnit}
              precision={project.preferences.displayPrecision}
              angleSnap={angleSnap}
              walls={floorWalls}
              renovation={
                renovationStates === null
                  ? null
                  : {
                      states: renovationStates,
                      pickStates,
                      cycle,
                      cycleCandidates,
                      onCycle: setCycle,
                      nameOf: nameOfEntity,
                    }
              }
              layerGates={layerGates}
              selectedWallId={wallSelection}
              rooms={floorRooms}
              selectedRoomId={roomSelection}
              roomProposal={roomProposal}
              onSelectRoom={(id) => {
                setRoomNameFocus(false)
                selectRoom(id)
                setTool('select')
              }}
              openings={openingLayer}
              selectedOpeningId={openingSelection}
              onSelectOpening={(id) => {
                // While the Door / window tool is in hand a click on the plan is a click *on* the
                // Wall under it: the marks there are the host being aimed at, not a selection, and
                // selecting one would drop the tool the person is using (#65 criterion 1).
                if (tool === 'opening') return
                selectOpening(id)
                setTool('select')
              }}
              openingPreview={openingPreview}
              onSelectWall={(id) => {
                if (tool === 'opening') return
                selectWall(id)
                setTool('select')
              }}
              overlay={isCalibrating ? (
                <CalibrationOverlay
                  zoom={viewport?.zoom ?? 1}
                  pixelsPerMm={planImage?.pixelsPerMm ?? null}
                  onMeasured={(distancePx) => {
                    setIsCalibrating(false)
                    setPendingDistancePx(distancePx)
                  }}
                />
              ) : undefined}
              htmlOverlay={tool === 'wall' && floorId !== null && floorWalls !== null && viewport !== null && viewport !== undefined ? (
                <WallDraftOverlay
                  viewport={viewport}
                  floorWalls={floorWalls}
                  snapAllowed={snapLayerAllowed}
                  draft={wallDraft ?? emptyWallDraft()}
                  onDraft={setWallDraft}
                  onCancel={() => {
                    setWallDraft(null)
                    setTool('select')
                  }}
                  onFinish={(chain: WallChainDraft) => {
                    // One chain, one Intent, one undo step (#26, #64 criterion 9).
                    send('wall.createChain', chain)
                    setWallDraft(null)
                  }}
                  floorId={floorId}
                  defaults={wallDefaults}
                  onOptions={(next) => setWallOptions({
                    thickness: next.thickness,
                    justification: next.justification,
                    classification: next.classification,
                    constructionLabel: next.constructionLabel,
                  })}
                  snapKinds={snapKinds}
                  gridSpacingMm={snapSettings.gridSpacingMm}
                  angleIncrementDeg={snapSettings.angle.incrementDeg}
                  unit={project.preferences.displayUnit}
                  precision={project.preferences.displayPrecision}
                />
              ) : drawTool !== null && floorId !== null && floorWalls !== null && viewport !== null && viewport !== undefined ? (
                <RoomDraftOverlay
                  viewport={viewport}
                  floorWalls={floorWalls}
                  roomGeometry={roomSnapGeometry}
                  snapAllowed={snapLayerAllowed}
                  tool={drawTool}
                  toolLabel={DRAW_TOOLS.find((definition) => definition.id === drawTool)!.label}
                  draft={roomDraft}
                  onDraft={setRoomDraft}
                  onCancel={() => {
                    setRoomDraft(null)
                    setRoomDraftTarget(null)
                    setTool('select')
                  }}
                  onClose={commitRoomDraft}
                  overlap={draftOverlap}
                  snapKinds={snapKinds}
                  gridSpacingMm={snapSettings.gridSpacingMm}
                  angleIncrementDeg={snapSettings.angle.incrementDeg}
                  unit={project.preferences.displayUnit}
                  precision={project.preferences.displayPrecision}
                />
              ) : shelterArmed && viewport !== null && viewport !== undefined ? (
                <ShelterLayer
                  viewport={viewport}
                  onCentre={setShelterCentre}
                  onPlace={placeShelter}
                  onCancel={() => {
                    setShelterArmed(false)
                    setShelterCentre(null)
                  }}
                  overlap={shelterOverlap}
                  unit={project.preferences.displayUnit}
                  precision={project.preferences.displayPrecision}
                />
              ) : facePicking && viewport !== null && viewport !== undefined ? (
                <FacePickLayer
                  viewport={viewport}
                  candidates={facePickCandidates}
                  previewKey={facePick === null ? null : `${facePick.candidate.wallId}|${facePick.candidate.side}`}
                  onPick={(candidate) => {
                    if (roomSelection === null) return
                    setFacePick({ roomId: roomSelection, candidate })
                    setFacePicking(false)
                  }}
                  onCancel={() => setFacePicking(false)}
                  unit={project.preferences.displayUnit}
                  precision={project.preferences.displayPrecision}
                />
              ) : tool === 'opening' ? (
                <OpeningDraftOverlay
                  draft={openingDraft ?? emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID)}
                  onDraft={setOpeningDraft}
                  aim={openingAimNow}
                  onCancel={() => {
                    setOpeningDraft(null)
                    setOpeningCursor(null)
                    setTool('select')
                  }}
                  unit={project.preferences.displayUnit}
                  precision={project.preferences.displayPrecision}
                />
              ) : undefined}
            />
            )}
            <input
              ref={fileInputRef}
              data-testid="plan-image-input"
              type="file"
              accept={services.planImageAccept}
              style={{ display: 'none' }}
              onChange={(event) => void onFile(event)}
            />
          </>
        }
        warningStrip={
          floorWarnings.length === 0 && uploadError === null && !uncalibrated ? null : (
            <>
              {uploadError !== null && (
                <span data-testid="upload-error" data-tone="error">{uploadError}</span>
              )}
              {uploadError === null && uncalibrated && (
                <span data-testid="uncalibrated-hint">
                  {CALIBRATION_REQUIRED_HINT}
                  <button
                    type="button"
                    data-testid="calibrate-now"
                    className="bb-workspace-tool-button"
                    onClick={() => setIsCalibrating(true)}
                  >
                    Calibrate now
                  </button>
                </span>
              )}
              {floorWarnings.length > 0 && (
                <WarningStrip
                  warnings={floorWarnings}
                  onLocate={locateWarning}
                  onAcknowledge={acknowledgeWarning}
                  onEditNote={editWarningNote}
                  focus={warningFocus}
                  suffix={warningLayerSuffix}
                />
              )}
            </>
          )
        }
      />
      {deleteReview !== null && (
        <DeleteWallReviewDialog
          review={deleteReview}
          onConfirm={confirmDeleteWall}
          onCancel={() => setDeleteReview(null)}
        />
      )}
      {pendingDistancePx !== null && floorId !== null && (
        <ScaleCalibrationModal
          distancePx={pendingDistancePx}
          unit={project.preferences.displayUnit}
          precision={project.preferences.displayPrecision}
          onConfirm={(pixelsPerMm) => {
            send('plan.calibrate', { floorId, pixelsPerMm })
            setPendingDistancePx(null)
          }}
          onClose={() => setPendingDistancePx(null)}
        />
      )}
      {isExporting && view !== null && (
        <ExportDialog
          origin={{ kind: 'plan', viewId: view.id }}
          unit={project.preferences.displayUnit}
          precision={project.preferences.displayPrecision}
          unsavedChanges={session.getSnapshot().save.kind !== 'saved'}
          port={services.exportDrawings}
          onClose={() => {
            setIsExporting(false)
          }}
        />
      )}
      {settingsOpen && (
        <ProjectSettingsDialog
          unit={project.preferences.displayUnit}
          precision={project.preferences.displayPrecision}
          wallHeight={project.preferences.defaultWallHeight}
          onSave={(displayUnit, displayPrecision, defaultWallHeight) => {
            send('project.setPreferences', { displayUnit, displayPrecision, defaultWallHeight })
            setSettingsOpen(false)
          }}
          onClose={() => setSettingsOpen(false)}
        >
          {FF_RENOVATION && <DesignOptionsSection />}
        </ProjectSettingsDialog>
      )}
      {/* The `Demolish W-3?` and `Move to a Design Option?` reviews (#69 §9, §13), asked for by the
          inspector action or by #70's `Mark demolition` through the workspace store. */}
      {FF_RENOVATION && <RenovationOverlays />}
      {manageFloorsOpen && (
        <ManageFloorsDialog
          project={project}
          activeFloorId={floorId}
          unit={project.preferences.displayUnit}
          precision={project.preferences.displayPrecision}
          onRename={(targetId, name) => send('floor.rename', { floorId: targetId, name })}
          onReorder={(targetId, toIndex) => send('floor.reorder', { floorId: targetId, toIndex })}
          onSetLimits={(targetId, lowerMm, upperMm) => send('floor.setLimits', { floorId: targetId, lowerMm, upperMm })}
          onSetWallHeight={(targetId, defaultWallHeight) => {
            send('floor.setDefaultWallHeight', { floorId: targetId, defaultWallHeight })
          }}
          onAddFloor={addFloor}
          onDuplicate={(targetId) => setDuplicateFloorId(targetId)}
          onDelete={(targetId) => setDeleteFloorId(targetId)}
          onClose={() => setManageFloorsOpen(false)}
        />
      )}
      {deleteFloorTarget !== null && (
        <DeleteFloorDialog
          floor={deleteFloorTarget}
          rows={summarizeFloorDependencies(project, deleteFloorTarget.id)}
          onShow={showDependant}
          onDelete={() => deleteFloor(deleteFloorTarget.id)}
          onClose={() => setDeleteFloorId(null)}
        />
      )}
      {duplicateFloorId !== null && (
        <DuplicateFloorDialog
          project={project}
          sourceFloorId={duplicateFloorId}
          onConfirm={duplicateFloor}
          onClose={() => setDuplicateFloorId(null)}
        />
      )}
      {transferOpen && origin !== null && floor !== null && (
        <TransferToFloorDialog
          floors={project.floors}
          fromFloorName={floor.name}
          initial={origin}
          unit={project.preferences.displayUnit}
          precision={project.preferences.displayPrecision}
          onCopy={(target) => transfer('copy', target)}
          onMove={(target) => transfer('move', target)}
          onClose={() => setTransferOpen(false)}
        />
      )}
      {newItemOpen && (
        <NewItemDialog
          onConfirm={addItemDesign}
          onClose={() => setNewItemOpen(false)}
        />
      )}
      {forkOpen && selected !== null && (
        <ForkDesignDialog
          designName={selected.label}
          taken={project.itemDesigns.map((design) => design.name)}
          onConfirm={forkDesign}
          onClose={() => setForkOpen(false)}
        />
      )}
    </>
  )
}

/**
 * Which entities a Renovation Display draws, and as what (#70 criterion 7).
 *
 * `displayModel` already answered both — it is the Display's own rows, each carrying the State it is
 * drawn in — so this only turns them into the lookup the canvas needs. Openings are in here too: a
 * Display that does not draw a Wall does not draw what is cut in it either.
 */
function statesOf(model: DisplayModel): ReadonlyMap<string, RenovationState> {
  const rows = [...model.walls, ...model.openings, ...model.rooms, ...model.placedItems]
  return new Map(rows.map((row) => [row.entity.id, row.renovationState]))
}
