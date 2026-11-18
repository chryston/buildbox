import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'
import App from './App'
import type { Project } from './domain'
import { STRINGS } from './ui/strings'
import { uiStore } from './ui/legacy/uiStore'
import { openTestView, renderWithBindings as render, type TestView } from './ui/legacy/testing'
import { flush, testCabinet, testProject } from './session/testing'

/** The New Project with its lower space pinned at 200 mm and locked. */
function lockedProject(): Project {
  const project = testProject('p-1')
  const design = testCabinet(project)
  return {
    ...project,
    itemDesigns: [{
      ...design,
      construction: {
        ...design.construction,
        root: {
          id: 'root',
          splitAxis: 'horizontal',
          children: [
            { id: 'a', elementType: 'void', fixedSize: 200, locked: true },
            { id: 'b', elementType: 'void' },
          ],
        },
      },
    }],
  }
}

let view: TestView
beforeEach(async () => { view = await openTestView() })

test('renders the BuildBox app shell title and ignores undo shortcuts in focused inputs', async () => {
  render(<App />, view)

  expect(screen.getByText('BuildBox')).toBeInTheDocument()

  // One change, so there is something to undo — then the shortcut, from inside a field, which
  // belongs to the text caret and not to the app.
  await view.dispatch('cabinet.addShelf', { itemDesignId: testCabinet(view.project()).id, nodeId: 'root' })
  const afterShelf = view.project()

  const heightInput = screen.getByLabelText('Height')
  heightInput.focus()
  fireEvent.keyDown(heightInput, { key: 'z', ctrlKey: true })

  // Drain the session inside an act scope: had the shortcut reached it, the notification would
  // land here and this assertion would fail instead of escaping as a stray render.
  await act(async () => { await flush() })
  expect(view.project()).toEqual(afterShelf)
})

test('unlocking from the sidebar clears fixedSize on the selected node', async () => {
  const pinned = await openTestView(lockedProject())
  act(() => uiStore.getState().selectNode('a'))

  render(<App />, pinned)
  fireEvent.click(screen.getByRole('button', { name: /locked/i }))

  const root = await waitFor(() => {
    const tree = testCabinet(pinned.project()).construction.root
    expect(tree.children?.[0].locked).toBe(false)
    return tree
  })
  expect(root.children?.[0].fixedSize).toBeUndefined()
})

// The project bar is gone: the Library chooses the Project, and the editor's one control is the
// way back to it (#53).
test('the editor asks to go back to the Project Library', () => {
  render(<App />, view)
  fireEvent.click(screen.getByRole('button', { name: STRINGS.returnToProjects }))
  expect(view.returnToProjects).toHaveBeenCalled()
})
