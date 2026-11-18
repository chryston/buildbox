/**
 * The floor-plan SVG export (#55), rehosted from the legacy page's helper: serialise
 * the live `<svg>` at its on-screen size and hand it to a download. `src/utils` is
 * legacy code `ui` may not import, and this is the whole of what the button needs.
 */
export function downloadSvg(svgEl: SVGSVGElement, name: string): void {
  const serializer = new XMLSerializer()
  const svgStr = serializer.serializeToString(svgEl)
  const blob = new Blob([svgStr], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name}.svg`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}
