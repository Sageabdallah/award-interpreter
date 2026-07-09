One-liner: The numbered document intake card — dashed dropzone when empty, sage-ringed file chip when filled; `optional` dims it.

```jsx
import { UploadCard } from './UploadCard'
import { FileText, UploadCloud, Check, X } from 'lucide-react'

<UploadCard
  index="03"
  headerIcon={<FileText size={22} strokeWidth={1.6} />}
  title="Employee Agreement"
  subtitle="Profiles, roles, levels and override rates"
  accept=".pdf,.docx,.doc,.txt"
  formats="PDF · DOCX · TXT"
  file={agreementFile}
  onFile={f => setAgreement(f)}
  onRemove={() => setAgreement(null)}
  uploadIcon={<UploadCloud size={24} strokeWidth={1.6} />}
  checkIcon={<Check size={19} strokeWidth={2.2} />}
  removeIcon={<X size={16} />}
/>

// De-emphasised when a library is preloaded
<UploadCard index="01" title="Award Document" optional
  subtitle="Optional — merges on top of the preloaded library" ... />
```

Notes
- Pass the Lucide icons in; unicode fallbacks render if you don't, so the card is standalone.
- `optional` dims to 0.72 and adds an "OPTIONAL" tag — the intended de-emphasis for a preloaded award.
- Full drag-and-drop is built in (drag-depth counter, drop highlight); wire `onFile`/`onRemove`.
