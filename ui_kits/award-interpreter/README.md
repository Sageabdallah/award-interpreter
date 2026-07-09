# Award Interpreter — UI kit

An interactive, click-through recreation of the full five-stage Award Interpreter
wizard, composed from the design system's own primitives. Open `index.html` and
use the stage rail at the bottom to move between stages (or use the in-screen
primary buttons to advance the flow).

## Stages

1. **Upload** (`Stage1Upload.jsx`) — industry selector (Healthcare preloads four
   awards and makes the award upload optional), three numbered `UploadCard`s, and
   a `Badge` ready-dot that gates the primary action.
2. **Processing** (`Stage2Processing.jsx`) — five `StepRow`s resolving
   pending → active → done with a progress bar. Pass `errored` to see the
   parse-failure state and its route back.
3. **Interpretation** (`Stage3Interpretation.jsx`) — the distinctive screen. A
   per-award `AccordionHeader` accordion; opening one reveals the flat clause
   table (Level · Category · Interpretation · Value/rate · Clause) with matched
   levels badged and sorted first, a 40-row cap, and hoverable `ClauseRef`s.
4. **Results** (`Stage4Results.jsx`) — four `StatCard`s (validation count in red),
   the results table of expandable `ResultRow`s including an unmatched-employee
   error row and a malformed-data (`×0.15`) row shown as-is, and the Disperse bar.
5. **Confirmation** (`Stage5Confirmation.jsx`) — leader-dot email preview,
   validated recipient input, send action, and the success state.

## How it loads

`index.html` loads React + Babel + the `lucide` UMD icon set + the compiled
`_ds_bundle.js` (from the project root), then the babel `.jsx` files in order.
Each file assigns its exports onto `window.AK` so the sibling scripts can read
them. Icons are rendered by a small `Icon` helper (`kit.jsx`) that wraps
`window.lucide` icon nodes as React SVGs.

Structural layout CSS (background grid + blobs, `.app-shell`, `.thead`/`.trow`,
leader lines, `.emp-group`, grids) lives in `index.html`; everything visual comes
from the design-system tokens in `styles.css`. Mock data is hand-crafted in
`kit.jsx` — this is a visual/interaction recreation, not the real deterministic
engine.
