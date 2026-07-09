One-liner: Small status label — a toned provenance capsule (`shape="pill"`) or a ready-state status dot (`shape="dot"`).

```jsx
import { Badge } from './Badge'
import { BadgeCheck } from 'lucide-react'

// Award provenance
<Badge tone="sage">Preloaded · Healthcare</Badge>
<Badge tone="ochre">Uploaded + library</Badge>
<Badge tone="ochre">Uploaded document</Badge>

// Verified marker
<Badge tone="sage" icon={<BadgeCheck size={13} strokeWidth={2} />}>Matched</Badge>

// Ready-state dot (Stage 1 status line)
<Badge shape="dot" tone="sage" ring>Ready to build the parsed cache</Badge>
<Badge shape="dot" tone="neutral">Add the employee agreement to continue</Badge>
```

Notes
- Tones map to the semantic roles: sage = verified/preloaded, ochre = uploaded/merged, red = error.
- `shape="dot"` + `ring` is the pulsing "ready" indicator that gates the primary button.
