import { describe, it, expect, vi, beforeEach } from 'vitest'
import { downloadSVG } from './exportSVG'

describe('downloadSVG', () => {
  beforeEach(() => {
    document.body.innerHTML = '<svg id="test-svg"><rect width="100" height="100"/></svg>'
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
  })

  it('creates an anchor and triggers download', () => {
    const realCreateElement = document.createElement.bind(document)
    const createEl = vi.spyOn(document, 'createElement')
    const anchor = realCreateElement('a')
    const clickSpy = vi.spyOn(anchor, 'click').mockImplementation(() => {})
    const removeSpy = vi.spyOn(anchor, 'remove')
    createEl.mockImplementationOnce(() => anchor)

    const svg = document.getElementById('test-svg') as unknown as SVGSVGElement
    downloadSVG(svg, 'my-cabinet')

    expect(anchor.download).toBe('my-cabinet.svg')
    expect(clickSpy).toHaveBeenCalled()
    expect(removeSpy).toHaveBeenCalled()
    createEl.mockRestore()
  })
})
