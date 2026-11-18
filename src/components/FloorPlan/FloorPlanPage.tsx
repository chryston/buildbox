import { useRef, useState } from 'react'
import { downloadSVG } from '../../utils/exportSVG'
import type { FloorPlanObject, FloorPlanObjectType } from '../../types'
import { useLegacyBindings, type PreparedPlanImage } from '../../ui/legacy/bindings'
import FloorPlanCanvas from './FloorPlanCanvas'
import FloorPlanSidebar from './FloorPlanSidebar'
import FloorPlanProperties from './FloorPlanProperties'
import ScaleCalibrationModal from './ScaleCalibrationModal'
import CustomShapeModal from './CustomShapeModal'

export default function FloorPlanPage() {
  const svgRef = useRef<SVGSVGElement>(null)
  const bindings = useLegacyBindings()
  const [isCalibrating, setIsCalibrating] = useState(false)
  const [pendingDistancePx, setPendingDistancePx] = useState<number | null>(null)
  const [showCustomShape, setShowCustomShape] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pendingImageUpload, setPendingImageUpload] = useState<PreparedPlanImage | null>(null)

  const { floorPlan, tool: activeAnnotationType, setTool: setActiveAnnotationType } = bindings
  const floorPlanSelectedId = bindings.floorPlanSelectedId

  const selectedObject = floorPlan.objects.find(o => o.id === floorPlanSelectedId) ?? null

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    if (!file) return

    setUploadError(null)

    if (!file.type.startsWith('image/')) {
      setUploadError('Please choose a valid image file.')
      input.value = ''
      return
    }

    // Decoding, measuring and hashing the bytes is the bindings' job: under the flag that is
    // what turns the upload into an Asset, and the words for a file that will not do.
    const read = await bindings.readPlanImage(file)
    input.value = ''
    if ('message' in read) {
      setUploadError(read.message)
      return
    }

    const hasExistingData = floorPlan.objects.length > 0 || floorPlan.annotations.length > 0
    if (hasExistingData) setPendingImageUpload(read.image)
    else bindings.setPlanImage(read.image, { clearExisting: false })
  }

  function confirmImageUpload() {
    if (!pendingImageUpload) return
    bindings.setPlanImage(pendingImageUpload, { clearExisting: true })
    setPendingImageUpload(null)
  }

  function handleExportSvg() {
    bindings.selectFloorPlanObject(null)
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

  function handleSaveCustomShape(label: string, w: number, h: number) {
    bindings.addCustomTemplate({ label, defaultW: w, defaultH: h, color: '#f59e0b' })
    setShowCustomShape(false)
  }

  function handleCalibrationPoints(distancePx: number) {
    setIsCalibrating(false)
    setPendingDistancePx(distancePx)
  }

  function handleScaleConfirm(pixelsPerMm: number) {
    bindings.setFloorPlanScale(pixelsPerMm)
    setPendingDistancePx(null)
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-2 border-b border-divider bg-panel px-4 py-2">
        <label className="cursor-pointer rounded border border-divider bg-surface px-3 py-1 text-sm text-text-primary hover:bg-surface-raised">
          📷 Upload Image
          <input type="file" accept={bindings.planImageAccept} className="hidden" onChange={handleImageUpload} />
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
          onAddObject={(type: FloorPlanObjectType) => bindings.addFloorPlanObject(type)}
          onAddCustomTemplate={(templateId: string) => bindings.addFloorPlanFromTemplate(templateId)}
          onAddCustomShape={() => setShowCustomShape(true)}
          onSetAnnotationType={setActiveAnnotationType}
          activeAnnotationType={activeAnnotationType}
          onAddAnnotation={bindings.addAnnotation}
        />
        <FloorPlanCanvas
          floorPlan={floorPlan}
          svgRef={svgRef}
          isCalibrating={isCalibrating}
          activeAnnotationType={activeAnnotationType}
          onCalibrationPoints={handleCalibrationPoints}
          onAddAnnotation={bindings.addAnnotation}
        />
        <FloorPlanProperties
          obj={selectedObject}
          onUpdate={bindings.updateFloorPlanObject as (id: string, patch: Partial<FloorPlanObject>) => void}
          onDelete={bindings.removeFloorPlanObject}
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
