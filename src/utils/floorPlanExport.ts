import type { FloorPlanData } from '../types'

export function downloadFloorPlanJSON(data: FloorPlanData, name: string): void {
  const payload = {
    pixelsPerMm: data.pixelsPerMm,
    imageWidthPx: data.image?.widthPx ?? null,
    imageHeightPx: data.image?.heightPx ?? null,
    objects: data.objects,
    annotations: data.annotations,
    customTemplates: data.customTemplates,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name}-floor-plan.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}
