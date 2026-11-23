/**
 * The renovation block of the saved-view card (#70 §2, criteria 1, 2 and 3).
 *
 * The scene is the committed renovation fixture driven through a real session, because the two
 * settings are Project data on a saved view: what matters is that a click writes the active view,
 * that it is one transaction whose label names what was chosen, and that one undo puts that one
 * setting back. A double of the Project would prove the component fired and nothing about where the
 * value landed.
 *
 * The card is mounted with the same callbacks `FloorWorkspace` gives it — build with the composed
 * label, dispatch — so the label asserted here is the label the undo tooltip reads.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { IntentType, PayloadOf } from '../edit'
import { displayModel, effectiveModel } from '../derive'
import type { PlanView, Project, RenovationDisplay } from '../domain'
import { designOptionsOf, viewDesignOptionId, viewRenovationDisplay } from '../domain'
import {
  PLAN_IMAGE_ACCEPT,
  RENOVATION_STRINGS,
  RenovationErrorBanner,
  RenovationViewSection,
  WorkspaceProvider,
  displayLabel,
  planViewsForFloor,
  workspaceStore,
  type WorkspaceServices,
} from '../ui'
import { openTestView, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

function sceneProject(): Project {
  const seed = JSON.parse(
    readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-36.json'), 'utf8'),
  ) as { projects: { data: Project }[] }
  return structuredClone(seed.projects[0]!.data)
}

const noAssets: WorkspaceServices['assetUrls'] = {
  subscribe: () => () => {},
  urlFor: () => null,
  load: () => {},
  put: () => {},
}

function servicesFor(view: TestView): WorkspaceServices {
  return {
    intent: view.services.intent,
    assetUrls: noAssets,
    readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: [],
    viewportCache: { read: async () => undefined, write: () => {}, readActive: async () => null, writeActive: () => {} },
    exportDrawings: TEST_EXPORT_PORT,
  }
}

let view: TestView
let exportsOpened = 0

/** The Floor's first saved view: what the card is aimed at, and what the Intents name. */
const activeView = (): PlanView => {
  const project = view.project()
  return planViewsForFloor(project, project.floors[0]!.id)[0]!
}

const undoLabel = (): string | null => view.session.getSnapshot().history.undoLabel ?? null

/** One transaction, labelled with what was chosen — the same two lines `FloorWorkspace` runs. */
function sendLabelled<T extends IntentType>(type: T, payload: PayloadOf<T>, label: string): void {
  void view.session.dispatch(view.services.intent.build(type, payload, label))
}

function card(project: Project, viewValue: PlanView | null) {
  return (
    <WorkspaceProvider
      session={view.session}
      services={servicesFor(view)}
      onReturnToProjects={() => {}}
      onShowSaveFailure={() => {}}
    >
      <RenovationViewSection
        view={viewValue}
        options={designOptionsOf(view.project())}
        onSetDesignOption={(designOptionId) => {
          const name = designOptionsOf(view.project()).find((option) => option.id === designOptionId)?.name ?? null
          sendLabelled(
            'view.setDesignOption',
            { viewId: activeView().id, designOptionId },
            RENOVATION_STRINGS.setDesignOption(name),
          )
        }}
        onSetRenovationDisplay={(renovationDisplay: RenovationDisplay) =>
          sendLabelled(
            'view.setRenovationDisplay',
            { viewId: activeView().id, renovationDisplay },
            RENOVATION_STRINGS.setRenovationDisplay(displayLabel(renovationDisplay)),
          )
        }
        onExport={() => {
          exportsOpened += 1
        }}
      />
    </WorkspaceProvider>
  )
}

async function renderCard(next: Project = sceneProject()): Promise<() => void> {
  view = await openTestView(next)
  const { rerender } = render(card(next, activeView()))
  // The card reads the saved view out of the Project it is handed, so a test has to hand it the
  // document the session committed — which is what `FloorWorkspace` does on every revision.
  return () => rerender(card(view.project(), activeView()))
}

let refresh: () => void = () => {}

