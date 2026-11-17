import '@testing-library/jest-dom'
import { afterEach, beforeEach } from 'vitest'

// An act(...) warning means a test raced a React update: the assertions may have run
// against a half-committed tree while the suite still reported green. Turn the warning
// into a failure so the log stays trustworthy; every other console.error passes through.
const nativeConsoleError = console.error

beforeEach(() => {
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('not wrapped in act(')) {
      nativeConsoleError(...args)
      throw new Error('React act() warning: wrap the update in act(...) or await it with findBy*/waitFor.')
    }
    return nativeConsoleError(...args)
  }
})

afterEach(() => {
  console.error = nativeConsoleError
})

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
      matrixTransform: () => ({ x: pt.x, y: pt.y })
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