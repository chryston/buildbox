/**
 * The Migration review (#52 §4; the archive's `MigrationReview` at `8787ba4`).
 *
 * Four steps, and the whole design of this component is that the first two cannot write. They
 * call `inspect()`, which is given no port that writes, and they hold a destination and a set of
 * collision decisions that have nowhere to go until `Migrate and verify` is clicked. That is why
 * the criteria about "nothing before the decision" are testable by rendering this one component
 * against a fake store: there is no path from a click on step one to a port.
 *
 * Two decisions are the reader's and the component refuses to make them. The floor plan's
 * destination has no default — the select starts empty and the plan is refused until something is
 * chosen — and a BuildBox ID that already exists is never overwritten silently. Everything else
 * the review shows was answered by `session`, including which Designs were refused and why.
 *
 * Deviation (d) from the prototype: no prototype notice, no scenario controls, no variant
 * switcher. Deviation (b): the Back up step offers a Backup per Project and `Remove old copy`,
 * neither of which the prototype had. Deviation (c): the success copy says the old data stays
 * until you choose Remove old copy, because it does.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FLOOR_PLAN_SKIP_VALUE,
  floorPlanChoices,
  type InspectedMigration,
  type LegacyMigrationRecord,
  type LibraryRecord,
  type MigrationChoices,
  type MigrationFailure,
  type MigrationProposal,
  type MigrationResult,
  type MigrationStage,
  type Result,
} from '../../session'
import { STRINGS } from '../strings'

/**
 * The migration flows, closed over the ports by `app`.
 *
 * `ui` may not import `persistence` or `package` (#42 §2), and building a plan needs the current
 * revision of the Project a floor plan is being attached to — a number only the store knows. So
 * the component hands over the reader's choices and receives a result, and never sees a port.
 */
export interface MigrationServices {
  /**
   * Steps 1–5. `null` when this browser holds nothing BuildBox recognises as old.
   *
   * Whatever `adopt` was last given is what this inspects, so a file the reader picked is read
   * instead of the browser's own copy — and the browser's copy is left exactly where it was.
   */
  inspect(): Promise<Result<InspectedMigration | null, MigrationFailure>>
  /** §4 criterion 17: the bytes behind a picked file become the review's source. */
  adopt(bytes: Uint8Array): void
  /** Steps 6–7: the plan, the write, and the read-back that decides whether it counted. */
  run(inspected: InspectedMigration, choices: MigrationChoices): Promise<Result<MigrationResult, MigrationFailure>>
  /** §5: one ordinary Backup per Project the review would create, handed to the browser. */
  downloadBackups(
    inspected: InspectedMigration,
    choices: MigrationChoices,
  ): Promise<Result<string[], MigrationFailure>>
  /**
   * §5: the original bytes, unchanged, under a name that says what they are.
   *
   * It takes nothing: `app` read the source before this surface was ever offered, so the bytes
   * are already in the closure. A parameter would invite the review to hand back something else.
   */
  downloadOriginal(): void
  /** §4.7: the old copy, and only the old copy. */
  removeOldCopy(): Promise<Result<LegacyMigrationRecord, MigrationFailure>>
}

export interface MigrationReviewProps {
  migration: MigrationServices
  /** The Library's rows, including trash: the destination list and both collision questions read them. */
  existing: LibraryRecord[]
  /** True when this tab has no durable storage (#51 §6), which is when migration is paused. */
  paused?: boolean
  /** `Do this later`, and `Return to Projects`: the review is a surface, not a gate. */
  onReturn(): void
  /** A toast for the reader who finishes; the Library owns the toast slot. */
  onToast?(message: string): void
}

type Step = 'found' | 'review' | 'verify' | 'done'

const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'found', label: STRINGS.migrationStepFound },
  { key: 'review', label: STRINGS.migrationStepReview },
  { key: 'verify', label: STRINGS.migrationStepVerify },
  { key: 'done', label: STRINGS.migrationStepBackUp },
]

