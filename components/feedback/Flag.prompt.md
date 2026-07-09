One-liner: Inline annotation chip — warm ochre for notes/overrides/"$0 this period", red `danger` for validation errors.

```jsx
import { Flag } from './Flag'
import { AlertTriangle } from 'lucide-react'

<Flag icon={<AlertTriangle size={15} strokeWidth={1.8} />}>
  Over-award rate applied — agreement overrides the award base
</Flag>

<Flag danger icon={<AlertTriangle size={15} strokeWidth={1.8} />}>
  Night loading parsed as ×0.15 over 10:00–13:00 — malformed award data, shown as-is
</Flag>
```

Notes
- Ochre (default) = a note the user should read but that isn't an error (compliance, override, conditional entitlement).
- `danger` = a real problem: unmatched employee, malformed clause. Pair with `accent="red"` counts and error rows.
