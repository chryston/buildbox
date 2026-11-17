/**
 * The legacy → domain v1 converter (#43, #20 §3).
 *
 * One call takes the text of any of the three things BuildBox has ever written — the
 * `localStorage['buildbox-store']` envelope, a downloaded `.buildbox.json`, or a saved
 * floor-plan file — and returns a proposal per legacy `Design` plus the global floor plan
 * kept apart from all of them. It is the whole of the migration's data path: the UI that
 * walks a user through it is #52, and the code that writes the result back is #44.
 *
 * What it promises:
 *
 *  - **Pure.** No DOM, no store, no clock, no randomness. Every ID it needs comes from
 *    the injected `newId`, so the same input and the same allocator give byte-identical
 *    output (#20 §2).
 *  - **Total.** Hostile input is answered with `ValidationProblem`s, never an exception.
 *    The frozen reader's validators do the checking; this file only maps and attributes.
 *  - **All or nothing per `Design`.** A `Design` that cannot become a valid Project is
 *    reported whole and rejected; nothing half-converted is handed back.
 *  - **Bounded blast radius.** One broken `Design` never takes the others down, and a
 *    broken floor plan never takes a `Design` down. Only unreadable JSON, an envelope with
 *    no usable version, or a value that is none of the three sources fails the whole
 *    source.
 *
 * It never writes anything: not to storage, not to the store, not to the fixtures.
 */
import { validateProject } from '../../domain'
import { problem, ROOT_PATH, type ValidationProblem } from '../../lib'
import { dedupeDesignIds, dedupeFloorPlanIds } from './dedupe'
import { isRecord, type UnknownRecord } from './guards'
import { mapFloorPlan, projectFromDesign } from './map'
import { migrateLegacyState, upgradeLegacyDesign } from './migrate'
import { MAX_PERSIST_VERSION, WORKSPACE_FILE_VERSION } from './read'
import { validateLegacyDesigns, validateLegacyFloorPlan } from './validate'
import type {
  LegacyAsset,
  LegacyConversion,
  LegacyConversionResult,
  LegacyConversionSource,
  LegacyFloorPlanConversion,
  LegacyProjectProposal,
} from './conversion'
import type { LegacyDesign, LegacyFloorPlanData } from './types'

/** The keys that only a saved floor-plan file has. */
const FLOOR_PLAN_KEYS = ['image', 'pixelsPerMm', 'objects', 'annotations', 'customTemplates'] as const

/** `projects[3].units[1]…` — the design a legacy problem belongs to, if it belongs to one. */
const DESIGN_INDEX = /^projects\[(\d+)\]/

export interface LegacyConvertOptions {
  /**
   * Every ID the conversion invents — each Placed Item, each Floor, each regenerated
   * duplicate — comes from here. Nothing else creates an ID or reads the clock (#20 §2).
   */
  newId: () => string
}

/**
 * Convert the text of a legacy source. `source` is sniffed, not asked for: the three
 * shapes are disjoint enough that `state` means the store envelope, `projects` means a
 * workspace file, and a floor-plan key means a floor-plan file.
 *
 * It is async only because hashing an image goes through WebCrypto (`lib`'s `sha256Hex`).
 */
export async function convertLegacy(
  raw: string,
  options: LegacyConvertOptions,
): Promise<LegacyConversionResult> {
  const { newId } = options

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, problems: [problem(ROOT_PATH, 'bad-json', 'The file is not valid JSON.')] }
  }
  if (!isRecord(parsed)) {
    return { ok: false, problems: [problem(ROOT_PATH, 'wrong-type', 'Expected saved BuildBox data.')] }
  }

  if ('state' in parsed) return convertStore(parsed, newId)
  if ('projects' in parsed) return convertWorkspaceFile(parsed, newId)
  if (FLOOR_PLAN_KEYS.some((key) => key in parsed)) return convertFloorPlanFile(parsed, newId)
  return {
    ok: false,
    problems: [problem(ROOT_PATH, 'unknown-source', 'Expected saved BuildBox data, a workspace file, or a floor plan.')],
  }
}

