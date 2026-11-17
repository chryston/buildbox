import { ROOT_PATH, type ValidationProblem } from '../../package'

/** How many problems an error surface lists before collapsing the rest (#40 §2). */
export const MAX_VISIBLE_PROBLEMS = 20

/**
 * The one list format for validation problems: `<path> — <message>`, first
 * `MAX_VISIBLE_PROBLEMS` of them, then "…and N more". Shared by the import error and the
 * recovery screen so a problem reads the same wherever it turns up.
 */
export default function ProblemList({ problems }: { problems: ValidationProblem[] }) {
  const shown = problems.slice(0, MAX_VISIBLE_PROBLEMS)
  const hidden = problems.length - shown.length

  return (
    <ul className="mb-3 max-h-48 space-y-1 overflow-y-auto text-xs text-red-400" data-testid="problem-list">
      {shown.map((problem, i) => (
        <li key={`${problem.path}:${problem.code}:${i}`} data-testid="problem">
          {problem.path === ROOT_PATH ? problem.message : `${problem.path} — ${problem.message}`}
        </li>
      ))}
      {hidden > 0 && <li data-testid="problem-more">…and {hidden} more</li>}
    </ul>
  )
}
