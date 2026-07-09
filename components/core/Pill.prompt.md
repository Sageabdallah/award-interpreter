One-liner: Rounded-capsule chip for meta, preloaded-award readouts and toggleable filters; ochre tint when `selected`.

```jsx
import { Pill } from './Pill'
import { Layers, Clock } from 'lucide-react'

<Pill icon={<Layers size={15} strokeWidth={1.7} />}>MA000034 · Nurses library</Pill>
<Pill icon={<Clock size={15} strokeWidth={1.7} />}>48 hrs</Pill>

// Preloaded award chip with a mono code
<Pill code="MA000034">Nurses Award <span style={{color:'var(--muted)'}}>· 22 levels</span></Pill>

// Toggleable (industry selector)
<Pill icon={<Layers size={14} />} selected onClick={pick}>Healthcare</Pill>
```

Notes
- `selected` switches border+fill to the ochre tint — use for single-select toggles.
- `code` renders the award code in mono ochre; the label follows in body type.
- Pass `onClick` to make it a real toggle button; omit for a static readout.
