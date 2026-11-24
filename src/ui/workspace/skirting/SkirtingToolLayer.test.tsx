// The `Skirting` tool (#78 §3, criteria 1–4): a Wall face names itself before anything is written,
// one click skirts the whole face with the numbers the bar shows, and Esc sends nothing.
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { SkirtingFaceTarget } from '../../../derive'
import { SkirtingToolLayer, emptySkirtingDraft } from './SkirtingToolLayer'

const VIEWPORT = { zoom: 1, panX: 0, panY: 0 }

const target = (over: Partial<SkirtingFaceTarget> = {}): SkirtingFaceTarget => ({
  wallId: 'wall-a',
  side: 'left',
  ref: 'W-1',
  roomName: 'Kitchen',
  sideNumber: 1,
  start: 0,
  end: 3600,
  from: { x: 0, y: 0 },
  to: { x: 3600, y: 0 },
  ...over,
})

function layer(over: Partial<ComponentProps<typeof SkirtingToolLayer>> = {}) {
  const onCreate = vi.fn()
  const onCancel = vi.fn()
  const onDraft = vi.fn()
  render(
    <SkirtingToolLayer
      viewport={VIEWPORT}
      targets={[target()]}
      draft={emptySkirtingDraft()}
      onDraft={onDraft}
      onCancel={onCancel}
      onCreate={onCreate}
      unit="mm"
      precision={0}
      {...over}
    />,
  )
  return { onCreate, onCancel, onDraft }
}

const hover = (key: string): void => {
  fireEvent.pointerMove(screen.getByTestId(`skirting-face-hit-${key}`), { clientX: 100, clientY: 0 })
}

afterEach(cleanup)

describe('the Skirting tool', () => {
  it('names the face by the Room it borders, never by left or right', () => {
    layer()
    hover('wall-a|left')
    expect(screen.getByTestId('skirting-face-label')).toHaveTextContent('W-1 · Kitchen side')
  })

  it('numbers an unadjoined face instead of naming a side nobody can see', () => {
    layer({ targets: [target({ roomName: null })] })
    hover('wall-a|left')
    expect(screen.getByTestId('skirting-face-label')).toHaveTextContent('W-1 · side 1')
    expect(screen.getByTestId('skirting-face-label')).not.toHaveTextContent('left')
  })

  it('offers both faces of one Wall as two separate picks', () => {
    layer({
      targets: [
        target(),
        target({ side: 'right', roomName: 'Hall', sideNumber: 2, from: { x: 0, y: 200 }, to: { x: 3600, y: 200 } }),
      ],
    })
    expect(screen.getByTestId('skirting-face-hit-wall-a|left')).toBeInTheDocument()
    expect(screen.getByTestId('skirting-face-hit-wall-a|right')).toBeInTheDocument()
    hover('wall-a|right')
    expect(screen.getByTestId('skirting-face-label')).toHaveTextContent('W-1 · Hall side')
  })

  it('skirts the whole tidied face in one click, with the numbers the bar shows', () => {
    const chosen = target({ start: 120, end: 3480 })
    const { onCreate } = layer({ targets: [chosen] })
    fireEvent.pointerDown(screen.getByTestId('skirting-face-hit-wall-a|left'))
    expect(onCreate).toHaveBeenCalledTimes(1)
    const [sent, numbers] = onCreate.mock.calls[0] as unknown as [SkirtingFaceTarget, { height: number; thickness: number; bottom: number }]
    expect(sent).toBe(chosen)
    // The range is the face's own, so a corner stops the strip where the Wall does (#78 §2).
    expect([sent.start, sent.end]).toEqual([120, 3480])
    expect(numbers).toEqual({ height: 100, thickness: 15, bottom: 0 })
  })

  it('prefills 100 and 15 and says whose measurement they are', () => {
    layer()
    expect(screen.getByTestId('skirting-draft-height')).toHaveValue(100)
    expect(screen.getByTestId('skirting-draft-thickness')).toHaveValue(15)
    expect(screen.getByTestId('skirting-draft-bottom')).toHaveValue(0)
    expect(screen.getByTestId('skirting-draft-height-caption')).toHaveTextContent('measure yours')
    expect(screen.getByTestId('skirting-draft-thickness-caption')).toHaveTextContent('measure yours')
  })

  it('carries an edited number into the click', async () => {
    // The numbers live above the layer, so the test holds them the way the workspace does: the bar
    // edits what it is shown, and the click hands back exactly that.
    const onCreate = vi.fn()
    let current = emptySkirtingDraft()
    const { rerender } = render(
      <SkirtingToolLayer
        viewport={VIEWPORT}
        targets={[target()]}
        draft={current}
        onDraft={(next) => {
          current = next
          rerender(
            <SkirtingToolLayer
              viewport={VIEWPORT}
              targets={[target()]}
              draft={current}
              onDraft={(again) => {
                current = again
              }}
              onCancel={vi.fn()}
              onCreate={onCreate}
              unit="mm"
              precision={0}
            />,
          )
        }}
        onCancel={vi.fn()}
        onCreate={onCreate}
        unit="mm"
        precision={0}
      />,
    )
    fireEvent.change(screen.getByTestId('skirting-draft-height'), { target: { value: '80' } })
    fireEvent.pointerDown(screen.getByTestId('skirting-face-hit-wall-a|left'))
    expect(onCreate.mock.calls[0]?.[1]).toEqual({ height: 80, thickness: 15, bottom: 0 })
  })

  it('puts the tool down on Escape or Cancel without creating anything', () => {
    const { onCreate, onCancel } = layer()
    fireEvent.keyDown(screen.getByTestId('skirting-tool-layer'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('skirting-tool-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onCreate).not.toHaveBeenCalled()
  })
})
