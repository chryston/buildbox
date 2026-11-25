/**
 * The Warning strip as a surface (#66 criteria 1–3, 9, 13).
 *
 * What only the strip can pin: that every row locates, that acknowledging always offers a note
 * and records the decision even when the note is left empty, that `Seen ✓` is a status rather
 * than a button, that a reopened warning still shows the note written before it reopened, and
 * that the strip says nothing about Walls — the sentences come from the copy table, so a row
 * here is a row of the table's making.
 *
 * The engine is not involved: the warnings are hand-made records, and what the strip is tested
 * against is the shape the engine answers, not the answer itself.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WarningStrip } from './WarningStrip'
import type { WarningStripProps } from './WarningStrip'
import type { Warning } from '../../../derive'

const warning = (over: Partial<Warning> = {}): Warning => ({
  key: 'wall_crossing|w-a,w-b|existing',
  type: 'wall_crossing',
  floorId: 'floor-main',
  optionId: null,
  subjects: [
    { type: 'wall', id: 'w-a' },
    { type: 'wall', id: 'w-b' },
  ],
  measured: { mm: 100 },
  messageKey: 'wall_crossing',
  params: { a: 'W-2', b: 'W-5', mm: 100 },
  signature: 'a'.repeat(16),
  status: 'open',
  acknowledgement: null,
  ...over,
})

const acknowledged = warning({
  key: 'wall_overlap|w-c,w-d|existing',
  type: 'wall_overlap',
  subjects: [
    { type: 'wall', id: 'w-c' },
    { type: 'wall', id: 'w-d' },
  ],
  messageKey: 'wall_overlap',
  params: { a: 'W-3', b: 'W-7', mm: 250 },
  status: 'acknowledged',
  acknowledgement: {
    id: 'ack-1',
    warningType: 'wall_overlap',
    subjectIds: ['w-c', 'w-d'],
    designOptionId: null,
    signature: 'b'.repeat(16),
    note: 'Service run, agreed with the engineer',
    acknowledgedAt: '2026-03-04T09:30:00.000Z',
  },
})

const reopened = warning({
  key: 'wall_crossing|w-e,w-f|existing',
  subjects: [
    { type: 'wall', id: 'w-e' },
    { type: 'wall', id: 'w-f' },
  ],
  status: 'reopened',
  acknowledgement: { ...acknowledged.acknowledgement!, id: 'ack-2', note: 'Waiting on the survey' },
})

/** The strip with all three statuses on screen, expanded, and the three callbacks spied on. */
function shown(over: Partial<WarningStripProps> = {}) {
  const onLocate = vi.fn()
  const onAcknowledge = vi.fn()
  const onEditNote = vi.fn()
  const warnings = [warning(), reopened, acknowledged]
  render(
    <WarningStrip warnings={warnings} onLocate={onLocate} onAcknowledge={onAcknowledge} onEditNote={onEditNote} {...over} />,
  )
  fireEvent.click(screen.getByTestId('warning-toggle'))
  return { onLocate, onAcknowledge, onEditNote, warnings }
}

describe('the collapsed bar', () => {
  it('counts what is open and what has been seen', () => {
    render(<WarningStrip warnings={[warning(), reopened, acknowledged]} onLocate={vi.fn()} onAcknowledge={vi.fn()} onEditNote={vi.fn()} />)
    expect(screen.getByTestId('warning-count').textContent).toBe('2 open · 1 seen')
    expect(screen.queryByTestId(`warning-row-${acknowledged.key}`)).toBeNull()
  })

  it('opens and closes without touching a status', () => {
    render(<WarningStrip warnings={[acknowledged]} onLocate={vi.fn()} onAcknowledge={vi.fn()} onEditNote={vi.fn()} />)
    const toggle = screen.getByTestId('warning-toggle')
    fireEvent.click(toggle)
    expect(screen.getByTestId(`warning-row-${acknowledged.key}`).dataset.status).toBe('acknowledged')
    fireEvent.click(toggle)
    expect(screen.queryByTestId(`warning-row-${acknowledged.key}`)).toBeNull()
    // Criterion 2: collapsing and expanding the strip never reopens anything.
    fireEvent.click(toggle)
    expect(screen.getByTestId(`warning-row-${acknowledged.key}`).dataset.status).toBe('acknowledged')
  })
})

