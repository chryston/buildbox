//>ff
/**
 * The mapping review a cross-Project paste asks before anything is written (#72 criteria 2, 3, 8, 9,
 * 10, and the dialog half of 11).
 *
 * The review is the one the paste Intent's own preview produces, so the rows below are written the
 * way that preview writes them. What is under test is what the dialog does with them — above all
 * that a suggested layer is offered and never taken, because a name that happens to match is not an
 * answer anybody gave, and pasting work onto a layer nobody chose moves it in front of someone
 * else's filters.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { EntityId, ProposedModel } from '../../../domain'
import type { CopySet, PasteReview } from '../../../edit'
import { LAYER_NEUTRAL_COLOR } from './layersTheme'
import { PasteFromOtherProjectDialog } from './PasteFromOtherProjectDialog'

const FITOUT = 'project-fitout'
const L1 = 'layer-source-demolition'
const L2 = 'layer-source-joinery'
const D1 = 'layer-here-takedown'
const D2 = 'layer-here-structural'
const BLOCKED = 'Switch to Proposed or Combined display to paste new work.'

const review = (over: Partial<PasteReview> = {}): PasteReview => ({
  kind: 'paste-from-project',
  sourceProjectId: FITOUT as EntityId,
  sourceProjectName: 'Unit 4 Fitout',
  entityCount: 3,
  unlayeredCount: 1,
  rows: [
    {
      sourceLayerId: L1 as EntityId,
      sourceLayerName: 'Demolition',
      sourceLayerColor: LAYER_NEUTRAL_COLOR,
      itemCount: 2,
      suggestedLayerId: D1 as EntityId,
      suggestedLayerName: 'Take down',
    },
    {
      sourceLayerId: L2 as EntityId,
      sourceLayerName: 'New joinery',
      sourceLayerColor: LAYER_NEUTRAL_COLOR,
      itemCount: 1,
      suggestedLayerId: null,
      suggestedLayerName: null,
    },
  ],
  notComingAcross: [{ ref: 'Window 3', reason: 'its Wall was not copied' }],
  detached: [{ ref: 'Door 1', reason: 'its host Wall was not copied' }],
  destination: { kind: 'option', designOptionId: 'option-open' as EntityId, designOptionName: 'Open plan' },
  ...over,
})

/** The copy behind the review: one Wall on `Demolition`, which is the ref the row has to name. */
const copySet = (): CopySet => ({
  sourceProjectId: FITOUT as EntityId,
  sourceProjectName: 'Unit 4 Fitout',
  entities: {
    walls: [{ id: 'wall-7', ref: 'W-7', drawingLayerId: L1 }] as unknown as ProposedModel['walls'],
    wallJunctions: [],
    openings: [],
    rooms: [],
    placedItems: [],
  },
  itemDesigns: [],
  layers: [],
  demolishedCount: 0,
  notes: [],
})

const DESTINATIONS = [
  { id: D1 as EntityId, name: 'Take down' },
  { id: D2 as EntityId, name: 'Structural' },
]

const open = (over: Partial<PasteReview> = {}, problem?: string) => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <PasteFromOtherProjectDialog
      review={review(over)}
      copySet={copySet()}
      destinations={DESTINATIONS}
      problem={problem}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  )
  return { onConfirm, onCancel }
}

const confirm = () => screen.getByTestId('paste-dialog-confirm') as HTMLButtonElement
const targetOf = (sourceLayerId: string) => screen.getByTestId(`paste-row-target-${sourceLayerId}`) as HTMLSelectElement

afterEach(cleanup)

