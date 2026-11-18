/**
 * The Restore problem dialog (#50 §4 step 1; named deviation 8).
 *
 * The prototype had no rejection state, so there is nothing to compare this against pixel for
 * pixel — it reuses the modal tokens and has one text action. What it must never do is leave the
 * user guessing about whether something changed: every sentence here ends by saying it did not,
 * because for every one of these refusals that is literally true.
 *
 * `package` emits a code and no prose (#44). `ui/strings` holds the sentences and
 * `RESTORE_CHECK_NAMES` the plain-words name of each check, so this file only chooses between
 * them — which is the part a test can pin.
 */
import { RESTORE_CHECK_NAMES, STRINGS } from '../strings'
import { Modal } from './Modal'
import type { RestoreProblem } from '../../session'
import type { ReactNode } from 'react'

/** The two headings the dialog prints word for word, and the paragraph that goes under each. */
export interface RestoreProblemCopy {
  heading: string
  body: string
}

/**
 * What the dialog says for one refusal.
 *
 * Four refusals get their own sentence because each names a fact the user can act on: the file
 * is an export, it came from a newer build, it came from a preview build, or the write happened
 * and did not read back. Everything else is one check that failed, and the check's plain-words
 * name is more use than a stack trace would be.
 */
export function restoreProblemCopy(problem: RestoreProblem): RestoreProblemCopy {
  if (problem.kind === 'media') {
    return { heading: STRINGS.restoreProblemGeneric, body: STRINGS.restoreProblemBody('Plan Image') }
  }
  if (problem.kind === 'unverified') {
    return { heading: STRINGS.restoreProblemUnverified, body: STRINGS.restoreProblemUnverifiedBody }
  }
  if (problem.kind === 'session') {
    return problem.error === 'guarded'
      ? { heading: STRINGS.restoreProblemGeneric, body: STRINGS.restoreProblemGuarded }
      : { heading: STRINGS.restoreProblemGeneric, body: STRINGS.restoreProblemStorage }
  }

  const { code, detail } = problem.problem
  if (code === 'export-not-backup') {
    return { heading: STRINGS.restoreProblemExport, body: STRINGS.restoreProblemBody(RESTORE_CHECK_NAMES[code]) }
  }
  if (code === 'newer-package' || code === 'newer-schema') {
    // `package` puts the two numbers in `detail` for exactly these two codes (#44); reading
    // them out is the whole reason it carries a detail at all.
    const detected = String(detail?.['detected'] ?? '')
    const supported = String(detail?.['supported'] ?? '')
    return {
      heading: STRINGS.restoreProblemNewer,
      body: code === 'newer-package'
        ? STRINGS.restoreProblemNewerPackage(detected, supported)
        : STRINGS.restoreProblemNewerSchema(detected, supported),
    }
  }
  if (code === 'preview-package') {
    return { heading: STRINGS.restoreProblemPreview, body: STRINGS.restoreProblemPreviewBody }
  }
  return { heading: STRINGS.restoreProblemGeneric, body: STRINGS.restoreProblemBody(RESTORE_CHECK_NAMES[code]) }
}

export const RestoreProblemDialog = ({
  problem,
  onClose,
}: {
  problem: RestoreProblem
  onClose: () => void
}): ReactNode => {
  const { heading, body } = restoreProblemCopy(problem)
  return (
    <Modal eyebrow={STRINGS.eyebrowRestore} heading={heading} onClose={onClose}>
      <p>{body}</p>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          {STRINGS.close}
        </button>
      </div>
    </Modal>
  )
}