describe('the rows', () => {
  it('says what the copy table says, and puts the open ones first', () => {
    const { warnings } = shown()
    expect(screen.getByTestId(`warning-sentence-${warnings[0]!.key}`).textContent).toBe(
      'W-2 crosses W-5 without a join: 100 mm overlap.',
    )
    expect(screen.getByTestId(`warning-sentence-${warnings[2]!.key}`).textContent).toBe(
      'W-3 runs along W-7 for 250 mm without a join.',
    )
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.bb-warnings-row'))
    expect(rows.map((row) => row.dataset.status)).toEqual(['open', 'reopened', 'acknowledged'])
  })

  it('marks the reopened one and keeps the note written before it reopened', () => {
    const { warnings } = shown()
    expect(screen.getByTestId(`warning-status-${warnings[1]!.key}`).textContent).toBe(
      'Reopened after change · Waiting on the survey',
    )
    expect(screen.getByTestId(`warning-status-${warnings[2]!.key}`).textContent).toBe(
      'Seen ✓ · Service run, agreed with the engineer',
    )
  })

  it('offers Acknowledge on an open row and never a button called Seen', () => {
    const { warnings } = shown()
    expect(screen.getByTestId(`warning-acknowledge-${warnings[0]!.key}`).textContent).toBe('Acknowledge')
    const labels = Array.from(document.querySelectorAll('button')).map((button) => button.textContent)
    expect(labels).not.toContain('Seen ✓')
  })

  it('locates from the row and from the button, and never from the note field', () => {
    const { onLocate, onAcknowledge, warnings } = shown()
    const key = warnings[0]!.key
    fireEvent.click(screen.getByTestId(`warning-sentence-${key}`))
    expect(onLocate).toHaveBeenCalledWith(warnings[0])
    fireEvent.click(screen.getByTestId(`warning-locate-${key}`))
    expect(onLocate).toHaveBeenCalledTimes(2)
    // The row is the click target, so its own controls have to stop the click short of it.
    fireEvent.click(screen.getByTestId(`warning-acknowledge-${key}`))
    expect(onLocate).toHaveBeenCalledTimes(2)
    expect(onAcknowledge).not.toHaveBeenCalled()
  })
})

