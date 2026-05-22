import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadSVG } from './exportSVG'

describe('downloadSVG', () => {
  beforeEach(() => {
    document.body.innerHTML = '<svg id="test-svg"><rect width="100" height="100"/></svg>'
    vi.useFakeTimers()
    Object.assign(globalThis.URL, {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('creates an anchor and triggers download', () => {
    const realCreateElement = document.createElement.bind(document)
    const createEl = vi.spyOn(document, 'createElement')
    const anchor = realCreateElement('a')
    const clickSpy = vi.spyOn(anchor, 'click').mockImplementation(() => {})
    const removeSpy = vi.spyOn(anchor, 'remove')
    createEl.mockImplementationOnce(() => anchor)

    const revokeURL = vi.spyOn(URL, 'revokeObjectURL')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')

    const svg = document.getElementById('test-svg') as unknown as SVGSVGElement
    downloadSVG(svg, 'my-cabinet')

    expect(anchor.download).toBe('my-cabinet.svg')
    expect(clickSpy).toHaveBeenCalled()
    expect(removeSpy).toHaveBeenCalled()
    expect(revokeURL).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(revokeURL).toHaveBeenCalledWith('blob:test')
  })
})
