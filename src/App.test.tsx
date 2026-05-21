import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

test('renders the BuildBox app shell title and ignores undo shortcuts in focused inputs', async () => {
  const { useStore } = await import('./store/store')
  const { default: App } = await import('./App')

  render(<App />)

  expect(screen.getByText('BuildBox')).toBeInTheDocument()

  act(() => {
    useStore.getState().createProject()
  })
  expect(useStore.getState().projects).toHaveLength(2)

  const heightInput = screen.getByLabelText('Height')
  heightInput.focus()
  fireEvent.keyDown(heightInput, { key: 'z', ctrlKey: true })

  expect(useStore.getState().projects).toHaveLength(2)
})

test('unlocking from the sidebar clears fixedSize on the selected node', async () => {
  const { useStore } = await import('./store/store')
  const { default: App } = await import('./App')

  const state = useStore.getState()
  const activeProjectId = state.activeProjectId!
  useStore.setState({
    selectedId: 'a',
    projects: state.projects.map((project) =>
      project.id === activeProjectId
        ? {
            ...project,
            root: {
              id: 'root',
              splitAxis: 'horizontal',
              children: [
                { id: 'a', elementType: 'void', fixedSize: 200, locked: true },
                { id: 'b', elementType: 'void' },
              ],
            },
          }
        : project,
    ),
  })

  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /locked/i }))

  const selectedProject = useStore.getState().projects.find((project) => project.id === activeProjectId)
  expect(selectedProject?.root.children?.[0].locked).toBe(false)
  expect(selectedProject?.root.children?.[0].fixedSize).toBeUndefined()
})
