/**
 * The delete-host review (#65 §8, criterion 7's DOM half).
 *
 * The list is the criterion: a Wall that would take two doors with it says which two, Cancel
 * leaves the revision where it was, and Confirm hands back exactly the ids the question listed —
 * which is what makes an Opening added after the question was asked a stale answer the handler
 * refuses (#65 criterion 7's last line).
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { DependencyReview } from '../../../edit'
import { DeleteWallReviewDialog } from './DeleteWallReviewDialog'

const review = (over: Partial<DependencyReview> = {}): DependencyReview => ({
  kind: 'delete-wall',
  wallId: 'w3',
  wallRef: 'W-3',
  openings: [
    { id: 'o1', label: 'Door 1', kind: 'door', text: 'Door 1 · door' },
    { id: 'o2', label: 'Window 1', kind: 'window', text: 'Window 1 · window' },
  ],
  message: 'Delete W-3 and its 2 openings?',
  ...over,
})

describe('DeleteWallReviewDialog', () => {
  it('asks the question and lists every Opening that goes with the Wall', () => {
    render(<DeleteWallReviewDialog review={review()} onConfirm={() => undefined} onCancel={() => undefined} />)
    expect(screen.getByRole('dialog').textContent).toContain('Delete W-3 and its 2 openings?')
    const rows = screen.getAllByTestId('delete-wall-review-row').map((row) => row.textContent)
    expect(rows).toEqual(['Door 1 · door', 'Window 1 · window'])
  })

  it('names the count on the button that says yes', () => {
    render(<DeleteWallReviewDialog review={review()} onConfirm={() => undefined} onCancel={() => undefined} />)
    expect(screen.getByTestId('delete-wall-review-confirm').textContent).toBe('Delete wall and 2 openings')
  })

  it('says one opening in the singular', () => {
    const one = review({
      openings: [{ id: 'o1', label: 'Door 1', kind: 'door', text: 'Door 1 · door' }],
      message: 'Delete W-3 and its opening?',
    })
    render(<DeleteWallReviewDialog review={one} onConfirm={() => undefined} onCancel={() => undefined} />)
    expect(screen.getByTestId('delete-wall-review-confirm').textContent).toBe('Delete wall and 1 opening')
  })

  it('confirms, cancels, and treats Escape as Cancel', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<DeleteWallReviewDialog review={review()} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByTestId('delete-wall-review-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('delete-wall-review-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
