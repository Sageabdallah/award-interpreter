export interface UploadCardProps {
  /** Two-digit index shown top-right, e.g. "01". */
  index: string
  /** Header icon element (Lucide), e.g. <FileText size={22} strokeWidth={1.6} />. */
  headerIcon?: React.ReactNode
  title: string
  subtitle?: string
  /** Native accept string, e.g. ".pdf,.docx,.txt". */
  accept?: string
  /** Human-readable format line, e.g. "PDF · DOCX · TXT". */
  formats?: string
  /** Filled state when set; expects at least { name, size }. */
  file?: { name: string; size?: number } | null
  /** De-emphasise (dim + "OPTIONAL" tag) — e.g. award upload after a library preload. */
  optional?: boolean
  onFile?: (file: File) => void
  onRemove?: () => void
  /** Optional Lucide icon overrides for the dropzone / filled / remove glyphs. */
  uploadIcon?: React.ReactNode
  checkIcon?: React.ReactNode
  removeIcon?: React.ReactNode
}

/**
 * @startingPoint section="Upload" subtitle="Numbered drag-and-drop document intake card" viewport="700x260"
 */
export function UploadCard(props: UploadCardProps): JSX.Element
