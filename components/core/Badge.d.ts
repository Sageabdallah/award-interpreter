export interface BadgeProps {
  children?: React.ReactNode
  /** Semantic colour role. */
  tone?: 'neutral' | 'ink' | 'ochre' | 'sage' | 'red'
  /** pill = provenance capsule; dot = coloured status dot + label. */
  shape?: 'pill' | 'dot'
  /** Leading icon element (e.g. a Lucide <BadgeCheck size={13} /> verified mark). */
  icon?: React.ReactNode
  /** dot shape only — adds a soft glow ring (the "Ready" pulse). */
  ring?: boolean
  style?: React.CSSProperties
}

export function Badge(props: BadgeProps): JSX.Element