const STAGE_ORDER: MigrationStage[] = ['read', 'convert', 'validate', 'images', 'write', 'read-back']

export function MigrationReview({
  migration,
  existing,
  paused = false,
  onReturn,
  onToast,
}: MigrationReviewProps) {
  const [inspected, setInspected] = useState<InspectedMigration | null>(null)
  const [nothingFound, setNothingFound] = useState(false)
  const [inspectFailure, setInspectFailure] = useState<MigrationFailure | null>(null)

  // Steps 1–5, once. `inspect` is given no way to write, so this effect cannot change anything;
  // the test that proves it renders this component against a store and reads the store back.
  useEffect(() => {
    let live = true
    void migration.inspect().then((outcome) => {
      if (!live) return
      if (!outcome.ok) {
        setInspectFailure(outcome.error)
        return
      }
      if (outcome.value === null) {
        setNothingFound(true)
        return
      }
      setInspected(outcome.value)
    })
    return () => {
      live = false
    }
  }, [migration])

  if (inspectFailure !== null) {
    return (
      <div className="flow-page migration-review">
        <Failure failure={inspectFailure} onReturn={onReturn} />
      </div>
    )
  }
  if (nothingFound) {
    return (
      <div className="flow-page migration-review">
        <p>{STRINGS.migrationNothingFound}</p>
        <div className="flow-actions">
          <button type="button" className="button primary" onClick={onReturn}>
            {STRINGS.migrationReturn}
          </button>
        </div>
      </div>
    )
  }
  if (inspected === null) {
    return (
      <div className="flow-page migration-review" role="status">
        <p>{STRINGS.migrationVerifying}</p>
      </div>
    )
  }
  // Criterion 18: with nowhere to write, the review still has to leave a way out. Reading and
  // converting write nothing, so the two downloads are offered here — a Backup per Project that
  // the plan would create, and the original bytes — and nothing else on this surface is enabled.
  if (paused) {
    return (
      <div className="flow-page migration-review">
        <div className="migration-paused" role="status">
          <p>{STRINGS.migrationPaused}</p>
        </div>
        <div className="flow-actions">
          <button
            type="button"
            disabled={inspected === null}
            onClick={() => {
              if (inspected !== null) void migration.downloadBackups(inspected, { floorPlan: null, collisions: {} })
            }}
          >
            {STRINGS.migrationDownloadOldData}
          </button>
          <button type="button" onClick={() => migration.downloadOriginal()}>
            {STRINGS.migrationDownloadOriginal}
          </button>
        </div>
      </div>
    )
  }
  return (
    <MigrationSteps
      inspected={inspected}
      existing={existing}
      migration={migration}
      onReturn={onReturn}
      onToast={onToast}
    />
  )
}

