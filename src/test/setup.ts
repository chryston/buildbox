import '@testing-library/jest-dom'
import { afterEach, beforeEach } from 'vitest'

// Every DOM test that renders a time renders it in the browser's zone, and the zone of the
// machine running the suite is not part of what a test means. Pinning UTC makes a card that
// says `Yesterday, 8:42 PM` say that in Singapore and in the Playwright container alike, which
// is also the zone `e2e/screenshots` pins its browser to.
process.env.TZ = 'UTC'

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
// The Floor workspace (#55) measures its canvas host with a ResizeObserver, asks matchMedia
// whether the window is narrow, and drags with pointer capture. jsdom implements none of the
// three. The observer fires synchronously inside `observe` — which the canvas calls from an
// effect, so the measurement lands in the act scope that rendered it — and the host reports a
// real size so the first `Fit` has something to fit to.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    private readonly callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }
    observe(target: Element): void {
      this.callback([{ target, contentRect: {} as DOMRectReadOnly, borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}

// jsdom always reports zero for these; only the workspace reads them, and it needs a
// non-zero host before it will `Fit` the first viewport.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 })
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 })

if (typeof Element !== 'undefined' && typeof Element.prototype.setPointerCapture === 'undefined') {
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
