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
 * Which Floor is open, and the last Plan View used on each Floor (#56).
 *
 * This is device-local view state exactly like the viewport: the same Project opened on
 * two machines may be looking at two different Floors, and nothing about it belongs in
 * the document, a Backup or history.
 */
export interface ActiveViewState {
  floorId: string | null
  /** The last view used on each Floor, keyed by Floor id. */
  viewsByFloor: Record<string, string>
}

/**
 * The device-local view-state cache, read and written through the `PrefsRepository` port
 * by `app` (#20 §4, conflict 15.7). Disposable: #56 switched view keys to `view:<viewId>`
 * and the old `plan:<floorId>` entries are simply never read again, so this port has no
 * delete and no migration.
 */
export interface ViewportCache {
  read(viewKey: string): Promise<Viewport | undefined>
  write(viewKey: string, viewport: Viewport): void
  readActive(): Promise<ActiveViewState | null>
  writeActive(state: ActiveViewState): void
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
 * The viewport that centres a box of the Floor rather than the whole of it (#66 §13).
 *
 * `pan` is where the Floor's origin lands, so centring a box means putting its own centre at
 * the host's centre: the same arithmetic as `fitViewport`, shifted by the box's corner. The
 * margin is smaller than `Fit`'s because a locate is meant to fill the pane with the thing the
 * reader asked to see.
 */
export function fitRect(hostW: number, hostH: number, box: { x: number; y: number; w: number; h: number }, margin = 48): Viewport {
  const w = Math.max(box.w, 1)
  const h = Math.max(box.h, 1)
  const zoom = clampZoom(Math.min((hostW - 2 * margin) / w, (hostH - 2 * margin) / h))
  return {
    zoom,
    panX: (hostW - w * zoom) / 2 - box.x * zoom,
    panY: (hostH - h * zoom) / 2 - box.y * zoom,
  }
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