beforeEach(() => {
  workspaceStore.getState().reset()
  exportsOpened = 0
  refresh = () => {}
})

describe('the saved-view card', () => {
  it('lists `— no Design Option —` first and the Project’s options after it', async () => {
    await renderCard()
    const picker = screen.getByTestId('design-option-picker') as HTMLSelectElement
    expect(picker.options[0]!.textContent).toBe('— no Design Option —')
    expect(picker.options[0]!.value).toBe('')
    expect([...picker.options].slice(1).map((option) => option.textContent)).toEqual(['Option A', 'Option B'])
    expect(picker.value).toBe('')
  })

  it('writes the Option onto the active saved view as one labelled transaction, and one undo puts the choice back', async () => {
    const user = userEvent.setup()
    refresh = await renderCard()
    const optionA = designOptionsOf(view.project()).find((option) => option.name === 'Option A')!.id

    await user.selectOptions(screen.getByTestId('design-option-picker'), optionA)

    await waitFor(() => expect(viewDesignOptionId(activeView())).toBe(optionA))
    expect(undoLabel()).toBe('Set Design Option: Option A')
    act(refresh)
    expect((screen.getByTestId('design-option-picker') as HTMLSelectElement).value).toBe(optionA)

    await act(async () => {
      view.session.undo()
    })
    expect(viewDesignOptionId(activeView())).toBeNull()
    // The Display is untouched by an Option change: two settings, two transactions.
    expect(viewRenovationDisplay(activeView())).toBe('existing')
    act(refresh)
    expect((screen.getByTestId('design-option-picker') as HTMLSelectElement).value).toBe('')
  })

  it('reads `— no Design Option —` back as a choice and undoes back to it', async () => {
    const user = userEvent.setup()
    const project = sceneProject()
    const first = planViewsForFloor(project, project.floors[0]!.id)[0]!
    first.designOptionId = designOptionsOf(project)[0]!.id
    await renderCard(project)
    expect((screen.getByTestId('design-option-picker') as HTMLSelectElement).value).toBe(first.designOptionId)

    await user.selectOptions(screen.getByTestId('design-option-picker'), '')

    await waitFor(() => expect(viewDesignOptionId(activeView())).toBeNull())
    expect(undoLabel()).toBe('Set Design Option: none')
  })

  it('shows the four Displays in reading order, each with one swatch per State it shows', async () => {
    await renderCard()
    const grid = screen.getByTestId('renovation-display-grid')
    expect([...grid.querySelectorAll('button')].map((card) => card.getAttribute('data-testid'))).toEqual([
      'display-existing',
      'display-demolition',
      'display-proposed',
      'display-combined',
    ])
    expect(screen.getByTestId('display-existing')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('display-combined')).toHaveAttribute('data-active', 'false')
    const states = (display: string): string[] =>
      [...screen.getByTestId(`swatches-${display}`).querySelectorAll('.bb-renovation-swatch')].map(
        (swatch) => swatch.getAttribute('data-state') ?? '',
      )
    expect(states('existing')).toEqual(['existing'])
    expect(states('demolition')).toEqual(['existing', 'demolition'])
    expect(states('proposed')).toEqual(['existing', 'proposed'])
    expect(states('combined')).toEqual(['existing', 'demolition', 'proposed'])
  })

  it('writes the Display onto the active saved view as one labelled transaction', async () => {
    const user = userEvent.setup()
    refresh = await renderCard()

    await user.click(screen.getByTestId('display-combined'))

    await waitFor(() => expect(viewRenovationDisplay(activeView())).toBe('combined'))
    expect(undoLabel()).toBe('Set Renovation Display: Combined')
    act(refresh)
    expect(screen.getByTestId('display-combined')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('display-existing')).toHaveAttribute('data-active', 'false')

    await act(async () => {
      view.session.undo()
    })
    expect(viewRenovationDisplay(activeView())).toBe('existing')
    act(refresh)
    expect(screen.getByTestId('display-existing')).toHaveAttribute('data-active', 'true')
  })

  it('renders the Layers slot empty when the caller builds no list, leaves the Paste position empty, and exports on demand', async () => {
    await renderCard()
    // The card holds the slot; the caller inside the flagged branch decides what stands in it. No
    // list passed in is what a flag-off build renders, and #71's own tests mount the real one.
    expect(screen.getByTestId('renovation-layers-slot')).toBeEmptyDOMElement()
    expect(screen.getByTestId('renovation-paste-slot')).toBeEmptyDOMElement()
    expect(screen.getByTestId('renovation-view-section')).not.toHaveTextContent(/Paste/i)
    expect(screen.getByTestId('card-export')).toHaveTextContent('Export…')
    await userEvent.setup().click(screen.getByTestId('card-export'))
    expect(exportsOpened).toBe(1)
  })

  it('renders nothing for a Floor with no saved view to aim', async () => {
    view = await openTestView(sceneProject())
    render(card(sceneProject(), null))
    expect(screen.queryByTestId('renovation-view-section')).toBeNull()
  })
})

