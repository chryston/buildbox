import { useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { useStore } from '../../store/store'
import { OBJECT_CATALOG } from '../../data/floorPlanObjects'
import { downloadFloorPlanJSON } from '../../utils/floorPlanExport'
import { downloadSVG } from '../../utils/exportSVG'
import type { AnnotationType, FloorPlanObject, FloorPlanObjectType } from '../../types'
import FloorPlanCanvas from './FloorPlanCanvas'
import FloorPlanSidebar from './FloorPlanSidebar'
import FloorPlanProperties from './FloorPlanProperties'
import ScaleCalibrationModal from './ScaleCalibrationModal'
import CustomShapeModal from './CustomShapeModal'

export default function FloorPlanPage() {
  const svgRef = useRef<SVGSVGElement>(null)
  const [isCalibrating, setIsCalibrating] = useState(false)
  const [pendingDistancePx, setPendingDistancePx] = useState<number | null>(null)
  const [activeAnnotationType, setActiveAnnotationType] = useState<AnnotationType | null>(null)
  const [showCustomShape, setShowCustomShape] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pendingImageUpload, setPendingImageUpload] = useState<{ dataUrl: string; widthPx: number; heightPx: number } | null>(null)

  const floorPlan = useStore(s => s.floorPlan)
  const floorPlanSelectedId = useStore(s => s.floorPlanSelectedId)
  const setFloorPlanImage = useStore(s => s.setFloorPlanImage)
  const setFloorPlanScale = useStore(s => s.setFloorPlanScale)
  const addFloorPlanObject = useStore(s => s.addFloorPlanObject)
  const updateFloorPlanObject = useStore(s => s.updateFloorPlanObject)
  const removeFloorPlanObject = useStore(s => s.removeFloorPlanObject)
  const addAnnotation = useStore(s => s.addAnnotation)
  const addCustomTemplate = useStore(s => s.addCustomTemplate)
  const selectFloorPlanObject = useStore(s => s.selectFloorPlanObject)
  const clearFloorPlan = useStore(s => s.clearFloorPlan)

  const selectedObject = floorPlan.objects.find(o => o.id === floorPlanSelectedId) ?? null

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    if (!file) return

    setUploadError(null)

    if (!file.type.startsWith('image/')) {
      setUploadError('Please choose a valid image file.')
      input.value = ''
      return
    }

    const reader = new FileReader()
    reader.onerror = () => {
      setUploadError('Could not read that image file.')
      input.value = ''
    }
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        setUploadError('Could not decode that image file.')
        input.value = ''
        return
      }

      const img = new Image()
      img.onload = () => {
        const hasExistingData = floorPlan.objects.length > 0 || floorPlan.annotations.length > 0
        if (hasExistingData) {
          setPendingImageUpload({ dataUrl: result, widthPx: img.naturalWidth, heightPx: img.naturalHeight })
        } else {
          setFloorPlanImage({ dataUrl: result, widthPx: img.naturalWidth, heightPx: img.naturalHeight })
        }
        input.value = ''
      }
      img.onerror = () => {
        setUploadError('The uploaded file is not a valid image.')
        input.value = ''
      }
      img.src = result
    }
    reader.readAsDataURL(file)
  }

  function confirmImageUpload() {
    if (!pendingImageUpload) return
    clearFloorPlan()
    setFloorPlanImage(pendingImageUpload)
    setPendingImageUpload(null)
  }

  function handleExportSvg() {
    selectFloorPlanObject(null)
    setTimeout(() => {
      if (!svgRef.current) return
      const rect = svgRef.current.getBoundingClientRect()
      svgRef.current.setAttribute('width', String(Math.round(rect.width)))
      svgRef.current.setAttribute('height', String(Math.round(rect.height)))
      downloadSVG(svgRef.current, 'floor-plan')
      svgRef.current.removeAttribute('width')
      svgRef.current.removeAttribute('height')
    }, 50)
  }

  function handleAddObject(type: FloorPlanObjectType) {
    const def = OBJECT_CATALOG.find(o => o.type === type)
    if (!def) return
    const obj: FloorPlanObject = {
      id: nanoid(),
      type,
      label: def.label,
      x: 100,
      y: 100,
      w: def.defaultW,
      h: def.defaultH,
      rotation: 0,
      color: def.color,
    }
    addFloorPlanObject(obj)
    selectFloorPlanObject(obj.id)
  }

  function handleAddCustomTemplate(templateId: string) {
    const template = floorPlan.customTemplates.find(t => t.id === templateId)
    if (!template) return

    const obj: FloorPlanObject = {
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
    addFloorPlanObject(obj)
    selectFloorPlanObject(obj.id)
  }

  function handleSaveCustomShape(label: string, w: number, h: number) {
    addCustomTemplate({
      id: nanoid(),
      label,
      defaultW: w,
      defaultH: h,
      color: '#f59e0b',
    })
    setShowCustomShape(false)
  }

  function handleCalibrationPoints(distancePx: number) {
    setIsCalibrating(false)
    setPendingDistancePx(distancePx)
  }

  function handleScaleConfirm(pixelsPerMm: number) {
    setFloorPlanScale(pixelsPerMm)
    setPendingDistancePx(null)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-divider bg-panel px-4 py-2">
        <label className="cursor-pointer rounded border border-divider bg-surface px-3 py-1 text-sm text-text-primary hover:bg-surface-raised">
          📷 Upload Image
          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </label>
        <button
          type="button"
          aria-label="Calibrate Scale"
          onClick={() => setIsCalibrating(true)}
          disabled={!floorPlan.image}
          className="rounded border border-divider bg-surface px-3 py-1 text-sm text-text-primary hover:bg-surface-raised disabled:opacity-40"
        >
          📐 Calibrate Scale
        </button>
        {floorPlan.pixelsPerMm && (
          <span className="text-xs text-text-muted">
            Scale: 1px = {(1 / floorPlan.pixelsPerMm).toFixed(2)}mm
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleExportSvg}
          className="rounded border border-divider bg-surface px-3 py-1 text-sm text-text-primary hover:bg-surface-raised disabled:opacity-40"
        >
          Export SVG
        </button>
        <button
          type="button"
          onClick={() => downloadFloorPlanJSON(floorPlan, 'floor-plan')}
          className="rounded border border-divider bg-surface px-3 py-1 text-sm text-text-primary hover:bg-surface-raised"
        >
          Export JSON
        </button>
      </div>

      <div className="border-b border-divider bg-panel px-4 py-2 text-sm text-text-muted">
        <span className="mr-1 text-accent">ℹ</span>
        Floor plan is shared across all projects.
      </div>

      {uploadError && (
        <div role="alert" className="border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {uploadError}
        </div>
      )}
      {pendingImageUpload && (
        <div role="alertdialog" className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 flex items-center gap-4">
          <span>Uploading a new image will clear all placed objects and annotations. Continue?</span>
          <button
            type="button"
            onClick={confirmImageUpload}
            className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-500"
          >Yes, clear and upload</button>
          <button
            type="button"
            onClick={() => setPendingImageUpload(null)}
            className="rounded border border-divider bg-surface px-3 py-1 text-sm text-text-primary hover:bg-surface-raised"
          >Cancel</button>
        </div>
      )}
      {floorPlan.image && !floorPlan.pixelsPerMm && (
        <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
          Image uploaded. Calibrate scale before trusting dimensions or exports.
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <FloorPlanSidebar
          onAddObject={handleAddObject}
          onAddCustomTemplate={handleAddCustomTemplate}
          onAddCustomShape={() => setShowCustomShape(true)}
          onSetAnnotationType={setActiveAnnotationType}
          activeAnnotationType={activeAnnotationType}
        />
        <FloorPlanCanvas
          floorPlan={floorPlan}
          svgRef={svgRef}
          isCalibrating={isCalibrating}
          activeAnnotationType={activeAnnotationType}
          onCalibrationPoints={handleCalibrationPoints}
          onAddAnnotation={addAnnotation}
        />
        <FloorPlanProperties
          obj={selectedObject}
          onUpdate={updateFloorPlanObject as (id: string, patch: Partial<FloorPlanObject>) => void}
          onDelete={removeFloorPlanObject}
        />
      </div>

      {pendingDistancePx !== null && (
        <ScaleCalibrationModal
          distancePx={pendingDistancePx}
          onConfirm={handleScaleConfirm}
          onClose={() => setPendingDistancePx(null)}
        />
      )}
      {showCustomShape && (
        <CustomShapeModal
          onConfirm={handleSaveCustomShape}
          onClose={() => setShowCustomShape(false)}
        />
      )}
    </div>
  )
}
