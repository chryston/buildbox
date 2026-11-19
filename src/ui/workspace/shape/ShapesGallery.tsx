/**
 * The `Shapes ▾` gallery (#58 §4, §5).
 *
 * Eight presets, each drawn as itself, in a menu rather than a dialog: changing shape is a
 * routine edit and should cost one click. The current kind is marked, because the most common
 * reason to open this menu on a Rectangle is to check that it is still a Rectangle.
 *
 * Picking arms a placement; it does not change anything. The next drag or click on the canvas
 * is the shape — see `placement.ts`. Nothing here commits, so a pick that is never finished
 * leaves no trace, which is what makes the gallery safe to open just to look.
 *
 * Custom Path is the ninth entry of the catalog and is absent on purpose: it needs the Line
 * tool, which is #59. Until then a Custom Path is reached through Convert.
 */
import type { ReactNode } from 'react'
import { PRESET_NAMES } from '../../../domain'
import type { PresetKind } from '../../../derive'
import { GALLERY_ORDER, PresetGlyph } from './presetIcons'

export interface ShapesGalleryProps {
  /** The preset kind on screen, so its row reads as chosen. `null` for a Custom Path. */
  readonly current: PresetKind | null
  readonly onPick: (kind: PresetKind) => void
}

export function ShapesGallery(props: ShapesGalleryProps): ReactNode {
  const { current, onPick } = props
  return (
    <div className="bb-shapes-gallery" role="group" aria-label="Shapes" data-testid="shapes-gallery">
      {GALLERY_ORDER.map((kind) => (
        <button
          key={kind}
          type="button"
          role="menuitemradio"
          aria-checked={current === kind ? 'true' : 'false'}
          data-testid={`shape-preset-${kind}`}
          data-current={current === kind ? 'true' : 'false'}
          className="bb-shapes-gallery-item"
          onClick={() => onPick(kind)}
        >
          <PresetGlyph kind={kind} label={PRESET_NAMES[kind]} />
          <span>{PRESET_NAMES[kind]}</span>
        </button>
      ))}
    </div>
  )
}
