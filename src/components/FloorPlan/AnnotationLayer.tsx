import type { Annotation } from '../../types'

interface Props {
  annotations: Annotation[]
  activeType: 'wall-hack' | 'tile-zone' | null
  zoom: number
  onAddAnnotation: (ann: Annotation) => void
}

export default function AnnotationLayer(_props: Props) { return null }
