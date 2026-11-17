import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RecoveryScreen from './RecoveryScreen'
import type { StoredStateFailure } from '../../store/guardedStorage'

const failure = (raw: string): StoredStateFailure => ({
  raw,
  problems: [
    { path: 'state.projects[0].units', code: 'wrong-type', message: 'Expected a list of cabinets.' },
    { path: 'state.activeProjectId', code: 'not-one-of', message: 'The open project is not one of the saved projects.' },
  ],
})
const raw = '{"state":{"projects":[]},"version":3}'

/** jsdom's Blob has no `text()`; its FileReader does. The executor form is required:
 * this tsconfig's lib predates `Promise.withResolvers`. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader()
    fileReader.onload = () => resolve(String(fileReader.result))
    fileReader.onerror = () => reject(fileReader.error)
    fileReader.readAsText(blob)
  })
}

describe('RecoveryScreen', () => {
  // jsdom has no object URLs, and the download is the whole point of the screen.
  const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:stub')
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('buildbox-store', raw)
    vi.stubGlobal('location', { reload: vi.fn() })
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('says what happened and that nothing was changed', () => {
    render(<RecoveryScreen failure={failure(raw)} />)
    expect(screen.getByRole('heading', { name: /can't open the designs saved in this browser/i })).toBeInTheDocument()
    expect(screen.getByText(/nothing has been changed/i)).toBeInTheDocument()
  })

  it('downloads the stored bytes under a timestamped name', async () => {
    const clicked: HTMLAnchorElement[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })
    render(<RecoveryScreen failure={failure(raw)} />)
    await userEvent.click(screen.getByRole('button', { name: /download raw data/i }))

    expect(click).toHaveBeenCalledOnce()
    expect(clicked).toHaveLength(1)
    const [anchor] = clicked
    expect(anchor.href).toBe('blob:stub')
    expect(anchor.download).toMatch(/^buildbox-store-raw-\d{8}-\d{6}\.json$/)
    const [blob] = createObjectURL.mock.calls[0]
    expect(blob.type).toBe('application/json')
    expect(blob.size).toBe(new TextEncoder().encode(raw).byteLength)
    expect(await readBlob(blob)).toBe(raw)
    expect(localStorage.getItem('buildbox-store')).toBe(raw)
  })

  it('lists the problems only when asked', async () => {
    render(<RecoveryScreen failure={failure(raw)} />)
    const toggle = screen.getByRole('button', { name: /show problems/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('problem-list')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(screen.getByTestId('problem-list')).toHaveTextContent('state.projects[0].units — Expected a list of cabinets.')
    await userEvent.click(screen.getByRole('button', { name: /hide problems/i }))
    expect(screen.queryByTestId('problem-list')).not.toBeInTheDocument()
  })

  it('reloads without touching the stored value', async () => {
    render(<RecoveryScreen failure={failure(raw)} />)
    await userEvent.click(screen.getByRole('button', { name: /^reload$/i }))
    expect(location.reload).toHaveBeenCalledOnce()
    expect(localStorage.getItem('buildbox-store')).toBe(raw)
  })

  it('asks before clearing, and clears nothing when the answer is no', async () => {
    render(<RecoveryScreen failure={failure(raw)} />)
    await userEvent.click(screen.getByRole('button', { name: /clear saved data and start over/i }))
    expect(screen.getByRole('heading', { name: 'Clear saved data?' })).toBeInTheDocument()
    expect(screen.getByText(/download raw data first/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('heading', { name: 'Clear saved data?' })).not.toBeInTheDocument()
    expect(localStorage.getItem('buildbox-store')).toBe(raw)
    expect(location.reload).not.toHaveBeenCalled()
  })

  it('removes the stored value only once the clear is confirmed', async () => {
    render(<RecoveryScreen failure={failure(raw)} />)
    await userEvent.click(screen.getByRole('button', { name: /clear saved data and start over/i }))
    await userEvent.click(screen.getByRole('button', { name: /^clear saved data$/i }))
    expect(localStorage.getItem('buildbox-store')).toBeNull()
    expect(location.reload).toHaveBeenCalledOnce()
  })
})
