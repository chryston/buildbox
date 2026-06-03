import '@testing-library/jest-dom'

// 1. Tell TypeScript that these methods exist on the interfaces
declare global {
  interface SVGElement {
    getScreenCTM(): DOMMatrix | null;
  }
  interface SVGSVGElement {
    createSVGPoint(): DOMPoint;
  }
}

// 2. Provide the JSDOM stubs
if (typeof SVGSVGElement !== 'undefined') {
  SVGSVGElement.prototype.createSVGPoint = function () {
    const pt = {
      x: 0,
      y: 0,
      matrixTransform: (m: DOMMatrix) => ({ x: pt.x, y: pt.y })
    };
    return pt as unknown as DOMPoint;
  };
}

if (typeof SVGElement !== 'undefined') {
  SVGElement.prototype.getScreenCTM = function () {
    return {
      inverse: () => ({})
    } as unknown as DOMMatrix;
  };
}