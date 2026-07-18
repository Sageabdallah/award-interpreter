# Award Interpreter — UI/UX design brief

Design the interface for **Axi · WFM Award Interpreter**, a payroll compliance tool for
Australian businesses. Deliver high-fidelity screens for the full flow plus a design system.

## The product in one paragraph

Australian employers must pay staff according to legally binding "modern awards" — dense
Fair Work documents specifying base rates per classification level, penalty rates for
weekends and nights, overtime bands, and allowances. Getting it wrong is wage theft.
This tool ingests an award, a company compliance document, an employee agreement, and a
timesheet, then computes exactly what each employee is owed — showing the specific award
clause behind every dollar. The engine is fully deterministic: no AI, no guessing. Every
number is traceable to a clause reference. **That auditability is the product's core
promise, and the UI must make it feel that way.**

## Who uses it

A payroll officer or HR manager at a small-to-mid business (a pub, a nursing home, an
aged-care provider). Not a lawyer. Not technical. They are anxious about compliance and
will be asked to defend these numbers. They run this fortnightly. Their emotional state
at the "Disperse pay" button is the whole design problem: they need to feel they have
*checked* something, not *trusted* something.

## The flow — five stages, one page, no navigation chrome

A linear wizard. A masthead shows `STAGE 0N / 05` and the stage name.

**Stage 1 — Upload.** An industry selector (Healthcare is preloaded with six awards;
other industries require an award upload). Below it, up to four numbered upload cards:
Award Document, Compliance Document, Employee Agreement, Timesheet. Each card takes
drag-and-drop or click, shows accepted formats (PDF, DOCX / XLSX, CSV), and switches to a
filled state with filename, size, and a remove control. When Healthcare is selected the
award card becomes *optional* — design that de-emphasis. A "Interpret award" primary
action unlocks when requirements are met.

**Stage 2 — Processing.** Five sequential steps, each resolving from pending → active →
complete: hashing the document set, parsing award records, reading employee agreements,
cross-referencing compliance, building the lookup cache. Each has a one-line technical
detail. A progress percentage. This screen exists to build trust in the machinery — it
should feel like an audit, not a spinner. Design the error state too (a document failed
to parse, with a route back).

**Stage 3 — Award interpretation.** The distinctive screen. Before any timesheet is
uploaded, the tool shows what it understood the award to *mean*. A per-award accordion
(matched awards first, badged); each award header carries its code, title, level count,
clause-row count, and a provenance pill reading `preloaded`, `uploaded`, or `merged`.
Opening one reveals a single flat table:

| Level | Category | Interpretation | Value / rate | Clause |
|---|---|---|---|---|

One row per clause interpretation, in plain English ("Casual employees receive a 25%
loading on the ordinary hourly rate"). Levels named in the employee agreement are badged
and sorted to the top. Rows cap at 40 with a "Show all N clause rows" expander — some
awards produce 200+. Clause references are hoverable, revealing the clause's purpose.
**Design challenge: this table is where the product earns its credibility, and it is
also where it risks drowning the user. Solve that.**

**Stage 4 — Results.** Four stat cards: total hours, base pay, extras, validation rows
(the last is a warning count and must not read as decorative). Then the results table,
one row per employee, columns: Employee Name · Award Code · Employee Level · Job Role ·
Base Pay · Extras / Allowances · Total Calculated Pay. Each row expands to a
per-employee breakdown — day-by-day worked chips, which penalties and allowances applied
and why, the entitled hourly rate after loadings, and clause refs. Rows that failed to
match an employee to an award level show a validation error state instead of a total;
these must be impossible to skim past. Actions: Export CSV, New interpretation, and the
terminal **Disperse pay**.

**Stage 5 — Confirmation.** A payroll summary formatted as an email preview (leader-dot
lines: employee name … amount, then a total), an editable recipient address with
validation, and a send action. Then a success state.

## States you must design, not just the happy path

- Timesheet employees who match no cached agreement profile → a mismatch explanation
  that tells the user *which file is probably wrong*, not just "unmatched".
- A row where the parsed award data is malformed (this genuinely happens — a night-shift
  loading parsed as ×0.15 over a 10:00–13:00 window). The product shows bad data as-is
  by design. Design how that reads.
- Entitlements that exist in the award but paid $0 this period ("available if conditions
  met") versus ones that actually applied.
- Empty, loading, and error states for every stage.

## Design language

The current build is warm and editorial rather than SaaS-blue — it wants to feel like a
document you can trust, not a dashboard. Existing tokens, as a starting point:

- Paper `#F5F1EA`, Ink `#1F1E1B`, Card `#FBF9F4`, Muted `#8A8579`, hairline
  `rgba(31,30,27,0.12)`
- Ochre `#C2703A` (accent, award codes), Sage `#5B7A5C` (success, verified), Red
  `#B4452F` (validation errors)
- Fraunces (serif display), Inter Tight (body), JetBrains Mono (codes, rates, clause refs)

*Either evolve this direction or propose a stronger one — but justify the departure.*
Monospace on every award code, rate, and clause reference is load-bearing: it signals
"this is a citation, not a vibe."

## Constraints

- Desktop-first (payroll happens at a desk), but the results table must survive a laptop
  viewport — it currently scrolls horizontally.
- Currency is AUD, formatted `en-AU`. Dates are Australian.
- Icons: Lucide.
- Light mode only for now.

## Deliverables

1. High-fidelity screens for all five stages, including the states listed above.
2. The expanded result row and the clause-reference hover, specified.
3. A component sheet: upload card, stat card, pill/badge, clause ref, step row, table
   row, primary/secondary buttons, and the accordion header.
4. Type scale, spacing scale, and color roles with their semantic meanings.
5. A short rationale for how the interpretation table (Stage 3) stays legible at 200 rows.
