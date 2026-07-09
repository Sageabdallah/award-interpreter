One-liner: One row of the processing audit sequence — pending → active → done, each with a technical detail and a mono status word. Builds trust in the machinery, not a spinner.

```jsx
import { StepRow } from './StepRow'
import { Check, Loader2 } from 'lucide-react'

const STEPS = [
  { label: 'Hashing the document set', detail: 'Computing the cache fingerprint for the uploaded rule documents' },
  { label: 'Parsing award records', detail: 'Extracting code, levels, rates, allowances and penalties' },
  { label: 'Reading employee agreements', detail: 'Mapping employees to award code, level, role and overrides' },
  { label: 'Cross-referencing compliance', detail: 'Collecting non-overriding notes and mismatch warnings' },
  { label: 'Building the lookup cache', detail: 'Materialising O(1) indexes keyed by award code and level' },
]

{STEPS.map((s, i) => (
  <StepRow key={s.label} {...s} delay={i * 90}
    status={i < active ? 'done' : i === active ? 'active' : 'pending'}
    doneIcon={<Check size={17} strokeWidth={2.4} />}
    activeIcon={<Loader2 className="spin" size={18} strokeWidth={2.2} />} />
))}
```

Notes
- Only ONE row is `active` at a time; everything before it is `done` (dimmed), everything after `pending`.
- The active row raises onto a card and its label switches to serif — that's the focus cue.
- Keep details technical and specific; this screen's job is to feel like an audit.
