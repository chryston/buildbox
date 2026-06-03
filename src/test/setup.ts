import '@testing-library/jest-dom'

// jsdom doesn't implement SVG geometry methods — provide minimal stubs
if (typeof SVGSVGElement !== 'undefined') {
  SVGSVGElement.prototype.createSVGPoint = function () {
    const pt = { x: 0, y: 0, matrixTransform: (m: DOMMatrix) => ({ x: pt.x, y: pt.y }) }
    return pt as DOMPoint
  }
}

if (typeof SVGElement !== 'undefined') {
  SVGElement.prototype.getScreenCTM = function () {
    return { inverse: () => ({}) } as unknown as DOMMatrix
  }
}
