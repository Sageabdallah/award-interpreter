# Axi·WFM — Award Interpreter Design System

A clean, clinical **white-and-red** design system for **Axi · WFM Award Interpreter**, an
**iSOFT ANZ** product — a payroll-compliance tool for Australian businesses. It ingests an award, a company
compliance document, an employee agreement and a timesheet, then computes exactly what
each employee is owed, showing the specific award clause behind every dollar. The engine
is fully deterministic — no AI, no guessing — and **that auditability is the product's
core promise. The UI exists to make it feel that way.**

The user is a payroll officer or HR manager at a small-to-mid business (a pub, a nursing
home, an aged-care provider) — not a lawyer, not technical, and anxious about compliance.
They run this fortnightly and must be able to *defend* the numbers. So the design is calm,
literal and citation-first: it should feel like a trustworthy medical-grade record, not a
marketing dashboard — white and red, in iSOFT ANZ's brand register.

## Sources

This system was reverse-engineered from the product's real source code (the entire UI is
one React file, `src/App.jsx`). Every color, font, radius, shadow and component here is
lifted verbatim from it — not approximated.

- **GitHub:** `https://github.com/Sageabdallah/award-interpreter` — a Vite + React app.
  The UI is in `src/App.jsx`; the deterministic engine is in `src/domain/*`
  (`awardParser`, `interpretationBuilder`, `payCalculator`, `cacheBuilder`, …). Explore
  it to build higher-fidelity work: `CLAUDE_HANDOFF.md` documents the algorithm and the
  healthcare award-library preload, and `mvp-documents/healthcare/` holds a demo pack.

The reader is encouraged to open that repository to understand the domain model (award
codes, classification levels, clause references, provenance) more deeply than any set of
screenshots could convey.

> **Logo — supplied by iSOFT ANZ.** `assets/isoft-i.png` (the red "i" mark) and
> `assets/isoft-wordmark.png` (the "iSOFT" wordmark), with the white knocked out to
> transparent. Pair the mark with the "Axi · WFM" lockup in the masthead; use the wordmark
> for attribution ("an iSOFT ANZ product"). The brand red is a close approximation — supply
> the exact hex (`--ochre` in `tokens/colors.css`) to update the whole system.

---

## Content fundamentals — how the product writes

- **Tone:** plain, calm, precise. It reassures without over-claiming. It never says
  "AI-powered" or "guaranteed compliant"; it says *"The award read for you,
  deterministically"* and *"Suggestions only. Review every classification against the
  current award before processing pay."*
- **Person:** second person ("you"), light imperative for actions ("Parse the award
  stack", "Upload and review the timesheet").
- **Casing:** sentence case everywhere — headlines, buttons, captions. The only
  uppercasing is the mono eyebrow/label/step-status style (`01 — UPLOAD`, `RUNNING`,
  `TOTAL CALCULATED PAY`), driven by CSS `text-transform`.
- **Numbers as citations:** every award code, rate and clause reference is monospace. This
  is load-bearing — it signals "this is a traceable figure, not a vibe." Currency is AUD,
  formatted `en-AU` (`$1,350.00`); dates are Australian.
- **Headlines** are short serif statements: *"Parse the award stack." · "The award, read
  for you." · "148 employees calculated" · "Pay dispersed."*
- **Errors are specific and directional.** Not "unmatched" but *"This name appears in the
  timesheet but not in the uploaded employee agreement — the agreement file is probably the
  wrong pay period."* The product also **shows bad parsed data as-is by design** (e.g. a
  night loading parsed as ×0.15 over 10:00–13:00) and labels it, rather than hiding it.
- **No emoji.** Ever. Iconography is Lucide only.

## Visual foundations

