/**
 * Rendering a component that reads its state through `LegacyBindings` (#49).
 *
 * Every view now asks the seam for its data, so a bare `render` has nothing to read. The
 * production entry point provides the store behind that seam; a test does the same thing
 * here, which keeps the components' own suites unchanged apart from this import. This is
 * `legacy-view`'s second entry point, the one only tests may reach (#42 §7).
 */
import { render, type RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { StoreBindingsProvider } from './StoreBindingsProvider'

export function renderWithBindings(ui: ReactElement, options?: RenderOptions): ReturnType<typeof render> {
  return render(<StoreBindingsProvider>{ui}</StoreBindingsProvider>, options)
}
