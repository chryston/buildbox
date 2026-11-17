import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import Toolbar from './Toolbar'
import type { GlobalSettings } from '../../types'

const settings: GlobalSettings = {
  unit: 'mm', height: 800, width: 600, depth: 500,
  thickness: 18, backThickness: 6, toeKick: null, material: 'oak',
}

const fileInput = (): HTMLInputElement => {
  const input = document.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('the toolbar has no file input')
  return input
}

const upload = (body: unknown, name = 'workspace.buildbox.json'): File =>
  new File([typeof body === 'string' ? body : JSON.stringify(body)], name, { type: 'application/json' })

const goodDesign = {
  id: 'p1',
  name: 'Imported',
  units: [{
    type: 'cabinet',
    id: 'u1',
    label: 'Unit 1',
    x: 0,
    y: 0,
    settings,
    root: { id: 'r1', elementType: 'void', accessories: [] },
  }],
}

describe('Toolbar', () => {
  it('calls onSettingsChange with new unit when toggle clicked', () => {
    const onChange = vi.fn()
    render(<Toolbar settings={settings} onSettingsChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'cm' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ unit: 'cm' }))
  })

  it('refuses a malformed file and never reaches the store', async () => {
    const onImport = vi.fn()
    render(<Toolbar settings={settings} onSettingsChange={vi.fn()} onImportWorkspace={onImport} />)
    fireEvent.change(fileInput(), { target: { files: [upload({ version: 1, projects: [{}] })] } })

    expect(await screen.findByRole('heading', { name: /can't be imported/i })).toBeInTheDocument()
    expect(screen.getByTestId('problem-list')).toHaveTextContent('projects[0].id — Missing an id.')
    expect(onImport).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByTestId('problem-list')).not.toBeInTheDocument()
    expect(onImport).not.toHaveBeenCalled()
  })

  it('refuses a file from a newer BuildBox', async () => {
    render(<Toolbar settings={settings} onSettingsChange={vi.fn()} />)
    fireEvent.change(fileInput(), { target: { files: [upload({ version: 2, projects: [goodDesign] })] } })
    expect(await screen.findByTestId('problem-list')).toHaveTextContent('version — This file was written by a newer version of BuildBox.')
  })

  it('refuses a file that is not JSON at all', async () => {
    render(<Toolbar settings={settings} onSettingsChange={vi.fn()} />)
    fireEvent.change(fileInput(), { target: { files: [upload('{')] } })
    expect(await screen.findByTestId('problem-list')).toHaveTextContent('The file is not valid JSON.')
  })

  it('still offers Replace and Merge for a file the reader accepts', async () => {
    const onImport = vi.fn()
    render(<Toolbar settings={settings} onSettingsChange={vi.fn()} onImportWorkspace={onImport} />)
    fireEvent.change(fileInput(), { target: { files: [upload({ version: 1, projects: [goodDesign], activeProjectId: 'p1' })] } })

    const replace = await screen.findByRole('button', { name: /replace workspace/i })
    await userEvent.click(replace)
    expect(onImport).toHaveBeenCalledWith(
      { projects: [goodDesign], activeProjectId: 'p1' },
      'replace',
    )
  })
})