/**
 * §6: a Demolition, Proposed or Combined view with no Design Option. The banner is the only thing
 * between a person and the conclusion that their work vanished, so its sentence is quoted whole, and
 * both of its controls are tested as transactions — an escape hatch that cannot be undone is a trap.
 *
 * "Nothing from any option is drawn" is asserted on the derived display model rather than on pixels:
 * the canvas consumes `displayModel` in the next milestone, and the model is where the rule lives.
 */
function banner(project: Project, viewValue: PlanView | null) {
  return (
    <WorkspaceProvider
      session={view.session}
      services={servicesFor(view)}
      onReturnToProjects={() => {}}
      onShowSaveFailure={() => {}}
    >
      <RenovationErrorBanner
        display={viewValue === null ? 'demolition' : viewRenovationDisplay(viewValue)}
        options={designOptionsOf(project)}
        onSetDesignOption={(designOptionId) => {
          const name = designOptionsOf(view.project()).find((option) => option.id === designOptionId)?.name ?? null
          sendLabelled(
            'view.setDesignOption',
            { viewId: activeView().id, designOptionId },
            RENOVATION_STRINGS.setDesignOption(name),
          )
        }}
        onShowExisting={() =>
          sendLabelled(
            'view.setRenovationDisplay',
            { viewId: activeView().id, renovationDisplay: 'existing' },
            RENOVATION_STRINGS.setRenovationDisplay(displayLabel('existing')),
          )
        }
      />
    </WorkspaceProvider>
  )
}

async function renderBanner(display: RenovationDisplay): Promise<() => void> {
  const project = sceneProject()
  // The fixture's saved view starts on Existing with no Option; the error state is the same view with
  // one of the three Option-bound Displays, which is a setting a person can really arrive at.
  project.views[0] = { ...project.views[0]!, renovationDisplay: display }
  view = await openTestView(project)
  const { rerender } = render(banner(project, activeView()))
  return () => rerender(banner(view.project(), activeView()))
}

