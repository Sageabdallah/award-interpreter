export interface ButtonProps {
  /** primary = the single ink call-to-action; secondary = hairline ghost button. */
  variant?: 'primary' | 'secondary'
  children?: React.ReactNode
  /** Leading icon element (e.g. a Lucide <ArrowLeft size={15} />). */
  iconLeft?: React.ReactNode
  /** Trailing icon element (e.g. a Lucide <ArrowRight size={18} />). */
  iconRight?: React.ReactNode
  disabled?: boolean
  onClick?: (e: React.MouseEvent) => void
  /** Render as an <a> instead of <button> (used by "Send confirmation email"). */
  href?: string
  type?: 'button' | 'submit' | 'reset'
  style?: React.CSSProperties
}

/**
 * @startingPoint section="Actions" subtitle="Ink primary + hairline ghost buttons" viewport="700x150"
 */
export function Button(props: ButtonProps): JSX.Element
