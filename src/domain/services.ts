/**
 * The Service questions that belong to `domain` (#79).
 *
 * A Service stores a Kind, a shape and the measurements that shape has. Everything else the app shows
 * is arithmetic on those: the Bottom and Top of a Run are its centreline plus or minus half the
 * vertical side of its section, the plan width of a Run is its outside diameter or its rectangular
 * Width. Nothing here knows a Wall — a Service has no host and takes no connection, so there is no
 * relationship to resolve and nothing to keep in step, exactly as for a Beam (#77). Faces are not here
 * either: they come from `geometry.linearElement`, which `derive` calls with the same three inputs a
 * Wall and a Beam hand it.
 *
 * What *is* here beyond the arithmetic is the two short texts a Service is drawn with — its Kind code
 * and its size — because the same two strings appear on the plan, in a warning sentence and in a
 * schedule row, and a Project that spelled them three ways would disagree with itself.
 */
import { servicesOf, type Project, type Service, type ServiceKind } from './project'

/**
 * The code the plan writes for each Kind (#79 §6).
 *
 * These are codes, not names: a Water service is a `Service` everywhere the app speaks of an element,
 * and `W` is what fits beside it on a drawing. The Services decision writes them in ASCII; the drawing
 * renders them as they are, and no Kind is ever used as the element's name.
 */
export const SERVICE_KIND_CODES: Record<ServiceKind, string> = Object.freeze({
  water: 'W',
  drain: 'D',
  gas: 'G',
  electrical: 'E',
  air_con: 'AC',
  other: 'Other',
})

/** The Kind code a Service is drawn with; `other` is drawn with its own label text instead. */
export const serviceKindCode = (service: Service): string =>
  service.kind === 'other' ? (service.label ?? SERVICE_KIND_CODES.other) : SERVICE_KIND_CODES[service.kind]

/**
 * The size text of a Service: `Ø50` for a round section, `80×60` for a rectangular one.
 *
 * The Services decision spells the diameter sign as an ASCII `O` in its own prose; the app renders the
 * real `Ø`, and the multiplication sign the real `×`, because both are legible and neither is a word
 * the banned-word scan could trip over. Millimetres are not written: the Project's display unit and
 * precision are a preference, and this text is geometry read straight off the record.
 */
export const serviceSizeText = (service: Service): string =>
  service.shape === 'riser' || service.section === 'round'
    ? `Ø${String(service.outsideDiameter ?? 0)}`
    : `${String(service.width ?? 0)}×${String(service.depth ?? 0)}`

/**
 * The whole model label a Plan View writes for a Service: `D Ø50`, `AC 80×60`, `W`.
 *
 * Kind code and size, with `other` filling the code slot with its own label text (#79 §6). There is no
 * per-kind symbol and no per-kind graphic: one text, built the same way for every Service, is what
 * keeps a drawing of six Kinds readable as one drawing.
 */
export const servicePlanLabel = (service: Service): string =>
  `${serviceKindCode(service)} ${serviceSizeText(service)}`

/**
 * Every Service of a Project, Existing and proposed together.
 *
 * The read the summary, the export scope and the label rules need when they mean "every Service this
 * Project holds" rather than the Services of one model.
 */
export const allServices = (project: Project): Service[] => [
  ...servicesOf(project.existingModel),
  ...(project.designOptions ?? []).flatMap((option) => servicesOf(option.proposed)),
]