// --- The store envelope -------------------------------------------------------

async function convertStore(envelope: UnknownRecord, newId: () => string): Promise<LegacyConversionResult> {
  const version = envelope.version
  if (version === undefined) {
    return { ok: false, problems: [problem('version', 'missing-field', 'Missing the version of the saved data.')] }
  }
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { ok: false, problems: [problem('version', 'wrong-type', 'Expected a whole-number data version.')] }
  }
  if (version > MAX_PERSIST_VERSION) {
    return { ok: false, problems: [problem('version', 'newer-version', 'This data was saved by a newer version of BuildBox.')] }
  }
  if (version < 0) {
    return { ok: false, problems: [problem('version', 'out-of-range', 'The saved data version is not supported.')] }
  }

  // The migration runs first, on a copy: a v0 state has no `units` and a v2 one has no
  // floor plan, and the mapping below describes only the shape v3 has.
  const state = migrateLegacyState(envelope.state, version, newId)
  if (!isRecord(state)) {
    return { ok: false, problems: [problem('state', 'wrong-type', 'Expected the saved BuildBox data.')] }
  }

  const designs = convertProjects(state.projects, state.activeProjectId, newId)
  if (!designs.ok) return designs
  const plan = await convertFloorPlan(state.floorPlan, 'floorPlan', newId)

  return done('store', version as LegacyConversion['legacyVersion'], designs.proposals, plan)
}

// --- A downloaded workspace file ----------------------------------------------

async function convertWorkspaceFile(file: UnknownRecord, newId: () => string): Promise<LegacyConversionResult> {
  const rawVersion = file.version
  if (rawVersion !== undefined) {
    if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion)) {
      return { ok: false, problems: [problem('version', 'wrong-type', 'Expected a whole-number file version.')] }
    }
    if (rawVersion > WORKSPACE_FILE_VERSION) {
      return { ok: false, problems: [problem('version', 'newer-version', 'This file was written by a newer version of BuildBox.')] }
    }
    if (rawVersion < 1) {
      return { ok: false, problems: [problem('version', 'out-of-range', 'This file version is no longer supported.')] }
    }
  }
  const version = typeof rawVersion === 'number' ? rawVersion : WORKSPACE_FILE_VERSION

  if (!Array.isArray(file.projects)) {
    return { ok: false, problems: [problem('projects', 'wrong-type', 'Expected a list of projects.')] }
  }
  if (file.projects.length === 0) {
    return { ok: false, problems: [problem('projects', 'empty-list', 'Expected at least one project.')] }
  }

  // The pre-`units` single-design shape, upgraded exactly as today's import does.
  const projects = file.projects.map((project) => upgradeLegacyDesign(project, newId))
  const designs = convertProjects(projects, file.activeProjectId, newId)
  if (!designs.ok) return designs

  // A workspace file has no floor plan at all — it was never part of an export.
  return done('workspace-file', version as 0 | 1 | 2 | 3, designs.proposals, null)
}

// --- A saved floor-plan file --------------------------------------------------

async function convertFloorPlanFile(file: UnknownRecord, newId: () => string): Promise<LegacyConversionResult> {
  const plan = await convertFloorPlan(file, ROOT_PATH, newId)
  return done('floor-plan-file', 3, [], plan)
}

// --- The shared body ----------------------------------------------------------

function done(
  source: LegacyConversionSource,
  legacyVersion: 0 | 1 | 2 | 3,
  projects: LegacyProjectProposal[],
  floorPlan: { conversion: LegacyFloorPlanConversion; assets: LegacyAsset[] } | null,
): LegacyConversionResult {
  const conversion: LegacyConversion = {
    source,
    legacyVersion,
    projects,
    floorPlan: floorPlan === null ? null : floorPlan.conversion,
    assets: floorPlan === null ? [] : floorPlan.assets,
  }
  return { ok: true, conversion }
}

type ProjectsConversion =
  | { ok: true; proposals: LegacyProjectProposal[] }
  | { ok: false; problems: ValidationProblem[] }