function MigrationSteps({
  inspected,
  existing,
  migration,
  onReturn,
  onToast,
}: MigrationReviewProps & { inspected: InspectedMigration }) {
  const [step, setStep] = useState<Step>('found')
  const [destination, setDestination] = useState<string | null>(null)
  const [collisions, setCollisions] = useState<MigrationChoices['collisions']>({})
  const [runFailure, setRunFailure] = useState<MigrationFailure | null>(null)
  const [result, setResult] = useState<MigrationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [removed, setRemoved] = useState(false)

  const review = inspected.review
  const proposals = useMemo(() => review.proposals, [review])
  const migratable = proposals.filter((proposal) => proposal.migratable)
  const refused = proposals.filter((proposal) => !proposal.migratable)
  const floorPlan = review.floorPlan
  const destinations = useMemo(() => floorPlanChoices(review, existing), [review, existing])
  const collisionsToAnswer = proposals.filter((proposal) => proposal.collision !== null)
  const collisionsAnswered = collisionsToAnswer.every((proposal) => collisions[proposal.designId] !== undefined)
  const discarded = review.discarded.wallHack + review.discarded.tileZone
  const failure = runFailure
  /** The select speaks strings; the plan speaks destinations. This is the only bridge. */
  const chosen = destinations.find((choice) => choice.value === destination)?.destination ?? null

  const migrate = useCallback(async (): Promise<void> => {
    setBusy(true)
    setRunFailure(null)
    setStep('verify')
    const outcome = await migration.run(inspected, { floorPlan: chosen, collisions })
    if (outcome.ok) {
      setResult(outcome.value)
      setStep('done')
    } else {
      setRunFailure(outcome.error)
    }
    setBusy(false)
  }, [chosen, collisions, inspected, migration])

  const stepIndex = STEPS.findIndex((each) => each.key === step)
  /** Where the floor plan ended up, read off the result rather than off the choice: the plan is
      the thing that ran, and a skipped or refused one has no row to draw. */
  const planOutcome = result?.floorPlan ?? null

  return (
    <div className="flow-page migration-review">
      <div className="stepper" aria-label={STRINGS.migrationStep(stepIndex + 1, STEPS.length)}>
        {STEPS.map((entry, index) => (
          <span key={entry.key} className="stepper-item">
            <span className={`stepper-dot ${index < stepIndex ? 'done' : ''} ${index === stepIndex ? 'active' : ''}`}>
              <span>{entry.label}</span>
            </span>
            {index < STEPS.length - 1 ? <i aria-hidden="true" /> : null}
          </span>
        ))}
      </div>

      {step === 'found' ? (
        <>
          <p className="eyebrow">{STRINGS.migrationEyebrow}</p>
          <h1>{STRINGS.migrationHeading}</h1>
          <p className="lede">
            {STRINGS.migrationLede(migratable.length, floorPlan !== null && !floorPlan.isEmpty ? 1 : 0)}
          </p>

          <section className="migration-layout">
            <div>
              <h2>{STRINGS.migrationProjectsToCreate}</h2>
              {proposals.map((proposal) => (
                <ProposalRow key={proposal.designId} proposal={proposal} />
              ))}
              {refused.length > 0 ? (
                <p className="migration-note">
                  {refused.map((proposal) => `${proposal.name}: ${proposal.problems.join(' ')}`).join('\n')}
                </p>
              ) : null}
              {discarded > 0 ? (
                <p className="migration-note">
                  {STRINGS.migrationSketches(review.discarded.wallHack, review.discarded.tileZone)}
                </p>
              ) : null}
            </div>

            <aside>
              {floorPlan === null || !floorPlan.usable ? (
                <>
                  <h2>{STRINGS.migrationStandaloneFloorPlan}</h2>
                  <p className="migration-note">{floorPlan === null ? STRINGS.migrationNoImage : floorPlan.problems.join(' ')}</p>
                </>
              ) : floorPlan.isEmpty ? (
                <>
                  <h2>{STRINGS.migrationStandaloneFloorPlan}</h2>
                  <p className="migration-note">{STRINGS.migrationFloorPlanEmpty}</p>
                </>
              ) : (
                <>
                  <h2>{STRINGS.migrationStandaloneFloorPlan}</h2>
                  <div className="floor-preview">
                    {STRINGS.migrationFloorPlanImage}
                    <div>
                      {floorPlan.preview === null
                        ? STRINGS.migrationNoImage
                        : STRINGS.migrationPreview(
                            floorPlan.preview.widthPx,
                            floorPlan.preview.heightPx,
                            floorPlan.itemCount,
                          )}
                    </div>
                  </div>
                  {/* Deviation (a): no default. The list is this review's own Projects first, then
                      the local ones whose Floor 1 has no Plan Image, then a separate Project. */}
                  <label>
                    <span>{STRINGS.migrationAttachItTo}</span>
                    <select
                      value={destination ?? ''}
                      onChange={(event) => setDestination(event.target.value === '' ? null : event.target.value)}
                    >
                      <option value="" />
                      {destinations.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.value === FLOOR_PLAN_SKIP_VALUE
                            ? STRINGS.migrationSkip
                            : choice.label === ''
                              ? STRINGS.migrationSeparateProject
                              : choice.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <p className="helper">{STRINGS.migrationUntouchedHelper}</p>
            </aside>
          </section>

          <div className="flow-actions">
            <button type="button" className="button secondary" onClick={onReturn}>
              {STRINGS.migrationDoThisLater}
            </button>
            <button
              type="button"
              className="button primary"
              disabled={
                (floorPlan !== null && floorPlan.usable && !floorPlan.isEmpty && chosen === null) ||
                !collisionsAnswered
              }
              onClick={() => {
                setStep('review')
              }}
            >
              {STRINGS.migrationContinue}
            </button>
          </div>
        </>
      ) : step === 'review' ? (
        <>
          <p className="eyebrow">{STRINGS.migrationEyebrow}</p>
          <h1>{STRINGS.migrationHeading}</h1>
          <section className="panel">
            {collisionsToAnswer.length === 0 ? (
              <p className="migration-note">{STRINGS.migrationUntouchedHelper}</p>
            ) : (
              collisionsToAnswer.map((proposal) => (
                <div className="migration-item" key={proposal.designId}>
                  <div>
                    <strong>{proposal.name}</strong>
                    <p>{STRINGS.migrationCollision(proposal.collision?.name ?? '')}</p>
                  </div>
                  <div className="flow-actions">
                    <button
                      type="button"
                      onClick={() => setCollisions({ ...collisions, [proposal.designId]: 'copy' })}
                    >
                      {STRINGS.migrationKeepBoth}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCollisions({ ...collisions, [proposal.designId]: 'replace' })}
                    >
                      {STRINGS.migrationReplace}
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>
          <div className="flow-actions">
            <button type="button" className="button secondary" onClick={() => setStep('found')}>
              {STRINGS.migrationBack}
            </button>
            <button type="button" className="button primary" disabled={!collisionsAnswered} onClick={() => void migrate()}>
              {STRINGS.migrationMigrateAndVerify}
            </button>
          </div>
        </>
      ) : step === 'verify' ? (
        <>
          <p className="eyebrow">{STRINGS.migrationEyebrow}</p>
          <h1>{STRINGS.migrationHeading}</h1>
          <ol className="migration-stages">
            {STAGE_ORDER.map((stage) => (
              <li key={stage} className={failure?.stage === stage ? 'failed' : failure ? 'passed' : ''}>
                {STRINGS.migrationStages[stage]}
              </li>
            ))}
          </ol>
          {failure !== null ? <Failure failure={failure} onReturn={onReturn} /> : null}
          {failure === null ? <p role="status">{STRINGS.migrationVerifying}</p> : null}
          {failure !== null ? (
            <div className="flow-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setRunFailure(null)
                  setStep('found')
                }}
              >
                {STRINGS.migrationTryAgain}
              </button>
              <button type="button" onClick={() => migration.downloadOriginal()}>
                {STRINGS.migrationDownloadOldData}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="success-page">
          <div className="success-mark" aria-hidden="true">
            ✓
          </div>
          <p className="eyebrow">{STRINGS.migrationVerifiedEyebrow}</p>
          <h1>{STRINGS.migrationVerifiedHeading}</h1>
          <p className="lede">{STRINGS.migrationVerifiedLede}</p>
          <ul className="result-list">
            {(result?.projects ?? [])
              .filter((entry) => !entry.floorPlan)
              .map((entry) => (
                <li key={entry.id}>{STRINGS.migrationResultRow(entry.name, STRINGS.migrationBecameNewProject)}</li>
              ))}
            {planOutcome?.kind === 'attached' ? (
              <li>
                {STRINGS.migrationResultRow(
                  STRINGS.migrationStandaloneFloorPlan,
                  STRINGS.migrationBecameAttached(planOutcome.projectName),
                )}
              </li>
            ) : null}
            {planOutcome?.kind === 'separate' ? (
              <li>
                {STRINGS.migrationResultRow(STRINGS.migrationStandaloneFloorPlan, STRINGS.migrationBecameSeparate)}
              </li>
            ) : null}
            {(result?.notMigrated ?? []).map((row) => (
              <li key={row.designName}>{STRINGS.migrationNotMigratedRow(row.designName)}</li>
            ))}
          </ul>
          <div className="flow-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void migration.downloadBackups(inspected, { floorPlan: chosen, collisions }).then((outcome) => {
                  if (outcome.ok) onToast?.(outcome.value.join(' '))
                  setBusy(false)
                })
              }}
            >
              {STRINGS.migrationDownloadBackup}
            </button>
            <button type="button" onClick={() => migration.downloadOriginal()}>
              {STRINGS.migrationDownloadOriginal}
            </button>
            <button
              type="button"
              className="danger"
              disabled={removed}
              onClick={() => {
                setConfirming(true)
              }}
            >
              {STRINGS.migrationRemoveOldCopy}
            </button>
          </div>
          {/* §4.7: a confirm that names what goes and what stays, rather than the browser's. */}
          {confirming && !removed ? (
            <div className="migration-confirm" role="group">
              <p>{STRINGS.migrationRemoveConfirm}</p>
              <div className="flow-actions">
                <button type="button" className="button secondary" onClick={() => setConfirming(false)}>
                  {STRINGS.cancel}
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    void migration.removeOldCopy().then((outcome) => {
                      if (!outcome.ok) return
                      setRemoved(true)
                      onToast?.(STRINGS.migrationRemoved)
                    })
                  }}
                >
                  {STRINGS.migrationRemoveOldCopy}
                </button>
              </div>
            </div>
          ) : null}
          {removed ? <p role="status">{STRINGS.migrationRemoved}</p> : null}
          <div className="flow-actions">
            <button type="button" className="button primary" onClick={onReturn}>
              {STRINGS.migrationReturn}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** One Design: what it is, and either a tag or the plain reason it will not be copied. */
function ProposalRow({ proposal }: { proposal: MigrationProposal }) {
  return (
    <div className="migration-item">
      <span className="file-icon" aria-hidden="true">
        ▤
      </span>
      <div>
        <strong>{proposal.name}</strong>
        <small>{STRINGS.migrationRowSecondary(proposal.designCount, proposal.hasPlanImage)}</small>
        {proposal.nameTaken ? <small className="migration-hint">{STRINGS.migrationNameTaken}</small> : null}
        {!proposal.migratable ? <small className="migration-hint">{proposal.problems.join(' ')}</small> : null}
      </div>
      <span className={`tag ${proposal.migratable ? '' : 'tag-muted'}`}>
        {proposal.migratable ? STRINGS.migrationTagNewProject : STRINGS.migrationTagNotMigrated}
      </span>
    </div>
  )
}

/** §4.5: the step that stopped, and the plain statement that nothing moved. */
function Failure({ failure, onReturn }: { failure: MigrationFailure; onReturn(): void }) {
  const storage = failure.storage === undefined ? null : STRINGS.migrationFailureStorage[failure.storage]
  return (
    <div className="migration-failure" role="alert">
      <p>{STRINGS.migrationFailure(STRINGS.migrationStages[failure.stage])}</p>
      {failure.problems.length > 0 ? <p>{failure.problems.join(' ')}</p> : null}
      {storage !== null ? <p>{storage}</p> : null}
      <div className="flow-actions">
        <button type="button" className="button secondary" onClick={onReturn}>
          {STRINGS.migrationDoThisLater}
        </button>
      </div>
    </div>
  )
}
