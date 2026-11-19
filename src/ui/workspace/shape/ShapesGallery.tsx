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
 * The ninth entry is `Custom Path`, and it arms the Line draw tool rather than a placement:
 * there is no box to place, the next click is the first vertex. It belongs in this menu because
 * a person deciding what shape to make does not sort the answers into "ones with a fixed number
 * of sides" and "ones without" — and because leaving it out would mean a Custom Path could only
 * be reached by converting something that already exists.
 */
import type { ReactNode } from 'react'
import { PRESET_NAMES } from '../../../domain'
import type { PresetKind } from '../../../derive'
import { GALLERY_ORDER, PresetGlyph } from './presetIcons'

export interface ShapesGalleryProps {
  /** The preset kind on screen, so its row reads as chosen. `null` for a Custom Path. */
  readonly current: PresetKind | null
  /** True when the shape on screen is a Custom Path, so its row reads as chosen. */
  readonly currentPath: boolean
  readonly onPick: (kind: PresetKind) => void
  /** Arm the Line draw tool: the next click is the first vertex of a new path. */
  readonly onPickPath: () => void
}

export function ShapesGallery(props: ShapesGalleryProps): ReactNode {
  const { current, currentPath, onPick, onPickPath } = props
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
      <button
        type="button"
        role="menuitemradio"
        aria-checked={currentPath ? 'true' : 'false'}
        data-testid="shape-custom-path"
        data-current={currentPath ? 'true' : 'false'}
        className="bb-shapes-gallery-item"
        onClick={onPickPath}
      >
        <CustomPathGlyph />
        <span>Custom Path</span>
      </button>
    </div>
  )
}

/**
 * The glyph is a corner with an arc running out of it and no closed box: eight of these icons
 * are closed outlines, and the one entry that is not one should not look like one either.
 */
function CustomPathGlyph(): ReactNode {
  return (
    <svg className="bb-preset-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 18 L4 8 A6 6 0 0 1 10 2 L20 2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="4" cy="18" r="1.8" fill="currentColor" />
      <circle cx="20" cy="2" r="1.8" fill="currentColor" />
    </svg>
  )
}
