import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fromMm, toMm } from '../../engine/unitConversion'
import type { Unit } from '../../types'

interface Anchor {
  x: number
  y: number
  width: number
  height: number
}

interface Props {
  anchor: Anchor
  currentMm: number
  unit: Unit
  onCommit: (mm: number) => void
  onClose: () => void
}

export default function DimensionEditor({ anchor, currentMm, unit, onCommit, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const committed = useRef(false)
  const [value, setValue] = useState(String(Math.round(fromMm(currentMm, unit))))

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  function commit() {
    if (committed.current) return
    committed.current = true

    const mm = toMm(Number(value), unit)

    if (!Number.isNaN(mm) && mm > 0) {
      onCommit(mm)
      return
    }

    onClose()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    }

    if (e.key === 'Escape') {
      onClose()
    }
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    left: anchor.x,
    top: anchor.y,
    width: Math.max(anchor.width, 80),
    zIndex: 9999,
  }

  return createPortal(
    <div style={style}>
      <input
        ref={inputRef}
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        className="w-full rounded border border-divider bg-white px-2 py-1 text-center text-sm text-text-primary focus:border-accent"
      />
    </div>,
    document.body,
  )
}