describe('acknowledging', () => {
  it('always offers a note and records the decision even when it is left empty', () => {
    const { onAcknowledge, warnings } = shown()
    const key = warnings[0]!.key
    fireEvent.click(screen.getByTestId(`warning-acknowledge-${key}`))
    const field = screen.getByTestId(`warning-note-${key}`) as HTMLInputElement
    fireEvent.click(screen.getByTestId(`warning-save-${key}`))
    expect(onAcknowledge).toHaveBeenCalledWith(warnings[0], '')
    expect(field.value).toBe('')
  })

  it('sends what was typed', () => {
    const { onAcknowledge, warnings } = shown()
    const key = warnings[0]!.key
    fireEvent.click(screen.getByTestId(`warning-acknowledge-${key}`))
    fireEvent.change(screen.getByTestId(`warning-note-${key}`), { target: { value: 'Gone over it on site' } })
    fireEvent.click(screen.getByTestId(`warning-save-${key}`))
    expect(onAcknowledge).toHaveBeenCalledWith(warnings[0], 'Gone over it on site')
  })

  it('commits on Enter and on blur, and cancels on Escape', () => {
    const { onAcknowledge, onEditNote, warnings } = shown()
    const key = warnings[0]!.key
    fireEvent.click(screen.getByTestId(`warning-acknowledge-${key}`))
    const field = screen.getByTestId(`warning-note-${key}`)
    fireEvent.change(field, { target: { value: 'By Enter' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onAcknowledge).toHaveBeenLastCalledWith(warnings[0], 'By Enter')

    fireEvent.click(screen.getByTestId(`warning-acknowledge-${warnings[1]!.key}`))
    const second = screen.getByTestId(`warning-note-${warnings[1]!.key}`)
    fireEvent.change(second, { target: { value: 'By blur' } })
    fireEvent.blur(second)
    expect(onAcknowledge).toHaveBeenLastCalledWith(warnings[1], 'By blur')

    fireEvent.click(screen.getByTestId(`warning-edit-note-${warnings[2]!.key}`))
    const third = screen.getByTestId(`warning-note-${warnings[2]!.key}`)
    fireEvent.change(third, { target: { value: 'Typed and abandoned' } })
    fireEvent.keyDown(third, { key: 'Escape' })
    expect(screen.queryByTestId(`warning-note-${warnings[2]!.key}`)).toBeNull()
    expect(onEditNote).not.toHaveBeenCalled()
  })

  it('re-acknowledges a reopened warning rather than editing its note', () => {
    // Criterion 4: the new decision carries the new signature, and only the acknowledging
    // Intent writes one. A reopened row whose note was edited instead would stay open forever.
    const { onAcknowledge, onEditNote, warnings } = shown()
    const key = warnings[1]!.key
    fireEvent.click(screen.getByTestId(`warning-acknowledge-${key}`))
    fireEvent.change(screen.getByTestId(`warning-note-${key}`), { target: { value: 'Checked after the survey' } })
    fireEvent.keyDown(screen.getByTestId(`warning-note-${key}`), { key: 'Enter' })
    expect(onAcknowledge).toHaveBeenCalledWith(warnings[1], 'Checked after the survey')
    expect(onEditNote).not.toHaveBeenCalled()
  })

  it('edits an existing note through the note callback, not the acknowledging one', () => {
    const { onEditNote, onAcknowledge, warnings } = shown()
    const key = warnings[2]!.key
    fireEvent.click(screen.getByTestId(`warning-edit-note-${key}`))
    fireEvent.change(screen.getByTestId(`warning-note-${key}`), { target: { value: 'Confirmed on site' } })
    fireEvent.keyDown(screen.getByTestId(`warning-note-${key}`), { key: 'Enter' })
    expect(onEditNote).toHaveBeenCalledWith(warnings[2], 'Confirmed on site')
    expect(onAcknowledge).not.toHaveBeenCalled()
  })
})

describe('a badge clicked on the canvas', () => {
  /** The strip, collapsed, with `scrollIntoView` spied — jsdom defines no such method. */
  function closed() {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const warnings = [warning(), reopened, acknowledged]
    const props = { warnings, onLocate: vi.fn(), onAcknowledge: vi.fn(), onEditNote: vi.fn() }
    const first = render(<WarningStrip {...props} />)
    return { warnings, scrollIntoView, props, rerender: first.rerender }
  }

  it('opens the strip and brings that row into view', () => {
    const { warnings, scrollIntoView, props, rerender } = closed()
    expect(screen.queryByTestId(`warning-row-${warnings[1]!.key}`)).toBeNull()
    rerender(<WarningStrip {...props} focus={{ key: warnings[1]!.key, nonce: 1 }} />)
    expect(screen.getByTestId(`warning-row-${warnings[1]!.key}`)).toBeDefined()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('scrolls again when the same badge is clicked twice', () => {
    const { warnings, scrollIntoView, props, rerender } = closed()
    rerender(<WarningStrip {...props} focus={{ key: warnings[1]!.key, nonce: 1 }} />)
    rerender(<WarningStrip {...props} focus={{ key: warnings[1]!.key, nonce: 2 }} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('leaves a collapsed strip collapsed when nothing was asked of it', () => {
    const { warnings, scrollIntoView } = closed()
    expect(screen.queryByTestId(`warning-row-${warnings[0]!.key}`)).toBeNull()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('offers `Create linked Comment` beside Acknowledge, and only when asked (#80 §11.1)', () => {
    render(
      <WarningStrip
        warnings={[warning()]}
        onLocate={vi.fn()}
        onAcknowledge={vi.fn()}
        onEditNote={vi.fn()}
        onComment={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('warning-toggle'))
    const button = screen.getByTestId(`warning-comment-${warning().key}`)
    expect(button.textContent).toBe('Create linked Comment')
    expect(screen.getByTestId(`warning-acknowledge-${warning().key}`)).not.toBeNull()
  })

  it('hands the whole Warning over, so the note can carry its sentence and key (#80 §11.2)', () => {
    const onComment = vi.fn()
    render(
      <WarningStrip
        warnings={[warning()]}
        onLocate={vi.fn()}
        onAcknowledge={vi.fn()}
        onEditNote={vi.fn()}
        onComment={onComment}
      />,
    )
    fireEvent.click(screen.getByTestId('warning-toggle'))
    fireEvent.click(screen.getByTestId(`warning-comment-${warning().key}`))
    expect(onComment).toHaveBeenCalledTimes(1)
    expect(onComment.mock.calls[0]![0].key).toBe('wall_crossing|w-a,w-b|existing')
  })

  it('links a Comment to a Warning without letting either settle the other (#80 §11.3)', () => {
    // The two are separate Intents over separate collections: `comment.create` writes
    // `project.comments` and nothing else, `warning.acknowledge` writes the Warning's
    // acknowledgement and nothing else. Neither path can reach the other, which is what the
    // criterion is really about — and the round-trip below is the guard against someone wiring
    // them together later because it looked convenient.
    const onComment = vi.fn()
    const onAcknowledge = vi.fn()
    render(
      <WarningStrip
        warnings={[warning()]}
        onLocate={vi.fn()}
        onAcknowledge={onAcknowledge}
        onEditNote={vi.fn()}
        onComment={onComment}
      />,
    )
    fireEvent.click(screen.getByTestId('warning-toggle'))
    fireEvent.click(screen.getByTestId(`warning-comment-${warning().key}`))
    expect(onAcknowledge).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId(`warning-acknowledge-${warning().key}`))
    expect(onComment).toHaveBeenCalledTimes(1)
  })

})
