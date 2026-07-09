One-liner: The action button — a red primary that deepens on hover (one per screen) and a hairline ghost secondary for everything else.

```jsx
import { Button } from './Button'
import { ArrowRight, ArrowLeft, Download } from 'lucide-react'

// The single call-to-action
<Button variant="primary" iconRight={<ArrowRight size={18} strokeWidth={2} />}>
  Interpret award
</Button>

// Secondary / ghost actions
<Button iconLeft={<ArrowLeft size={15} strokeWidth={1.9} />}>Back to upload</Button>
<Button iconLeft={<Download size={16} strokeWidth={1.9} />}>Export CSV</Button>

// Gated primary (unlocks when requirements are met)
<Button variant="primary" disabled>Interpret award</Button>
```

Notes
- Use exactly ONE `variant="primary"` per screen — it is the "Disperse pay" / "Continue" gesture.
- Disabled primary flattens to a muted ghost (opacity 0.4, no shadow) — it reads as "not yet".
- The primary is red-filled (the iSOFT brand accent) and deepens to a darker red on hover.
- Pass `href` to render an `<a>` (e.g. a `mailto:` confirmation action).
