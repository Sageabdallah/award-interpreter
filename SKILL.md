---
name: axi-wfm-design
description: Use this skill to generate well-branded interfaces and assets for Axi·WFM Award Interpreter, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the DESIGN-SYSTEM.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick orientation

- **Brand:** Axi·WFM Award Interpreter, an **iSOFT ANZ** product — a clean, clinical
  **white + red** payroll-compliance tool for Australian businesses. Calm, literal,
  citation-first. NO emoji.
- **Palette:** Canvas `#F4F5F7`, Card `#FFFFFF`, Ink `#1A1B1E`, Muted `#6B6F76`, hairline
  `rgba(20,22,28,0.12)`. Brand red `#E11B22` (accent/codes/primary; approximate iSOFT red),
  Green `#2F7D57` (success/verified), deep crimson `#B0121F` (errors). See `tokens/colors.css`.
- **Type:** Fraunces (serif display), Inter Tight (body), JetBrains Mono (codes, rates,
  clause refs — always mono; it signals "citation, not vibe"). See `tokens/typography.css`.
- **Icons:** Lucide only.
- **Components:** `components/**` — Button, Pill, Badge, UploadCard, StatCard, ClauseRef,
  AccordionHeader, ResultRow, Flag, StepRow. Each has a `.prompt.md` with usage.
- **Full-screen recreation:** `ui_kits/award-interpreter/` — the five-stage wizard.

## Building a static artifact

Link `styles.css` for tokens. To use the React components, load `_ds_bundle.js` and read
them from `window.AxiWFMAwardInterpreterDesignSystem_c5602f` (see any `*.card.html` in
`components/**` for the exact React + Babel + lucide + bundle load pattern). Currency is AUD
(`en-AU`); dates are Australian. Keep copy sentence-case, second person, and never
over-claim compliance.
