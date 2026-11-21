// Picking a Wall face on the canvas (#67 §10, behaviour 26): every parallel face is offered, the
// one under the pointer names itself and says what claiming it does, and the click hands it back to
// the inspector's preview rather than committing anything.
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { RoomFaceCandidate } from '../../../derive'
import type { RoomOutline } from '../../../domain'
import { FacePickLayer } from './FacePickLayer'

const VIEWPORT = { zoom: 1, panX: 0, panY: 0 }
const SQUARE: RoomOutline = {
  kind: 'path',
  path: {
    start: { x: 0, y: 0 },
    segments: [
      { kind: 'line', to: { x: 4000, y: 0 } },
      { kind: 'line', to: { x: 0, y: 3000 } },
      { kind: 'line', to: { x: -4000, y: 0 } },
      { kind: 'line', to: { x: 0, y: -3000 } },
    ],
  },
  segmentIds: ['seg-1', 'seg-2', 'seg-3', 'seg-4'],
}

const face = (over: Partial<RoomFaceCandidate>): RoomFaceCandidate => ({
  wallId: 'wall-a',
  wallRef: 'W-1',
  side: 'left',
  label: `W-1 · Kitchen's side`,
  distanceMm: 250,
  from: { x: 0, y: 250 },
  to: { x: 4000, y: 250 },
  onFace: false,
  outline: SQUARE,
  ...over,
})

function layer(over: Partial<ComponentProps<typeof FacePickLayer>> = {}) {
  const onPick = vi.fn()
  const onCancel = vi.fn()
  render(
    <FacePickLayer
      viewport={VIEWPORT}
      candidates={[face({})]}
      previewKey={null}
      onPick={onPick}
      onCancel={onCancel}
      unit="mm"
      precision={0}
      {...over}
    />,
  )
  return { onPick, onCancel }
}

const hover = (key: string): void => {
  fireEvent.pointerMove(screen.getByTestId(`face-pick-hit-${key}`), { clientX: 100, clientY: 250 })
}

afterEach(cleanup)

describe('picking a wall face on the canvas', () => {
  it('offers every parallel face and says what the click does', () => {
    layer({ candidates: [face({}), face({ wallId: 'wall-b', wallRef: 'W-2', side: 'right', label: 'W-2 · far side', distanceMm: 3200 })] })
    expect(screen.getByTestId('face-pick-hit-wall-a|left')).toBeInTheDocument()
    expect(screen.getByTestId('face-pick-hit-wall-b|right')).toBeInTheDocument()
    expect(screen.getByTestId('face-pick-hint')).toHaveTextContent('Pick a wall face · Esc cancels')
    expect(screen.queryByTestId('face-pick-label')).toBeNull()
  })

  it('names the face under the pointer and the move it makes', () => {
    layer()
    hover('wall-a|left')
    const label = screen.getByTestId('face-pick-label')
    expect(label).toHaveTextContent("W-1 · Kitchen's side")
    expect(label).toHaveTextContent('Moves edge 250 mm')
  })

  it('says No move for the face the edge already lies on', () => {
    layer({ candidates: [face({ distanceMm: 0, onFace: true })] })
    hover('wall-a|left')
    expect(screen.getByTestId('face-pick-label')).toHaveTextContent('No move')
  })

  it('says why a face an arc edge cannot claim is not offered as a move', () => {
    layer({ candidates: [face({ outline: null })] })
    hover('wall-a|left')
    expect(screen.getByTestId('face-pick-label')).toHaveTextContent('Convert to Custom Path to attach this edge')
  })

  it('hands the chosen face back without committing anything', () => {
    const candidate = face({})
    const { onPick } = layer({ candidates: [candidate] })
    fireEvent.pointerDown(screen.getByTestId('face-pick-hit-wall-a|left'))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0] as unknown as [RoomFaceCandidate]).toEqual([candidate])
  })

  it('puts the picker down on Escape or Cancel', async () => {
    const { onCancel } = layer()
    await userEvent.click(screen.getByTestId('face-pick-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByTestId('face-pick-layer'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
