//>ff
/**
 * The inspector's renovation block (#70 criteria 12, 13, 14, plus §5's notice, its nothing-selected
 * sentence and its rule that a disabled action is never hidden).
 *
 * The targets are the ones the `renovation-views` fixture really contains — `W-2′` is Option B's
 * proposed replacement of `W-2` (`seed-wall-003`), and Option B is named `Option B · Widened opening`
 * — so the words on screen are the fixture's own, not strings invented for the test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RenovationInspector } from './RenovationInspector'
import type { RenovationInspectorProps, RenovationInspectorTarget } from './RenovationInspector'

const OPTION_B = 'Option B · Widened opening'
const W2 = 'seed-wall-003'
const W2_PRIME = 'views-successor-005'

const proposedWall = (over: Partial<RenovationInspectorTarget> = {}): RenovationInspectorTarget => ({
  id: W2_PRIME,
  ref: 'W-2′',
  kind: 'Wall',
  state: 'proposed',
  owner: OPTION_B,
  replaces: [{ id: W2, ref: 'W-2', display: 'existing', drawn: true }],
  successors: [],
  ...over,
})

const demolishedWall = (): RenovationInspectorTarget => ({
  id: W2,
  ref: 'W-2',
  kind: 'Wall',
  state: 'demolition',
  owner: 'Existing Model (shared)',
  replaces: [],
  successors: [{ id: W2_PRIME, ref: 'W-2′', display: 'proposed', drawn: true }],
})

const baselineWall = (): RenovationInspectorTarget => ({
  id: W2,
  ref: 'W-2',
  kind: 'Wall',
  state: 'existing',
  owner: 'Existing Model (shared)',
  replaces: [],
  successors: [],
})

const noop = (): void => undefined

const renderInspector = (over: Partial<RenovationInspectorProps> = {}): RenovationInspectorProps => {
  const props: RenovationInspectorProps = {
    target: null,
    display: 'combined',
    hasDesignOption: true,
    unavailable: {},
    onAction: noop,
    onSelectEntity: noop,
    ...over,
  }
  render(<RenovationInspector {...props} />)
  return props
}

beforeEach(() => {
  cleanup()
})

describe('the inspector of a Proposed Wall in Combined display (#70 criterion 12)', () => {
  it('names it, badges it Proposed, and says which option owns it', () => {
    renderInspector({ target: proposedWall() })
    expect(screen.getByTestId('renovation-inspector')).toHaveTextContent('W-2′')
    expect(screen.getByTestId('renovation-inspector-badge')).toHaveTextContent('Proposed')
    expect(screen.getByTestId('renovation-inspector-kind')).toHaveTextContent('Wall')
    expect(screen.getByTestId('renovation-inspector-owner')).toHaveTextContent(OPTION_B)
  })

  it('links to what it replaces', () => {
    renderInspector({ target: proposedWall() })
    expect(screen.getByTestId('renovation-inspector-replaces')).toHaveTextContent('W-2')
    expect(screen.getByTestId(`renovation-inspector-link-${W2}`)).toBeInTheDocument()
  })

  it('offers exactly Move and Delete', () => {
    renderInspector({ target: proposedWall() })
    expect(screen.getByTestId('renovation-inspector-action-move')).toBeEnabled()
    expect(screen.getByTestId('renovation-inspector-action-delete')).toBeEnabled()
    expect(screen.queryByTestId('renovation-inspector-action-demolish')).toBeNull()
    expect(screen.queryByTestId('renovation-inspector-action-restore')).toBeNull()
    expect(screen.queryByTestId('renovation-inspector-action-correct')).toBeNull()
  })

  it('hands the action back to the workspace', () => {
    const onAction = vi.fn()
    renderInspector({ target: proposedWall(), onAction })
    fireEvent.click(screen.getByTestId('renovation-inspector-action-move'))
    expect(onAction).toHaveBeenCalledWith('move')
  })
})

describe('the inspector of a demolished Existing Wall (#70 criterion 13)', () => {
  it('badges it Demolition, names the shared baseline as its owner, and offers Restore', () => {
    renderInspector({ target: demolishedWall() })
    expect(screen.getByTestId('renovation-inspector-badge')).toHaveTextContent('Demolition')
    expect(screen.getByTestId('renovation-inspector-owner')).toHaveTextContent('Existing Model (shared)')
    expect(screen.getByTestId('renovation-inspector-successor')).toHaveTextContent('W-2′')
    expect(screen.getByTestId('renovation-inspector-action-restore')).toBeEnabled()
    expect(screen.queryByTestId('renovation-inspector-action-move')).toBeNull()
    expect(screen.queryByTestId('renovation-inspector-action-delete')).toBeNull()
  })
})

describe('the inspector of an Existing Wall in Existing display (#70 criterion 14)', () => {
  it('offers `Correct Existing Model…` as the only action, ready to unlock the record', () => {
    // §7c: the press is no longer a promise of a dialog that does not exist — it is the unlock that
    // hands this entity its handles and fields back.
    renderInspector({ target: baselineWall(), display: 'existing' })
    expect(screen.getByTestId('renovation-inspector-action-correct')).toBeEnabled()
    expect(screen.queryByTestId('renovation-inspector-action-move')).toBeNull()
    expect(screen.queryByTestId('renovation-inspector-action-demolish')).toBeNull()
    expect(screen.queryByTestId('renovation-inspector-action-replace')).toBeNull()
  })

  it('shows no action at all while the Project has no Design Option', () => {
    renderInspector({ target: baselineWall(), display: 'existing', hasDesignOption: false })
    expect(screen.queryByTestId('renovation-inspector-actions')).toBeNull()
  })
})

describe('§5\'s remaining rows', () => {
  it('says where Proposed work is edited when it is seen in Demolition display', () => {
    renderInspector({ target: proposedWall(), display: 'demolition' })
    expect(screen.getByTestId('renovation-inspector-notice')).toHaveTextContent(
      'Proposed work is edited in Proposed or Combined display',
    )
    expect(screen.queryByTestId('renovation-inspector-actions')).toBeNull()
  })

  it('says what to do when nothing is selected', () => {
    renderInspector()
    expect(screen.getByTestId('renovation-inspector-empty')).toHaveTextContent(
      'Nothing selected. Click an entity; click the same spot again to cycle overlapping Existing / Demolition / Proposed candidates.',
    )
  })

  it('keeps a disabled action on screen with its reason', () => {
    renderInspector({
      target: proposedWall({ state: 'existing' }),
      display: 'combined',
      unavailable: { replace: 'Replace… needs the dialog.' },
    })
    expect(screen.getByTestId('renovation-inspector-action-replace')).toBeDisabled()
    expect(screen.getByTestId('renovation-inspector-reason-replace')).toHaveTextContent('Replace… needs the dialog.')
  })
})

describe('the Replaces / Successor links', () => {
  it('selects the linked entity, naming the Display that draws it', () => {
    const onSelectEntity = vi.fn()
    renderInspector({ target: proposedWall(), onSelectEntity })
    fireEvent.click(screen.getByTestId(`renovation-inspector-link-${W2}`))
    expect(onSelectEntity).toHaveBeenCalledWith(W2, 'existing')
  })

  it('says so when the link leads somewhere the current Display does not draw', () => {
    renderInspector({
      target: proposedWall({
        replaces: [{ id: W2, ref: 'W-2', display: 'demolition', drawn: false }],
      }),
    })
    expect(screen.getByTestId(`renovation-inspector-link-${W2}`)).toHaveAttribute(
      'title',
      'Select W-2 — it is drawn in Demolition display',
    )
  })
})
