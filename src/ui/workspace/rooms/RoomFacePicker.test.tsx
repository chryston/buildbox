// The Room-side face picker (#67 §10–§11): one row per Edge, only parallel faces within reach,
// each named by the Room it borders, the chosen one previewed with the move it makes, and no way to
// confirm an attach that would take floor from another Room.
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { RoomFaceCandidate } from '../../../derive'
import type { RoomEdgeRow } from './RoomFacePicker'
import { RoomFacePicker } from './RoomFacePicker'

const row = (over: Partial<RoomEdgeRow> = {}): RoomEdgeRow => ({
  segmentId: 'seg-1',
  edge: 1,
  lengthMm: 3900,
  straight: true,
  attached: null,
  ...over,
})

const face = (over: Partial<RoomFaceCandidate> = {}): RoomFaceCandidate => ({
  wallId: 'wall-a',
  wallRef: 'W-1',
  side: 'right',
  label: "W-1 · Kitchen's side",
  distanceMm: 250,
  from: { x: 0, y: 75 },
  to: { x: 3950, y: 75 },
  onFace: false,
  outline: { kind: 'path', path: { start: { x: 0, y: 0 }, segments: [] }, segmentIds: [] },
  ...over,
})

const noop = (): void => {}

const picker = (over: Partial<ComponentProps<typeof RoomFacePicker>> = {}) => {
  const props: ComponentProps<typeof RoomFacePicker> = {
    edges: [row()],
    openEdge: null,
    candidates: [],
    previewKey: null,
    blocked: null,
    onOpen: noop,
    onPickOnCanvas: noop,
    onPreview: noop,
    onAttach: noop,
    onDetach: noop,
    unit: 'mm',
    precision: 0,
    ...over,
  }
  return render(<RoomFacePicker {...props} />)
}

afterEach(cleanup)

describe('the edge rows', () => {
  it('lists every Edge of the Outline in order, with its length', () => {
    picker({ edges: [row(), row({ segmentId: 'seg-2', edge: 2, lengthMm: 3000 })] })
    const rows = screen.getAllByTestId(/^room-edge-(?!anchor|attach|detach)/)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Edge 1 · Line')
    expect(rows[0]).toHaveTextContent('3,900 mm')
    expect(rows[1]).toHaveTextContent('Edge 2 · Line')
    expect(rows[1]).toHaveTextContent('3,000 mm')
  })

  it('offers no face for an Edge that is not a line, because none can hold it', () => {
    picker({ edges: [row({ straight: false })] })
    expect(screen.getByTestId('room-edge-seg-1')).toHaveTextContent('Edge 1 · Arc')
    expect(screen.queryByTestId('room-edge-attach-seg-1')).not.toBeInTheDocument()
  })

  it('shows what an attached Edge claims and offers Detach instead of Attach', () => {
    picker({ edges: [row({ attached: { wallId: 'wall-a', side: 'right', label: "W-1 · Kitchen's side" } })] })
    expect(screen.getByText("Attached to W-1 · Kitchen's side")).toBeInTheDocument()
    expect(screen.getByTestId('room-edge-detach-seg-1')).toBeInTheDocument()
    expect(screen.queryByTestId('room-edge-attach-seg-1')).not.toBeInTheDocument()
  })
})

describe('opening the list of faces', () => {
  it('asks for the Edge whose row was pressed', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    picker({ onOpen })
    await user.click(screen.getByTestId('room-edge-attach-seg-1'))
    expect(onOpen).toHaveBeenLastCalledWith('seg-1')
  })

  it('closes the row that is already open', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    // The parent owns which row is open, so pressing the open row again is the way out.
    picker({ openEdge: 'seg-1', onOpen })
    await user.click(screen.getByTestId('room-edge-attach-seg-1'))
    expect(onOpen).toHaveBeenLastCalledWith(null)
  })

  it('says so when nothing is parallel and near, rather than showing an empty list', () => {
    picker({ openEdge: 'seg-1', candidates: [] })
    expect(screen.getByTestId('room-face-none')).toHaveTextContent('No wall face is parallel to this edge within reach.')
  })

  it('names each face by the Room it borders and offers the canvas for the rest', async () => {
    const user = userEvent.setup()
    const onPickOnCanvas = vi.fn()
    picker({
      openEdge: 'seg-1',
      candidates: [face(), face({ wallId: 'wall-b', wallRef: 'W-4', side: 'left', label: 'W-4 · Balcony side', distanceMm: 140 })],
      onPickOnCanvas,
    })
    expect(screen.getByTestId('room-face-wall-a|right')).toHaveTextContent("W-1 · Kitchen's side")
    expect(screen.getByTestId('room-face-wall-b|left')).toHaveTextContent('W-4 · Balcony side')
    await user.click(screen.getByTestId('room-face-pick-on-canvas'))
    expect(onPickOnCanvas).toHaveBeenCalled()
  })
})

describe('previewing and confirming', () => {
  it('hands the chosen face to the preview before anything is written', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    const onAttach = vi.fn()
    const candidate = face()
    picker({ openEdge: 'seg-1', candidates: [candidate], onPreview, onAttach })
    await user.click(screen.getByTestId('room-face-pick-wall-a|right'))
    expect(onPreview).toHaveBeenLastCalledWith(candidate)
    expect(onAttach).not.toHaveBeenCalled()
  })

  it('states the move the attach makes and confirms it', async () => {
    const user = userEvent.setup()
    const onAttach = vi.fn()
    const candidate = face()
    picker({ openEdge: 'seg-1', candidates: [candidate], previewKey: 'wall-a|right', onAttach })
    expect(screen.getByTestId('room-face-move-wall-a|right')).toHaveTextContent('Moves edge 250 mm')
    const attach = screen.getByTestId('room-face-attach-wall-a|right')
    expect(attach).toBeEnabled()
    await user.click(attach)
    expect(onAttach).toHaveBeenLastCalledWith(candidate)
  })

  it('says when the Edge already lies on the face', () => {
    const candidate = face({ onFace: true, distanceMm: 0 })
    picker({ openEdge: 'seg-1', candidates: [candidate], previewKey: 'wall-a|right' })
    expect(screen.getByTestId('room-face-move-wall-a|right')).toHaveTextContent('No move')
  })

  it('refuses an attach that would take floor from another Room', () => {
    picker({
      openEdge: 'seg-1',
      candidates: [face()],
      previewKey: 'wall-a|right',
      blocked: 'Overlaps Bedroom by 1.20 m².',
    })
    expect(screen.getByTestId('room-face-blocked-wall-a|right')).toHaveTextContent('Overlaps Bedroom by 1.20 m².')
    expect(screen.getByTestId('room-face-attach-wall-a|right')).toBeDisabled()
  })

  it('lists an Edge a preset cannot slide, and says what would let it', () => {
    const candidate = face({ outline: null })
    picker({ openEdge: 'seg-1', candidates: [candidate], previewKey: 'wall-a|right' })
    expect(screen.getByTestId('room-face-move-wall-a|right')).toHaveTextContent('Convert to Custom Path to attach this edge')
    expect(screen.getByTestId('room-face-attach-wall-a|right')).toBeDisabled()
  })
})

describe('detaching', () => {
  it('drops the claim for the row it was pressed on', async () => {
    const user = userEvent.setup()
    const onDetach = vi.fn()
    picker({
      edges: [row({ attached: { wallId: 'wall-a', side: 'right', label: "W-1 · Kitchen's side" } })],
      onDetach,
    })
    await user.click(screen.getByTestId('room-edge-detach-seg-1'))
    expect(onDetach).toHaveBeenLastCalledWith('seg-1')
  })
})