- **Palette — clean, clinical white + red (iSOFT ANZ).** A light-grey canvas `#F4F5F7`,
  pure-white cards `#FFFFFF`, Ink `#1A1B1E` text, Muted `#6B6F76`, hairline `rgba(20,22,28,0.12)`.
  The accents each carry one fixed job: **Brand red `#E11B22`** (the iSOFT accent — award
  codes, primary actions, selected/active; a close approximation, swap in the exact brand
  hex in `tokens/colors.css`), **Green `#2F7D57`** (success/verified/matched/ready), and a
  distinct **deep crimson `#B0121F`** kept for validation errors & malformed data so the
  audit error-signal never collides with the brand red. Accents appear as full colors on
  small elements and as ~8–12% tints behind flags, chips and rings.
- **Type:** **Fraunces** (serif display — headlines, card titles, stat values, monogram,
  weight 500, tracking −0.015em), **Inter Tight** (body — paragraphs, labels, buttons,
  tables), **JetBrains Mono** (the citation voice — codes, rates, clause refs, eyebrows,
  table headers, fingerprints). Fonts load from Google Fonts.
- **Spacing:** editorial, *not* a strict 4/8 grid — real values include 13px, 18px, 26px,
  46px. The app shell is max-width 1080px, centered, generous vertical rhythm. Do not snap
  these to a grid.
- **Backgrounds:** a fixed decorative layer — a faint 40px grid (opacity ~0.045, radially
  masked so it fades at the edges) plus three large, slow (20–30s) blurred blobs (blur 72px,
  opacity 0.55) in ochre and sage. Content sits on `z-index: 1` above it. No photography, no
  full-bleed imagery, no illustration.
- **Corner radii:** soft and layered — 8px icon wells, 11px ghost buttons, 13px chips /
  dropzones / primary buttons, 16px stat cards / groups, 18px upload cards & the results
  table shell, 999px pills.
- **Cards:** Card-colored fill, 1px hairline border, medium-large radius, **no shadow at
  rest.** A "ready/verified" card gains a sage border and a soft downward sage glow
  (`0 18px 40px -28px rgba(47,125,87,0.5)`); the active processing step raises onto a card
  with a soft shadow. Shadows are always soft and downward — never hard drops.
- **Borders & dividers:** everything is separated by the same `rgba(20,22,28,0.12)`
  hairline. Tables use a hairline `thead` underline and hairline row rules; the dropzone
  uses a 1.5px dashed border that turns solid red on drag-over.
- **Motion:** one house easing, `cubic-bezier(0.2,0.7,0.2,1)`. Entrances are a 0.55s
  fade-up (opacity + 16px rise). Buttons transition background/border ~0.16–0.18s and nudge
  down 1px on press. The one flourish is the red glow that blooms under the primary button
  on hover. Everything is disabled under `prefers-reduced-motion`.
- **Hover / press states:** ghost buttons darken to a 5% ink wash and take a stronger
  border; the **primary button is red-filled and deepens to a darker red** on hover, lifts
  1px and glows. Table rows wash to 3.5% ink. Press = a 1px downward nudge, no scale.
- **Transparency & blur** are reserved for the background blobs and the grid mask — the
  foreground UI is opaque. No glassmorphism.
- **The dark tooltip** (clause hover, `ClauseRef`) is the one inverted surface: ink
  background, paper text, a soft shadow and a little arrow.

## Iconography

- **Lucide, exclusively** (`lucide-react` in the product; the `lucide` UMD icon set in these
  static cards/kits via a tiny `Icon` wrapper). Stroke `1.6–2.0`, sizes 13–24px, drawn in
  `currentColor` so they inherit the semantic text color. Common glyphs: `UploadCloud`,
  `FileText`, `FileSpreadsheet`, `Scale`, `Layers`, `BadgeCheck`, `Check`, `X`,
  `AlertTriangle`, `Loader2` (spun), `ChevronDown/Up`, `ArrowRight/Left`, `Download`,
  `RotateCcw`, `Banknote`, `Clock`, `CalendarClock`, `Mail`, `Send`, `Sparkles`,
  `CheckCircle2`.
- **No emoji, no unicode-glyph icons, no hand-drawn SVG.** (The design-system component
  primitives accept icons as props and carry unicode fallbacks only so they can render
  standalone; in real use, always pass Lucide elements.)
