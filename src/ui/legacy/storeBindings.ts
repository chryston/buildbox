/**
 * `LegacyBindings` over today's global store (#49).
 *
 * This is the flag-off implementation, and the only thing that moved out of the components:
 * every selector and action they used to call themselves is here, in the same order, doing
 * the same thing. It is deleted in #53 with the store.
 *
 * Two fields have no legacy counterpart and are named for that rather than faked:
 * `saveStatus` is `null` because the store never persisted anything it could report on, and
 * `endFloorPlanDrag` does nothing because the legacy drag already wrote on every pointer
 * move — which is the defect #49 fixes on the session side, not here.
 */
import { useEffect, useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import { OBJECT_CATALOG } from '../../data/floorPlanObjects'
import { useStore } from '../../store/store'
import type { FloorPlanObject } from '../../types'
import { useUi } from './uiStore'
import type { LegacyBindings, PlanImageRead } from './bindings'

/** Not "no units yet" — the same empty array every render, so memoised children stay put. */
const NO_UNITS: never[] = []

/** Today's upload messages, kept word for word (#49). */
const UNREADABLE = 'Could not read that image file.'
const UNDECODABLE_DATA = 'Could not decode that image file.'
const NOT_DECODABLE = 'The uploaded file is not a valid image.'

/** The legacy store reads and writes `buildbox-store`; the flagged app never loads this file. */
export function useStoreBindings(): LegacyBindings {
  const projects = useStore((state) => state.projects)
  const activeProjectId = useStore((state) => state.activeProjectId)
  const activeUnitId = useStore((state) => state.activeUnitId)
  const selectedId = useStore((state) => state.selectedId)
  const snapGrid = useStore((state) => state.snapGrid)
  const floorPlan = useStore((state) => state.floorPlan)
  const floorPlanSelectedId = useStore((state) => state.floorPlanSelectedId)

  const createProject = useStore((state) => state.createProject)
  const deleteProject = useStore((state) => state.deleteProject)
  const setActiveProject = useStore((state) => state.setActiveProject)
  const importWorkspace = useStore((state) => state.importWorkspace)
  const updateUnitSettings = useStore((state) => state.updateUnitSettings)
  const addShelf = useStore((state) => state.addShelf)
  const addDivider = useStore((state) => state.addDivider)
  const deleteBoard = useStore((state) => state.deleteBoard)
  const unpinNode = useStore((state) => state.unpinNode)
  const pinNode = useStore((state) => state.pinNode)
  const unlockNode = useStore((state) => state.unlockNode)
  const setCabinetMaterial = useStore((state) => state.setCabinetMaterial)
  const distributeEvenly = useStore((state) => state.distributeEvenly)
  const setDrawerConfig = useStore((state) => state.setDrawerConfig)
  const setElementType = useStore((state) => state.setElementType)
  const addAccessory = useStore((state) => state.addAccessory)
  const removeAccessory = useStore((state) => state.removeAccessory)
  const addUnit = useStore((state) => state.addUnit)
  const removeUnit = useStore((state) => state.removeUnit)
  const setActiveUnit = useStore((state) => state.setActiveUnit)
  const renameUnit = useStore((state) => state.renameUnit)
  const setSelectedId = useStore((state) => state.setSelectedId)
  const commitDrag = useStore((state) => state.commitDrag)
  const setFloorPlanImage = useStore((state) => state.setFloorPlanImage)
  const setFloorPlanScale = useStore((state) => state.setFloorPlanScale)
  const addFloorPlanObject = useStore((state) => state.addFloorPlanObject)
  const updateFloorPlanObject = useStore((state) => state.updateFloorPlanObject)
  const removeFloorPlanObject = useStore((state) => state.removeFloorPlanObject)
  const addAnnotation = useStore((state) => state.addAnnotation)
  const addCustomTemplate = useStore((state) => state.addCustomTemplate)
  const selectFloorPlanObject = useStore((state) => state.selectFloorPlanObject)
  const clearFloorPlan = useStore((state) => state.clearFloorPlan)
  const setNodeSize = useStore((state) => state.setNodeSize)
  const setNodeLabel = useStore((state) => state.setNodeLabel)

  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  useEffect(() => {
    const sync = () => {
      const temporal = useStore.temporal.getState()
      setCanUndo(temporal.pastStates.length > 0)
      setCanRedo(temporal.futureStates.length > 0)
    }
    sync()
    return useStore.temporal.subscribe(sync)
  }, [])

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0]
  const tool = useUi((state) => state.tool)
  const setTool = useUi((state) => state.setTool)
  const activeModule = useUi((state) => state.activeModule)
  const setActiveModule = useUi((state) => state.setActiveModule)
  const tabs = useMemo(() => projects.map(({ id, name }) => ({ id, name })), [projects])

  return useMemo<LegacyBindings>(() => ({
    projects: tabs,
    activeProjectId: activeProject?.id ?? null,
    activeProjectName: activeProject?.name ?? '',
    selectProject: setActiveProject,
    createProject,
    deleteProject,
    workspace: {
      projects,
      activeProjectId: activeProject?.id ?? null,
      onImport: (incoming, mode) => importWorkspace(incoming.projects, mode),
    },
    saveStatus: null,

    canUndo,
    canRedo,
    undo: () => useStore.temporal.getState().undo(),
    redo: () => useStore.temporal.getState().redo(),

    units: activeProject?.units ?? NO_UNITS,
    activeItemDesignId: activeUnitId,
    setActiveItemDesign: setActiveUnit,
    selectedNodeId: selectedId,
    selectNode: setSelectedId,
    snapGrid,
    updateUnitSettings,
    setCabinetMaterial,
    addUnit,
    removeUnit,
    renameUnit,
    addShelf,
    addDivider,
    deleteBoard,
    setNodeSize,
    pinNode,
    unpinNode,
    unlockNode,
    setNodeLabel,
    distributeEvenly,
    setElementType,
    setDrawerConfig,
    addAccessory: (nodeId, type) => addAccessory(nodeId, { id: crypto.randomUUID(), type }),
    removeAccessory,
    commitDrag,

    floorPlan,
    floorPlanSelectedId,
    selectFloorPlanObject,
    addFloorPlanObject: (catalogKey) => {
      const def = OBJECT_CATALOG.find((entry) => entry.type === catalogKey)
      if (def === undefined) return
      const object: FloorPlanObject = {
        id: nanoid(),
        type: def.type,
        label: def.label,
        x: 100,
        y: 100,
        w: def.defaultW,
        h: def.defaultH,
        rotation: 0,
        color: def.color,
      }
      addFloorPlanObject(object)
      selectFloorPlanObject(object.id)
    },
    addFloorPlanFromTemplate: (templateId) => {
      const template = floorPlan.customTemplates.find((t) => t.id === templateId)
      if (template === undefined) return
      const object: FloorPlanObject = {
        id: nanoid(),
        type: 'custom',
        label: template.label,
        x: 100,
        y: 100,
        w: template.defaultW,
        h: template.defaultH,
        rotation: 0,
        color: template.color,
        isCustom: true,
      }
      addFloorPlanObject(object)
      selectFloorPlanObject(object.id)
    },
    addCustomTemplate: (template) => addCustomTemplate({ id: nanoid(), ...template }),
    updateFloorPlanObject,
    dragFloorPlanObject: (id, patch) => updateFloorPlanObject(id, patch),
    endFloorPlanDrag: () => {},
    removeFloorPlanObject,
    setFloorPlanScale,
    clearFloorPlan,
    addAnnotation,
    planImageAccept: 'image/*',
    readPlanImage: readPlanImageAsDataUrl,
    setPlanImage: (image, { clearExisting }) => {
      if (clearExisting) clearFloorPlan()
      setFloorPlanImage({ dataUrl: image.src, widthPx: image.widthPx, heightPx: image.heightPx })
    },

    tool,
    setTool,
    activeModule,
    setActiveModule,
  }), [
    tabs,
    activeProject,
    activeProject?.id,
    activeProject?.name,
    activeUnitId,
    selectedId,
    snapGrid,
    floorPlan,
    floorPlanSelectedId,
    canUndo,
    canRedo,
    tool,
    setTool,
    activeModule,
    setActiveModule,
    createProject,
    deleteProject,
    setActiveProject,
    importWorkspace,
    updateUnitSettings,
    addShelf,
    addDivider,
    deleteBoard,
    unpinNode,
    pinNode,
    unlockNode,
    setCabinetMaterial,
    distributeEvenly,
    setDrawerConfig,
    setElementType,
    addAccessory,
    removeAccessory,
    addUnit,
    removeUnit,
    setActiveUnit,
    renameUnit,
    setSelectedId,
    commitDrag,
    setFloorPlanImage,
    setFloorPlanScale,
    addFloorPlanObject,
    updateFloorPlanObject,
    removeFloorPlanObject,
    addAnnotation,
    addCustomTemplate,
    selectFloorPlanObject,
    clearFloorPlan,
    setNodeSize,
    setNodeLabel,
  ])
}

/**
 * Today's upload path: read the file as a data URL and let an `Image` measure it.
 *
 * The legacy store keeps the data URL itself, so `src` is that URL and there are no bytes to
 * hand on. The three messages are the ones `FloorPlanPage` has always shown.
 */
function readPlanImageAsDataUrl(file: File): Promise<PlanImageRead> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve({ message: UNREADABLE })
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        resolve({ message: UNDECODABLE_DATA })
        return
      }
      const image = new Image()
      image.onload = () => resolve({
        image: {
          src: result,
          widthPx: image.naturalWidth,
          heightPx: image.naturalHeight,
          asset: null,
        },
      })
      image.onerror = () => resolve({ message: NOT_DECODABLE })
      image.src = result
    }
    reader.readAsDataURL(file)
  })
}