describe('the question the paste asks (#72 criteria 2, 3)', () => {
  it('asks one question per layer and has chosen nothing yet', () => {
    open()
    expect(screen.getByTestId('paste-dialog-title').textContent).toBe('Paste from “Unit 4 Fitout” — map Drawing Layers')
    expect(screen.getByTestId('paste-dialog-intro').textContent).toBe(
      '3 entities from “Unit 4 Fitout”. Choose where each layer’s work lands. 1 Unlayered entity stays Unlayered.',
    )
    expect(targetOf(L1).value).toBe('')
    expect(targetOf(L2).value).toBe('')
    expect(confirm().disabled).toBe(true)
  })

  it('lists the copy’s own refs against the layer each stood on', () => {
    open()
    expect(screen.getByTestId(`paste-row-items-${L1}`).textContent).toBe('W-7')
    expect(screen.getByTestId(`paste-row-items-${L2}`).textContent).toBe('')
  })

  it('offers the name match and never takes it', () => {
    open()
    const select = targetOf(L1)
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      '— choose —',
      'Take down (name match)',
      'Structural',
      'Create “Demolition” here',
      'Unlayered',
    ])
    expect(select.value).toBe('')
    expect(confirm().disabled).toBe(true)
  })

  it('takes the suggestion only when it is pressed, and says so by going away', () => {
    open()
    fireEvent.click(screen.getByTestId(`paste-row-use-${L1}`))
    expect(targetOf(L1).value).toBe(`existing:${D1}`)
    expect(screen.queryByTestId(`paste-row-use-${L1}`)).toBeNull()
    // The other layer is still unanswered: one answer is not the whole mapping.
    expect(confirm().disabled).toBe(true)
  })

  it('pastes only once every layer has been answered, with the mapping in the rows’ own order', () => {
    const { onConfirm } = open()
    fireEvent.change(targetOf(L2), { target: { value: 'new' } })
    expect(confirm().disabled).toBe(true)
    fireEvent.click(screen.getByTestId(`paste-row-use-${L1}`))
    expect(confirm().disabled).toBe(false)
    expect(confirm().textContent).toBe('Paste with this mapping')
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledWith(
      [
        { sourceLayerId: L1, target: { kind: 'existing', layerId: D1 } },
        { sourceLayerId: L2, target: { kind: 'new' } },
      ],
      false,
    )
  })

  it('lets a layer be sent to Unlayered, which is an answer too', () => {
    const { onConfirm } = open({ rows: [review().rows[1]] })
    fireEvent.change(targetOf(L2), { target: { value: 'unlayered' } })
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledWith([{ sourceLayerId: L2, target: { kind: 'unlayered' } }], false)
  })
})

describe('what the copy cannot bring (#72 criteria 8, 9, 10)', () => {
  it('says what will not come across and what will be detached, in the review’s own words', () => {
    open()
    const notComing = screen.getByTestId('paste-dialog-not-coming')
    const detached = screen.getByTestId('paste-dialog-detached')
    expect(notComing.textContent).toContain('Will not come across:')
    expect(notComing.textContent).toContain('Window 3 — its Wall was not copied')
    expect(detached.textContent).toContain('Will be detached:')
    expect(detached.textContent).toContain('Door 1 — its host Wall was not copied')
  })

  it('says the Unlayered count in the number it is', () => {
    const { rerender } = render(
      <PasteFromOtherProjectDialog
        review={review({ unlayeredCount: 0 })}
        copySet={copySet()}
        destinations={DESTINATIONS}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByTestId('paste-dialog-intro').textContent).not.toContain('Unlayered')
    rerender(
      <PasteFromOtherProjectDialog
        review={review({ unlayeredCount: 3 })}
        copySet={copySet()}
        destinations={DESTINATIONS}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByTestId('paste-dialog-intro').textContent).toContain('3 Unlayered entities stay Unlayered.')
  })

  it('refuses to offer a paste a Display forbids, however carefully the rows are answered', () => {
    open({ destination: { kind: 'blocked', reason: BLOCKED } })
    fireEvent.click(screen.getByTestId(`paste-row-use-${L1}`))
    fireEvent.change(targetOf(L2), { target: { value: 'unlayered' } })
    expect(screen.getByTestId('paste-dialog-blocked').textContent).toBe(BLOCKED)
    expect(confirm().disabled).toBe(true)
  })

  it('turns the primary into the correction when the copy would land in the shared Existing Model', () => {
    const { onConfirm } = open({ destination: { kind: 'correct-existing' } })
    expect(screen.getByTestId('paste-dialog-danger').textContent).toBe(
      'Existing display: pasted entities join the shared Existing Model and every Design Option will see them.',
    )
    expect(confirm().textContent).toBe('Correct Existing Model and paste')
    fireEvent.click(screen.getByTestId(`paste-row-use-${L1}`))
    fireEvent.change(targetOf(L2), { target: { value: 'new' } })
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledWith(
      [
        { sourceLayerId: L1, target: { kind: 'existing', layerId: D1 } },
        { sourceLayerId: L2, target: { kind: 'new' } },
      ],
      true,
    )
  })

  it('shows a refusal where the press happened, and keeps the dialog up', () => {
    open({}, 'Every layer the copy brings needs an answer before it can be pasted — “New joinery” has none.')
    expect(screen.getByTestId('paste-dialog-problem').textContent).toBe(
      'Every layer the copy brings needs an answer before it can be pasted — “New joinery” has none.',
    )
    expect(screen.getByTestId('paste-dialog')).not.toBeNull()
  })
})

describe('backing out (#72 criterion 4)', () => {
  it('cancels by Escape and by the button, and writes nothing either way', () => {
    const { onConfirm, onCancel } = open()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('paste-dialog-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