- **Logo:** the iSOFT ANZ **red "i" mark** (`assets/isoft-i.png`) and **wordmark**
  (`assets/isoft-wordmark.png`), white knocked out to transparent. The mark leads the
  masthead lockup beside "Axi · WFM"; the wordmark signs the footer. Do not recolor or
  redraw them.

---

## Components

All are React, styled entirely through the CSS custom properties in `styles.css`, and take
their icons as props (no bundled icon dependency). Namespace on `window` once the bundle is
loaded.

- **Button** (`components/core/`) — ink primary (lifts to ochre) + hairline ghost secondary.
- **Pill** (`components/core/`) — rounded-capsule chip for meta, award codes and toggles.
- **Badge** (`components/core/`) — toned provenance capsule + ready-state status dot.
- **UploadCard** (`components/upload/`) — numbered drag-and-drop document intake card.
- **StatCard** (`components/data/`) — labelled headline metric with a tinted icon well.
- **ClauseRef** (`components/data/`) — hoverable clause citation with an explaining tooltip.
- **AccordionHeader** (`components/data/`) — award-group header (code, title, meta, provenance).
- **ResultRow** (`components/data/`) — expandable results-table row with a leader-dot breakdown.
- **Flag** (`components/feedback/`) — inline note (ochre) / error (red) annotation chip.
- **StepRow** (`components/feedback/`) — one row of the processing audit sequence.

Each component directory has a `.d.ts` (props + starting-point tags), a `.prompt.md`
(what/when + usage) and a `@dsCard` HTML thumbnail.

## Interpretation table at 200 rows — the rationale (Stage 3)

The Stage-3 table is where the product earns credibility and where it risks drowning the
user. It stays legible because:

1. **Accordion by award first.** Nothing opens until the user picks an award, and matched
   awards (a level named in the agreement) sort to the top and carry a verified badge — so
   the relevant 20 rows are reached before the irrelevant 180.
2. **Relevance-sorted within an award.** Levels named in the employee agreement are badged
   and floated to the top of the table; the rest follow in a stable order.
3. **A 40-row cap with an explicit "Show all N clause rows" expander.** The user opts into
   the long tail; it never dumps 200 rows unbidden.
4. **One idea per row, in plain English.** Level · Category · a plain-language interpretation
   · a mono value/rate · a hoverable clause. The scannable columns are the value and the
   category; the prose explains; the clause is there to defend the number when challenged.
5. **Monospace citations as visual anchors.** Codes, rates and clause refs are mono, so the
   eye can jump between the numbers that matter without reading every sentence.

---

## Index — what's in this project

- `styles.css` — the entry point consumers link (import lines only).
- `tokens/` — `colors.css`, `typography.css`, `spacing.css` (radii/shadows/motion),
  `fonts.css` (Google Fonts).
- `components/` — `core/` (Button, Pill, Badge), `upload/` (UploadCard),
  `data/` (StatCard, ClauseRef, AccordionHeader, ResultRow), `feedback/` (Flag, StepRow).
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Brand) shown in the
  Design System tab.
- `assets/` — the iSOFT ANZ logo (`isoft-i.png` mark, `isoft-wordmark.png`).
- `ui_kits/award-interpreter/` — the interactive five-stage recreation (`index.html` +
  stage JSX + `README.md`).
- `SKILL.md` — Agent-Skill manifest for downloading this system into Claude Code.

## Known substitutions & caveats

- **Fonts** are the real families (Fraunces, Inter Tight, JetBrains Mono) loaded from Google
  Fonts — no substitution — but they load over the network; the `@font-face` rules are not
  local, so the compiler reports 0 bundled fonts. Supply the `.woff2` files if you need them
  vendored.
- The **iSOFT logo** (mark + wordmark) is supplied in `assets/`; the brand red is a close
  approximation pending the exact hex.
- The UI kit uses **hand-crafted mock data**; it is a visual/interaction recreation, not the
  live deterministic engine (which lives in `src/domain/*` in the source repo).
