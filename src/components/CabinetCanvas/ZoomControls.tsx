export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 10

interface Props {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFitAll: () => void
}

export default function ZoomControls({ zoom, onZoomIn, onZoomOut, onFitAll }: Props) {
  return (
    <div className="absolute top-4 left-4 z-10 flex gap-1">
      <button
        type="button"
        aria-label="Zoom out"
        disabled={zoom <= ZOOM_MIN}
        onClick={onZoomOut}
        className="flex h-8 w-8 items-center justify-center rounded border border-divider bg-white text-text-primary shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={zoom >= ZOOM_MAX}
        onClick={onZoomIn}
        className="flex h-8 w-8 items-center justify-center rounded border border-divider bg-white text-text-primary shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
      <button
        type="button"
        aria-label="Fit to screen"
        onClick={onFitAll}
        className="flex h-8 w-8 items-center justify-center rounded border border-divider bg-white text-text-primary shadow-sm hover:bg-gray-50"
      >
        ⊡
      </button>
    </div>
  )
}
