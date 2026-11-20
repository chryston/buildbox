/**
 * Rasterizing a PNG, off the DOM (#61 §9).
 *
 * `export` paints through `Rasterizer` rather than reaching for `document.createElement('canvas')`
 * because the same drawing has to come out the same whether it was painted in a Worker or, when
 * there is no Worker, on the main thread. `OffscreenCanvas` is the one surface that exists in
 * both, with the same text layout and the same PNG encoder behind it, so this file is written
 * once and used from either side of the `postMessage` boundary.
 *
 * Claimed out of `platform` by name in `eslint.config.js`, along with the Worker it serves: it is
 * the only place outside `export` that knows what a `RasterSurface` is.
 */
import type { RasterImage, Rasterizer, RasterSurface } from '../export'

/** A 2D context, from either side of the Worker boundary. */
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * A `Rasterizer` over `OffscreenCanvas`, or `null` where there is none.
 *
 * `null` is the whole failure vocabulary: `export` reports PNG as not written rather than
 * guessing at pixels, and the caller decides what to tell the reader.
 */
export function createRasterizer(): Rasterizer | null {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') return null
  return {
    async decode(bytes: Uint8Array, mediaType: string): Promise<RasterImage | null> {
      try {
        const blob = new Blob([bytes as BlobPart], { type: mediaType })
        return (await createImageBitmap(blob)) as unknown as RasterImage
      } catch {
        // A Plan Image the browser cannot read is the importer's problem, not the drawing's: the
        // sheet is still correct without it, and `export` drops the image and says so.
        return null
      }
    },
    create(width: number, height: number): RasterSurface | null {
      if (width < 1 || height < 1) return null
      try {
        const canvas = new OffscreenCanvas(width, height)
        const context = canvas.getContext('2d')
        return context === null ? null : new CanvasSurface(canvas, context)
      } catch {
        return null
      }
    },
  }
}

/**
 * The narrow surface `export` paints on.
 *
 * Every drawing call is forwarded to the context that owns the pixels; `toBlob` belongs to the
 * canvas, which is why this is an object of its own rather than the context itself. Nothing here
 * interprets anything — it is the thinnest possible seam between a port `export` can test without
 * a browser and the browser's own rasterizer.
 */
class CanvasSurface implements RasterSurface {
  constructor(
    private readonly canvas: OffscreenCanvas,
    private readonly context: Context2D,
  ) {}

  get width(): number {
    return this.canvas.width
  }

  get height(): number {
    return this.canvas.height
  }

  get fillStyle(): string {
    return String(this.context.fillStyle)
  }
  set fillStyle(value: string) {
    this.context.fillStyle = value
  }

  get strokeStyle(): string {
    return String(this.context.strokeStyle)
  }
  set strokeStyle(value: string) {
    this.context.strokeStyle = value
  }

  get lineWidth(): number {
    return this.context.lineWidth
  }
  set lineWidth(value: number) {
    this.context.lineWidth = value
  }

  get lineDashOffset(): number {
    return this.context.lineDashOffset
  }
  set lineDashOffset(value: number) {
    this.context.lineDashOffset = value
  }

  get globalAlpha(): number {
    return this.context.globalAlpha
  }
  set globalAlpha(value: number) {
    this.context.globalAlpha = value
  }

  get font(): string {
    return this.context.font
  }
  set font(value: string) {
    this.context.font = value
  }

  get textAlign(): string {
    return this.context.textAlign
  }
  set textAlign(value: string) {
    // The port speaks `string` because `export` may not name DOM enums; the canvas does.
    this.context.textAlign = value as CanvasTextAlign
  }

  get textBaseline(): string {
    return this.context.textBaseline
  }
  set textBaseline(value: string) {
    this.context.textBaseline = value as CanvasTextBaseline
  }

  save(): void {
    this.context.save()
  }
  restore(): void {
    this.context.restore()
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.context.setTransform(a, b, c, d, e, f)
  }
  translate(x: number, y: number): void {
    this.context.translate(x, y)
  }
  rotate(angleRad: number): void {
    this.context.rotate(angleRad)
  }
  beginPath(): void {
    this.context.beginPath()
  }
  moveTo(x: number, y: number): void {
    this.context.moveTo(x, y)
  }
  lineTo(x: number, y: number): void {
    this.context.lineTo(x, y)
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.context.bezierCurveTo(c1x, c1y, c2x, c2y, x, y)
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.context.quadraticCurveTo(cx, cy, x, y)
  }
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    anticlockwise?: boolean,
  ): void {
    this.context.ellipse(cx, cy, rx, ry, rotation, start, end, anticlockwise)
  }
  closePath(): void {
    this.context.closePath()
  }
  fill(): void {
    this.context.fill()
  }
  stroke(): void {
    this.context.stroke()
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.context.fillRect(x, y, width, height)
  }
  setLineDash(segments: readonly number[]): void {
    this.context.setLineDash([...segments])
  }
  fillText(text: string, x: number, y: number): void {
    this.context.fillText(text, x, y)
  }
  drawImage(image: RasterImage, dx: number, dy: number, dw: number, dh: number): void {
    this.context.drawImage(image as unknown as CanvasImageSource, dx, dy, dw, dh)
  }

  async toBlob(): Promise<Uint8Array | null> {
    try {
      const blob = await this.canvas.convertToBlob({ type: 'image/png' })
      return new Uint8Array(await blob.arrayBuffer())
    } catch {
      return null
    }
  }
}
