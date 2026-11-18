/**
 * Reading an uploaded Plan Image in a browser (#49, #20 §5).
 *
 * The bytes are hashed as uploaded — the hash is the Asset key, so the same picture
 * uploaded twice is stored once. Dimensions come from the decoder rather than the file's
 * own claim, because `PlanImage.widthPx` is what the Plan Space is scaled by.
 */
import { sha256Hex } from '../lib'
import type { Result } from '../persistence'
import type { ImageDecoderPort } from '../session'

/**
 * The formats a Plan Image may be (#49 deviation 4).
 *
 * The legacy editor accepted any `image/*` and stored a data URL of whatever arrived;
 * domain v1 names three formats on the Plan Image itself, so an upload of anything else is
 * refused at the door. `platform` may not import `domain`, so this is the same union spelled
 * out here — `app` is where the two meet, and they are structurally identical.
 */
export type PlanImageMedia = 'image/png' | 'image/jpeg' | 'image/webp'

const PLAN_IMAGE_MEDIA: readonly string[] = ['image/png', 'image/jpeg', 'image/webp']

/** What one upload yields: the bytes, their hash, and what the decoder saw. */
export interface PlanImageSource {
  readonly bytes: Blob
  readonly sha256: string
  readonly mediaType: PlanImageMedia
  readonly widthPx: number
  readonly heightPx: number
}

/**
 * An `ImageDecoderPort` over `createImageBitmap` (#50 §4 step 7, #20 §6).
 *
 * The same decoder that checks an upload checks a Backup's Plan Images, which is the point: a
 * Backup restored on the machine that wrote it must decode the same way, and a Floor whose
 * record claims dimensions the decoder disagrees with is refused rather than drawn wrong.
 *
 * `null` for anything the decoder will not open — truncated bytes, an unknown media type, a
 * file that is not a picture. It is a value and not a throw because the caller is deciding
 * whether to refuse a Backup, not handling a fault.
 */
export function createImageDecoder(): ImageDecoderPort {
  return {
    async decode(bytes: Uint8Array, mediaType: string) {
      try {
        const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mediaType }))
        const dims = { widthPx: bitmap.width, heightPx: bitmap.height }
        bitmap.close()
        return dims
      } catch {
        return null
      }
    },
  }
}

/** The messages the floor plan has always shown for a file it cannot use (#49). */
const NOT_AN_IMAGE = 'Please choose a valid image file.'
const UNDECODABLE = 'The uploaded file is not a valid image.'
const UNREADABLE = 'Could not read that image file.'

/**
 * The bytes behind one uploaded file, with the hash the Asset Store will key them on.
 *
 * The decoder is the real check on whether the bytes are a picture; a file that is not one
 * of the three formats, or that the decoder rejects, is reported with the legacy message so
 * the flagged app answers the way the legacy one did.
 */
export async function readPlanImageFile(file: File): Promise<Result<PlanImageSource, string>> {
  if (!PLAN_IMAGE_MEDIA.includes(file.type)) return { ok: false, error: NOT_AN_IMAGE }
  const mediaType = file.type as PlanImageMedia
  let widthPx: number
  let heightPx: number
  try {
    const bitmap = await createImageBitmap(file)
    widthPx = bitmap.width
    heightPx = bitmap.height
    bitmap.close()
  } catch {
    return { ok: false, error: UNDECODABLE }
  }
  try {
    const source: PlanImageSource = {
      bytes: file,
      sha256: await sha256Hex(await file.arrayBuffer()),
      mediaType,
      widthPx,
      heightPx,
    }
    return { ok: true, value: source }
  } catch {
    return { ok: false, error: UNREADABLE }
  }
}
