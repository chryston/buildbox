/**
 * The undo tooltip of a saved-view setting (#70 §2), under `VITE_FF_RENOVATION=true`.
 *
 * The catalogue's default label cannot name what was chosen — the Option's name is Project data and
 * the Display's is `ui/strings` copy — so the card composes the line and `IntentBuilder.build` puts
 * it on the transaction. These are the two halves of that seam, tested together because the bug this
 * guards against is one side forgetting the other: a card that sends the default label leaves the
 * user reading `Undo Set Design Option` with no idea which Option it brings back.
 */
import { describe, expect, it } from 'vitest'
import { RENOVATION_STRINGS } from '../ui'
import { createIntentFactory } from './projectsV2'

const clock = { now: () => '2026-11-22T09:00:00.000Z' }
const ids = (n: number): string[] => Array.from({ length: n }, (_, at) => `id-${at}`)
const factory = createIntentFactory(clock, ids)

describe('the undo label of a saved-view setting', () => {
  it('names the Design Option the card chose', () => {
    expect(RENOVATION_STRINGS.setDesignOption('Option A · Open kitchen')).toBe('Set Design Option: Option A · Open kitchen')
  })

  it('says `none` for `— no Design Option —`, which is a choice and not a missing label', () => {
    expect(RENOVATION_STRINGS.setDesignOption(null)).toBe('Set Design Option: none')
  })

  it('names the Renovation Display', () => {
    expect(RENOVATION_STRINGS.setRenovationDisplay('Combined')).toBe('Set Renovation Display: Combined')
    expect(RENOVATION_STRINGS.setRenovationDisplay('Existing')).toBe('Set Renovation Display: Existing')
  })

  it('reaches the transaction when the caller passes it, and stays on the catalogue default when not', () => {
    const chosen = factory.build(
      'view.setDesignOption',
      { viewId: 'view-0', designOptionId: 'option-a' },
      RENOVATION_STRINGS.setDesignOption('Option A · Open kitchen'),
    )
    expect(chosen.label).toBe('Set Design Option: Option A · Open kitchen')
    const plain = factory.build('designOption.rename', { optionId: 'option-a', name: 'Option B' })
    expect(plain.label).toBe('Rename Design Option')
  })
})
