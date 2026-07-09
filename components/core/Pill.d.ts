export interface PillProps {
  children?: React.ReactNode
  /** Leading Lucide icon element, e.g. <Layers size={15} strokeWidth={1.7} />. */
  icon?: React.ReactNode
  /** Prepends a mono, ochre award-code span (e.g. "MA000034"). */
  code?: string
  /** Ochre-tint selected state (industry / filter toggles). */
  selected?: boolean
  disabled?: boolean
  onClick?: (e: React.MouseEvent) => void
  style?: React.CSSProperties
}

export function Pill(props: PillProps): JSX.Element