/**
 * Every `Design` in the source, each converted on its own: duplicate IDs fixed, the
 * strict legacy validator run, problems attributed to the `Design` they belong to, and
 * what is left mapped and checked against domain v1.
 *
 * The active `Design` comes first, because that is the one the review will open (#20 §3).
 */
function convertProjects(
  rawProjects: unknown,
  activeProjectId: unknown,
  newId: () => string,
): ProjectsConversion {
  const designs = Array.isArray(rawProjects) ? rawProjects : []

  const regeneratedByDesign = designs.map((design, index) =>
    (isRecord(design) ? dedupeDesignIds(design, `projects[${index}]`, newId) : []))

  const byDesign = new Map<number, ValidationProblem[]>()
  const sourceProblems: ValidationProblem[] = []
  for (const found of validateLegacyDesigns(rawProjects, 'projects')) {
    const match = DESIGN_INDEX.exec(found.path)
    const index = match === null ? -1 : Number(match[1])
    if (index < 0 || index >= designs.length) {
      sourceProblems.push(found)
      continue
    }
    const existing = byDesign.get(index)
    if (existing === undefined) byDesign.set(index, [found])
    else existing.push(found)
  }
  // Nothing to convert — an absent or empty `projects` list is a problem with the source.
  if (sourceProblems.length > 0) return { ok: false, problems: sourceProblems }

  const proposals = designs.map((design, index): LegacyProjectProposal => {
    const designRecord = isRecord(design) ? design : {}
    const identity = {
      designId: typeof designRecord.id === 'string' ? designRecord.id : '',
      name: typeof designRecord.name === 'string' ? designRecord.name : '',
    }
    const problems = byDesign.get(index) ?? []
    if (problems.length > 0) return { ...identity, status: 'rejected', problems }

    const project = projectFromDesign(design as LegacyDesign, newId)
    const checked = validateProject(project)
    if (!checked.ok) return { ...identity, status: 'rejected', problems: checked.problems }
    return { ...identity, status: 'ok', project: checked.project, regeneratedIds: regeneratedByDesign[index] ?? [] }
  })

  return { ok: true, proposals: activeFirst(proposals, activeProjectId) }
}

/** The active `Design` first, legacy array order after it. */
function activeFirst(
  proposals: LegacyProjectProposal[],
  activeProjectId: unknown,
): LegacyProjectProposal[] {
  if (typeof activeProjectId !== 'string') return proposals
  const active = proposals.findIndex((proposal) => proposal.designId === activeProjectId)
  if (active <= 0) return proposals
  return [proposals[active] as LegacyProjectProposal, ...proposals.filter((_, index) => index !== active)]
}

/**
 * The floor plan on its own terms: validated as a floor plan, mapped to content, and
 * rejected on its own if either step finds anything. Its problems never reach a `Design`.
 */
async function convertFloorPlan(
  value: unknown,
  basePath: string,
  newId: () => string,
): Promise<{ conversion: LegacyFloorPlanConversion; assets: LegacyAsset[] }> {
  const rejected = (problems: ValidationProblem[]): { conversion: LegacyFloorPlanConversion; assets: LegacyAsset[] } =>
    ({ conversion: { status: 'rejected', problems }, assets: [] })

  const problems = validateLegacyFloorPlan(value, basePath)
  if (problems.length > 0) return rejected(problems)

  const regeneratedIds = dedupeFloorPlanIds(value, basePath, newId)
  const mapped = await mapFloorPlan(value as LegacyFloorPlanData, newId)
  if (!mapped.ok) return rejected(mapped.problems)

  const data = value as LegacyFloorPlanData
  const isEmpty = data.image === null
    && data.objects.length === 0
    && data.annotations.length === 0
    && data.customTemplates.length === 0

  return {
    conversion: {
      status: 'ok',
      isEmpty,
      content: mapped.content,
      discarded: mapped.discarded,
      regeneratedIds,
    },
    assets: mapped.assets,
  }
}
