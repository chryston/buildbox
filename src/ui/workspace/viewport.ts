/**
 * The viewport maths of the Plan View (#55 criterion 3), kept out of the renderer so
 * `Fit` and the cache hold one definition of "centre and scale".
 *
 * The viewport is screen-space: the SVG is drawn under
 * `matrix(zoom,0,0,zoom,panX,panY)`, so `pan` is where the Floor's origin lands in host
 * pixels. That is the shape `ViewportState` has always had in the device-local cache.
 */
export interface Viewport {
  zoom: number
  panX: number
  panY: number
}

/**
 * The device-local view-state cache, read and written through the `PrefsRepository` port
 * by `app` (#20 §4, conflict 15.7). Disposable: #56 switches view keys and old entries
 * are simply dropped, so this port has no delete and no migration.
 */
export interface ViewportCache {
  read(viewKey: string): Promise<Viewport | undefined>
  write(viewKey: string, viewport: Viewport): void
}

export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 10
/** Screen margin kept around the content by `Fit`, as the legacy canvas always did. */
export const FIT_PADDING = 80

export const clampZoom = (zoom: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))

/** The viewport that centres `contentW × contentH` millimetres in the host, at most 10×. */
export function fitViewport(hostW: number, hostH: number, contentW: number, contentH: number): Viewport {
  const zoom = Math.min(
    hostW / (contentW + 2 * FIT_PADDING),
    hostH / (contentH + 2 * FIT_PADDING),
    ZOOM_MAX,
  )
  return { zoom, panX: (hostW - contentW * zoom) / 2, panY: (hostH - contentH * zoom) / 2 }
}

/**
 * Wheel or pinch zoom around the cursor: the Floor point under the pointer stays under it.
 * `mx`/`my` are host-pixel coordinates inside the canvas host.
 */
export function zoomAround(viewport: Viewport, factor: number, mx: number, my: number): Viewport {
  const zoom = clampZoom(viewport.zoom * factor)
  return {
    zoom,
    panX: mx - (mx - viewport.panX) * zoom / viewport.zoom,
    panY: my - (my - viewport.panY) * zoom / viewport.zoom,
  }
}
