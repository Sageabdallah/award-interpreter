export interface StepRowProps {
  label: string
  /** One-line technical detail, mono muted (e.g. "Computing the cache fingerprint…"). */
  detail?: string
  status?: 'pending' | 'active' | 'done'
  /** Lucide <Check /> for the done state. */
  doneIcon?: React.ReactNode
  /** Lucide <Loader2 className="spin" /> for the active state. */
  activeIcon?: React.ReactNode
  /** Stagger the entrance (ms). */
  delay?: number
}

export function StepRow(props: StepRowProps): JSX.Element
