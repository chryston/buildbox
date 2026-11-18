/**
 * Nothing in this build writes the legacy localStorage key (#53 criterion 1).
 *
 * `buildbox-store` was the pre-Projects app's whole document, written by the zustand `persist`
 * middleware on every edit. #20 §12 makes leaving it untouched the whole rollback story: if this
 * release is reverted, the previous version opens and finds the user's work exactly as it was.
 * One stray write would destroy that, and it would be invisible until someone rolled back — so
 * it is asserted here, on the flows that used to write it.
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { LEGACY_STORE_KEY } from '../platform'
import { PLAN_IMAGE_ACCEPT, WorkspaceProvider, type WorkspaceServices } from '../ui'
import { openTestView, renderWithBindings as render, type TestView } from '../ui/legacy/testing'

/** Every key a `Storage.prototype.setItem` call named since the last `beforeEach`. */
let written: string[]
let setItem: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  written = []
  setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
    written.push(key)
    localStorage.setItem(key, value)
  })
})

afterEach(() => {
  setItem.mockRestore()
  localStorage.clear()
})

describe('the legacy localStorage key', () => {
  let view: TestView
  beforeEach(async () => { view = await openTestView() })

  it('is never written while the app is used and the Project is edited', async () => {
    const user = userEvent.setup()
    const services: WorkspaceServices = {
      intent: view.services.intent,
      assetUrls: view.services.assetUrls,
      readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
      planImageAccept: PLAN_IMAGE_ACCEPT,
      planCatalogue: [{ key: 'sofa-2', label: 'Sofa 2-seater' }],
      viewportCache: { read: async () => undefined, write: () => {} },
    }
    render(
      <WorkspaceProvider
        session={view.session}
        services={services}
        onReturnToProjects={() => {}}
        onShowSaveFailure={() => {}}
      >
        <App />
      </WorkspaceProvider>,
      view,
    )

    // A cabinet edit, a floor-plan edit, a module switch and an undo: the four actions the
    // `persist` middleware used to flush to localStorage.
    await user.click(screen.getAllByTestId(/^void-/)[0]!)
    await user.click(screen.getByRole('button', { name: /add shelf/i }))
    await user.click(screen.getByRole('button', { name: /floor plan/i }))
    await user.click(screen.getByTestId('add-item-menu'))
    await user.click(screen.getByTestId('add-sofa-2'))
    await user.keyboard('{Control>}z{/Control}')

    expect(written).not.toContain(LEGACY_STORE_KEY)
    expect(localStorage.getItem(LEGACY_STORE_KEY)).toBeNull()
  })
})