describe('the error state of a Display with no Design Option', () => {
  for (const display of ['demolition', 'proposed', 'combined'] as const) {
    it(`says what ${display} display is missing, in the issue’s words`, async () => {
      await renderBanner(display)
      expect(screen.getByTestId('renovation-error-text').textContent).toBe(
        `${displayLabel(display)} display needs an active Design Option. Nothing is drawn from options; editing tools are disabled.`,
      )
    })
  }

  it('writes the Option chosen in the banner onto the saved view, and one undo takes it back', async () => {
    const refreshBanner = await renderBanner('demolition')
    const optionA = designOptionsOf(view.project()).find((option) => option.name === 'Option A')!.id
    await userEvent.setup().selectOptions(screen.getByTestId('renovation-error-option'), optionA)
    refreshBanner()
    expect(viewDesignOptionId(activeView())).toBe(optionA)
    expect(undoLabel()).toBe('Set Design Option: Option A')
    await act(async () => {
      view.session.undo()
    })
    refreshBanner()
    expect(viewDesignOptionId(activeView())).toBeNull()
  })

  it('`Show Existing` switches the Display as one undoable transaction', async () => {
    const refreshBanner = await renderBanner('proposed')
    await userEvent.setup().click(screen.getByTestId('show-existing'))
    refreshBanner()
    expect(viewRenovationDisplay(activeView())).toBe('existing')
    expect(undoLabel()).toBe('Set Renovation Display: Existing')
    await act(async () => {
      view.session.undo()
    })
    refreshBanner()
    expect(viewRenovationDisplay(activeView())).toBe('proposed')
  })

  it('draws nothing that any Option owns', async () => {
    const project = sceneProject()
    const floorId = project.floors[0]!.id
    for (const display of ['demolition', 'proposed', 'combined'] as const) {
      const drawn = displayModel(effectiveModel(project, floorId, null), display)
      const states = [drawn.walls, drawn.openings, drawn.rooms, drawn.placedItems].flat().map((row) => row.renovationState)
      expect(states, display).not.toContain('demolition')
      expect(states, display).not.toContain('proposed')
      expect(states.every((row) => row === 'existing'), display).toBe(true)
    }
    // The same Project whose Option does demolish something does draw the demolition, so the rule
    // above is the absence of an Option and not an empty model. The committed seed carries empty
    // Options, so the scene is written here rather than assumed of the fixture.
    const withOption = structuredClone(project)
    const demolished = withOption.existingModel.walls[1]!.id
    withOption.designOptions![0]!.demolishedIds = [demolished]
    const combined = displayModel(effectiveModel(withOption, floorId, withOption.designOptions![0]!.id), 'combined')
    expect(combined.walls.map((row) => row.renovationState)).toContain('demolition')
    expect(
      displayModel(effectiveModel(withOption, floorId, withOption.designOptions![0]!.id), 'existing')
        .walls.map((row) => row.renovationState),
    ).not.toContain('demolition')
  })
})

/**
 * The two halves of criterion 2 that the card itself cannot show: choosing a saved view is navigation
 * and not an Edit Transaction, and undo carries the workspace back to the view the setting was about.
 * The second is asserted on `session.onNavigate`, which is the seam `FloorWorkspace` subscribes to —
 * no test in the repo mounts `FloorWorkspace` under jsdom, so the effect that turns the locator into a
 * `setActiveFloor` call is the one link left unobserved.
 */
describe('navigating saved views', () => {
  it('choosing a different saved view writes no history entry and does not change the revision', async () => {
    const project = sceneProject()
    project.views = [
      ...project.views,
      { ...project.views[0]!, id: 'view-second', name: 'Second view', isDefault: false, renovationDisplay: 'combined' },
    ]
    view = await openTestView(project)
    const first = planViewsForFloor(view.project(), project.floors[0]!.id)[0]!
    const revision = view.session.getSnapshot().revision
    const label = undoLabel()
    const document = JSON.stringify(view.project())
    workspaceStore.getState().setActiveFloor(project.floors[0]!.id, first.id)
    workspaceStore.getState().setActiveView(project.floors[0]!.id, 'view-second')
    expect(view.session.getSnapshot().revision).toBe(revision)
    expect(undoLabel()).toBe(label)
    expect(JSON.stringify(view.project())).toBe(document)
  })

  it('hands the workspace the Floor and saved view the setting was about', async () => {
    const refresh = await renderCard()
    const floorId = view.project().floors[0]!.id
    const target = activeView().id
    const seen: { floorId: string | null; viewId: string | null }[] = []
    const stop = view.session.onNavigate((locator) => {
      seen.push({ floorId: locator.floorId, viewId: locator.viewId })
    })
    await userEvent.setup().click(screen.getByTestId('display-combined'))
    refresh()
    expect(undoLabel()).toBe('Set Renovation Display: Combined')
    await act(async () => {
      view.session.undo()
    })
    stop()
    expect(seen).toEqual([{ floorId, viewId: target }])
  })
})
