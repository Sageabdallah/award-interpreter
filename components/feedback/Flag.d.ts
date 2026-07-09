export interface FlagProps {
  children?: React.ReactNode
  /** Red validation/error variant (default is the warm ochre note). */
  danger?: boolean
  /** Leading icon element, e.g. <AlertTriangle size={15} strokeWidth={1.8} />. */
  icon?: React.ReactNode
}

export function Flag(props: FlagProps): JSX.Element
