/* Award Interpretation Rulebook — SINGLE SOURCE OF TRUTH.
   Hospitality Industry (General) Award 2020 (MA000009).
   All figures web-verified against the Fair Work Ombudsman Pay Guide MA000009
   (effective 01/07/2025, published 15/01/2026) and the FWC award text.
   Both the XLSX and DOCX generators import this module, so the three output
   formats cannot diverge. Currency cells are stored as NUMBERS (formatted as
   AUD by each renderer); everything else is a string. N/A cells use the
   { na:true, reason } sentinel. */

/* ── design tokens (XLSX uses 'FF'-prefixed ARGB; docx uses bare 6-hex) ── */
export const TOKENS = {
  ink: '1F1E1B',
  ochre: 'C2703A',
  band: 'FBFAF6',
  rule: 'DDDDDD',
  muted: '6B675E',
  font: 'Arial',
}

export const META = {
  awardCode: 'MA000009',
  awardName: 'Hospitality Industry (General) Award 2020',
  title: 'Award Interpretation Rulebook',
  subtitle: 'Hospitality Industry (General) Award 2020',
  vendor: 'Axi-WFM',
  generated: '4 June 2026',
  effective: 'First full pay period on or after 1 July 2025',
  version: '1.0',
  runningHeader: 'Axi-WFM · Award Rulebook MA000009',
  source: 'Verified against the Fair Work Ombudsman Pay Guide MA000009 (eff. 1 July 2025) and the FWC award text.',
  disclaimer:
    'This rulebook is an interpretation aid prepared by Axi-WFM to support payroll decisions. It is a plain-English '
    + 'summary of the Hospitality Industry (General) Award 2020 (MA000009) and is NOT the award itself, nor legal advice. '
    + 'Rates and rules were verified against the Fair Work Ombudsman Pay Guide for MA000009 effective from the first full '
    + 'pay period on or after 1 July 2025. Awards are varied regularly (at minimum each Annual Wage Review on 1 July). '
    + 'Always confirm the current figure against the award text and Pay Guide at fairwork.gov.au before relying on it. '
    + 'Where this brief differed from the published award, the verified award figure has been used and noted.',
}

/* ── canonical base rates (Table 3, cl. 18.1). weekly + hourly are BOTH the
   published figures; the verifier asserts hourly === round(weekly/38,2) and
   casual === round(hourly*1.25,2) so a transcription slip aborts the build. ── */
export const LEVELS = [
  { code: 'Intro', level: 'Introductory', weekly: 922.70, hourly: 24.28 },
  { code: 'L1', level: 'Level 1', weekly: 948.00, hourly: 24.95 },
  { code: 'L2', level: 'Level 2', weekly: 982.40, hourly: 25.85 },
  { code: 'L3', level: 'Level 3', weekly: 1014.70, hourly: 26.70 },
  { code: 'L4', level: 'Level 4', weekly: 1068.40, hourly: 28.12 },
  { code: 'L5', level: 'Level 5', weekly: 1135.50, hourly: 29.88 },
  { code: 'L6', level: 'Level 6', weekly: 1165.70, hourly: 30.68 },
]

export const round2 = (n) => Math.round(n * 100) / 100
export const casualOf = (hourly) => round2(hourly * 1.25)

/* worked penalty examples on a Level 3 employee (hourly $26.70) — verified
   against the Pay Guide rate tables. Used by Section 04 and by the verifier. */
const L3 = LEVELS.find((l) => l.code === 'L3').hourly // 26.70
export const PENALTY_EXAMPLES = {
  base: L3,
  ftpt: { sat: { pct: 125, amt: round2(L3 * 1.25) }, sun: { pct: 150, amt: round2(L3 * 1.5) }, ph: { pct: 225, amt: round2(L3 * 2.25) } },
  casual: { sat: { pct: 150, amt: round2(L3 * 1.5) }, sun: { pct: 175, amt: round2(L3 * 1.75) }, ph: { pct: 250, amt: round2(L3 * 2.5) } },
}

/* helper to build column defs */
const col = (header, xlsxWidth, docxPct) => ({ header, xlsxWidth, docxPct })
const NA = (reason) => ({ na: true, reason })

/* ───────────────────────────── SECTIONS ───────────────────────────── */
export const SECTIONS = [
  /* 01 ───────────────────────────────────────────────────────────── */
  {
    id: '01', number: 1, name: 'Classifications', sheetName: '01_Classifications', eyebrow: 'SECTION 01',
    intro:
      'Every employee is mapped to one classification — Introductory or Levels 1–6 — based on the duties they '
      + 'actually perform, not their job title. Classification definitions live in Schedule A. Codes below combine the '
      + 'level with a stream tag (FB = food & beverage, K = kitchen, GS = guest service, SEC = security, SUP = supervisory).',
    columns: [col('Code', 12, 11), col('Level', 14, 12), col('Stream / role', 26, 22), col('Indicative duties & training', 52, 42), col('Schedule', 14, 13)],
    rows: [
      ['INT', 'Introductory', 'All streams', 'Entry level on starting; induction and basic on-the-job training. Progresses to Level 1 after 3 months (or sooner if competent).', 'Sch A.1'],
      ['L1-FB1', 'Level 1', 'Food & beverage', 'Food & beverage attendant grade 1 — clearing/setting tables, collecting glasses, assisting; on-the-job training.', 'Sch A (L1)'],
      ['L1-KA1', 'Level 1', 'Kitchen', 'Kitchen attendant grade 1 — general cleaning, dishwashing, basic food-prep assistance.', 'Sch A (L1)'],
      ['L1-GS1', 'Level 1', 'Guest service', 'Guest service grade 1 — portering, cleaning, general guest assistance.', 'Sch A (L1)'],
      ['L2-FB2', 'Level 2', 'Food & beverage', 'Food & beverage attendant grade 2 — table service, taking orders, serving/selling liquor (adult rate applies, cl. 13.5).', 'Sch A (L2)'],
      ['L2-CK1', 'Level 2', 'Kitchen', 'Cook grade 1 — basic cooking and food prep under supervision.', 'Sch A (L2)'],
      ['L2-SEC', 'Level 2', 'Security', 'Security officer / door person — controlling entry, monitoring patrons (check cross-award MA000016).', 'Sch A (L2)'],
      ['L3-FB3', 'Level 3', 'Food & beverage', 'Food & beverage attendant grade 3 — cocktails, cellar/keg work, supervising grade 1–2; Certificate III pathway.', 'Sch A (L3)'],
      ['L3-CK2', 'Level 3', 'Kitchen', 'Cook grade 2 — cooking on own initiative, preparing menu items.', 'Sch A (L3)'],
      ['L3-GS3', 'Level 3', 'Guest service', 'Guest service grade 3 — reception, reservations, cash handling.', 'Sch A (L3)'],
      ['L4-SUP', 'Level 4', 'Supervisory', 'Food & beverage supervisor / attendant grade 4 — supervising and training staff; trade or equivalent.', 'Sch A (L4)'],
      ['L4-CK3', 'Level 4', 'Kitchen', 'Cook (tradesperson) grade 3 — qualified cook, à la carte preparation.', 'Sch A (L4)'],
      ['L5-CK4', 'Level 5', 'Kitchen', 'Cook grade 4 (chef de partie) — specialised cooking, supervising cooks.', 'Sch A (L5)'],
      ['L6-CK5', 'Level 6', 'Supervisory / kitchen', 'Cook grade 5 (chef) / functions & catering supervisor — full control of a kitchen or function operation.', 'Sch A (L6)'],
    ],
    notes: ['Schedule A — Classification Definitions', 'cl. 13.5 (liquor service = adult rate)', 'See Section 11 for cross-award triggers (security, restaurants, clubs).'],
  },

  /* 02 ───────────────────────────────────────────────────────────── */
  {
    id: '02', number: 2, name: 'Base Rates', sheetName: '02_Base_Rates', eyebrow: 'SECTION 02',
    intro:
      'Adult minimum rates as at the first full pay period on or after 1 July 2025 (2024–25 Annual Wage Review). The '
      + 'weekly rate is for a full-time 38-hour week; part-time employees are paid the same hourly rate pro rata. The hourly '
      + 'rate equals the weekly rate divided by 38.',
    columns: [col('Code', 12, 14), col('Classification', 22, 30), col('Weekly (38 hr)', 18, 28), col('Hourly', 16, 28)],
    rows: LEVELS.map((l) => [l.code, l.level, l.weekly, l.hourly]),
    notes: ['Table 3 — Minimum rates', 'cl. 18.1', 'Adult rates; juniors see Section 09'],
  },

  /* 03 ───────────────────────────────────────────────────────────── */
  {
    id: '03', number: 3, name: 'Casual Loading', sheetName: '03_Casual_Loading', eyebrow: 'SECTION 03',
    intro:
      'Casual employees receive a 25% loading on the ordinary hourly rate in place of paid leave and notice. IMPORTANT '
      + 'STACKING RULE: do not add the 25% loading on top of casual penalty rates — the casual Saturday/Sunday/public-holiday '
      + 'percentages in Section 04 ALREADY include the loading. Apply the 25% loading only to ordinary (non-penalty) hours.',
    columns: [col('Code', 12, 12), col('Classification', 22, 24), col('Ordinary hourly', 18, 22), col('+25% loading', 16, 20), col('Casual hourly', 16, 22)],
    rows: LEVELS.map((l) => [l.code, l.level, l.hourly, round2(l.hourly * 0.25), casualOf(l.hourly)]),
    notes: ['cl. 11.1 (casual loading)', 'cl. 11.4', 'Loading applies to ordinary hours only — NOT compounded onto penalty rates (see Section 04).'],
  },

  /* 04 ───────────────────────────────────────────────────────────── */
  {
    id: '04', number: 4, name: 'Penalty Rates', sheetName: '04_Penalty_Rates', eyebrow: 'SECTION 04',
    intro:
      'Penalty rates are a percentage of the ordinary hourly rate. Casual percentages are higher because they already '
      + 'incorporate the 25% casual loading (so the loading is never added again). Dollar examples below use a Level 3 '
      + 'employee (ordinary $26.70/hr).',
    columns: [col('Day / type', 22, 22), col('FT/PT %', 12, 13), col('FT/PT $ (L3)', 16, 19), col('Casual %', 12, 13), col('Casual $ (L3)', 16, 19), col('Notes', 20, 14)],
    rows: [
      ['Saturday', '125%', PENALTY_EXAMPLES.ftpt.sat.amt, '150%', PENALTY_EXAMPLES.casual.sat.amt, ''],
      ['Sunday', '150%', PENALTY_EXAMPLES.ftpt.sun.amt, '175%', PENALTY_EXAMPLES.casual.sun.amt, ''],
      ['Public holiday', '225%', PENALTY_EXAMPLES.ftpt.ph.amt, '250%', PENALTY_EXAMPLES.casual.ph.amt, 'Min engagement applies'],
      ['Minimum engagement', '—', '', 'casual 2 hrs', '', 'PT min 3 hrs; PH min per cl. 35'],
    ],
    notes: ['Table 14 — Penalty rates', 'cl. 29.2', 'Casual % already includes the 25% loading (cl. 11.4).', 'Min engagement: casual cl. 11.3; public holidays cl. 35.'],
  },

  /* 05 ───────────────────────────────────────────────────────────── */
  {
    id: '05', number: 5, name: 'Evening & Night', sheetName: '05_Evening_Night', eyebrow: 'SECTION 05',
    intro:
      'On ordinary hours worked Monday to Friday, a flat additional amount per hour applies to evening and night work. '
      + 'These are flat dollars, NOT percentages, added on top of the ordinary (or casual) hourly rate. They apply Monday '
      + 'to Friday ONLY — on weekends and public holidays the Section 04 penalty rates already cover these periods, so the '
      + 'evening/night loading is not added as well.',
    columns: [col('Window', 26, 26), col('Additional loading', 22, 26), col('Days', 16, 20), col('Notes', 28, 28)],
    rows: [
      ['7:00pm – midnight', '+$2.81 per hour', 'Mon–Fri', 'Added to ordinary/casual hourly rate'],
      ['Midnight – 7:00am', '+$4.22 per hour', 'Mon–Fri', 'Added to ordinary/casual hourly rate'],
      ['Saturday / Sunday / public holiday', 'Not applied', 'Sat–Sun, PH', 'Weekend/PH penalty rates already cover these hours (no stacking)'],
    ],
    notes: ['cl. 29 (evening and night work loadings)', 'Flat per-hour amounts, eff. 1 July 2025', 'Mon–Fri only — do not stack with weekend/PH penalties.'],
  },

  /* 06 ───────────────────────────────────────────────────────────── */
  {
    id: '06', number: 6, name: 'Overtime', sheetName: '06_Overtime', eyebrow: 'SECTION 06',
    intro:
      'Overtime is triggered when an employee works beyond their ordinary-hours limits. Multipliers are of the ordinary '
      + 'hourly rate. Sunday and public-holiday overtime are paid at the higher flat multiplier shown (not added on top of '
      + 'the weekend/PH penalty).',
    columns: [col('Trigger / rate', 30, 30), col('Threshold or multiplier', 24, 30), col('Notes', 36, 40)],
    rows: [
      ['Daily trigger (FT/PT)', 'More than 11.5 ordinary hrs/day', 'Hours beyond the daily ordinary maximum are overtime'],
      ['Weekly trigger', 'More than 38 hrs/week', 'Averaged over the roster cycle where applicable'],
      ['Casual daily trigger', 'More than 12 hrs/day', 'Casual overtime applies beyond 12 hours in a day'],
      ['Overtime — first 2 hours', '150%', 'Monday to Saturday'],
      ['Overtime — after 2 hours', '200%', 'Monday to Saturday'],
      ['Overtime — Sunday', '200%', 'All overtime worked on a Sunday'],
      ['Overtime — public holiday', '250%', 'All overtime worked on a public holiday'],
    ],
    notes: ['Table 13 — Overtime rates', 'cl. 28', 'Ordinary-hours limits: see Section 08 (cl. 15).'],
  },

  /* 07 ───────────────────────────────────────────────────────────── */
  {
    id: '07', number: 7, name: 'Allowances', sheetName: '07_Allowances', eyebrow: 'SECTION 07',
    intro:
      'Monetary allowances as at 1 July 2025 (Schedule C). All-purpose allowances are added to the minimum rate before '
      + 'penalties and overtime are calculated. Two items requested in the brief — a coffee/espresso-machine allowance and a '
      + 'cold-places allowance — do not exist under MA000009 and are shown as N/A. The award treats split and broken shifts '
      + 'under a single combined allowance.',
    columns: [col('Allowance', 30, 28), col('Amount', 30, 32), col('Basis', 16, 18), col('Clause', 14, 22)],
    rows: [
      ['Meal allowance (overtime)', 16.73, 'per occasion', 'cl. 26 / Sch C'],
      ['Tool allowance (cooks/apprentice cooks)', '$2.03 per day, max $9.94 per week', 'per day / week', 'cl. 26 / Sch C'],
      ['Uniform / special clothing (catering)', 'Reimbursement of cost of special uniform/clothing', 'reimbursement', 'cl. 26 / Sch C'],
      ['Laundry allowance (catering)', 'FT $6.00/week; PT & casual $2.05 per uniform laundered', 'per week / item', 'cl. 26 / Sch C'],
      ['Broken shift allowance', '$3.53/day (gap 2–3 hrs); $5.34/day (gap >3 hrs)', 'per day', 'cl. 13 / 26 / Sch C'],
      ['Split shift allowance', 'Combined with broken-shift allowance (same amounts)', 'per day', 'cl. 13 / 26 / Sch C'],
      ['Coffee / espresso machine allowance', NA('N/A — not provided under MA000009'), '—', '—'],
      ['Cold places allowance', NA('N/A — not provided under MA000009'), '—', '—'],
      ['First aid allowance', 'FT $12.82/week; PT & casual $2.56/day (max $12.82/week)', 'per week / day', 'cl. 26 / Sch C'],
      ['Working supervisor (in charge) — airport catering', '$0.56–$1.46 per hour by team size (5 / 10 / 20 / 20+)', 'per hour', 'cl. 26 / Sch C'],
      ['Higher duties', 'Paid at the higher classification rate for time worked (2+ hrs/day = full day)', 'classification rate', 'cl. 18'],
      ['Travel / vehicle', 'Vehicle (managerial, hotels) $0.99/km; airport-catering travel $8.45/day', 'per km / day', 'cl. 26 / Sch C'],
    ],
    notes: ['cl. 26 — Allowances', 'Schedule C — Summary of Monetary Allowances', 'Coffee-machine & cold-places allowances are not part of MA000009.'],
  },

  /* 08 ───────────────────────────────────────────────────────────── */
  {
    id: '08', number: 8, name: 'Ordinary Hours', sheetName: '08_Ordinary_Hours', eyebrow: 'SECTION 08',
    intro:
      'Ordinary hours and rostering limits under clause 15. MA000009 does not fix a single daily “span” of ordinary '
      + 'hours (hospitality operates across all seven days); instead it sets daily/weekly maxima and uses the time-of-day '
      + 'loadings in Section 05 and the weekend/public-holiday penalties in Section 04.',
    columns: [col('Rule', 30, 34), col('Value', 26, 30), col('Clause', 16, 36)],
    rows: [
      ['Ordinary hours per week', '38 (averaged over the cycle)', 'cl. 15.1'],
      ['Maximum ordinary hours per day', '11.5 hours (excludes meal breaks)', 'cl. 15.1(c)'],
      ['Minimum ordinary hours per day', '6 hours when rostered', 'cl. 15.1(c)'],
      ['Days of operation', 'Any day Mon–Sun (evening/night & weekend loadings apply)', 'cl. 15 / 29'],
      ['Break between shifts', 'Minimum 10 hours (8 hours on roster changeover)', 'cl. 15.5(e)'],
      ['Casual minimum engagement', '2 consecutive hours per occasion', 'cl. 11.3'],
      ['Part-time minimum engagement', '3 hours per shift (min 8 hrs/week)', 'cl. 10 / 15.2'],
      ['Meal & rest breaks', 'Unpaid meal break for 5+ hr shifts; paid 20-min rest breaks on longer shifts', 'cl. 16'],
    ],
    notes: ['cl. 15 — Ordinary hours of work and rostering', 'cl. 16 — Breaks', 'No single 7am–midnight ordinary-hours span under MA000009; use the loading windows in Section 05.'],
  },

  /* 09 ───────────────────────────────────────────────────────────── */
  {
    id: '09', number: 9, name: 'Junior Rates', sheetName: '09_Junior_Rates', eyebrow: 'SECTION 09',
    intro:
      'Junior employees (other than office employees) are paid a percentage of the adult rate for their classification, by '
      + 'age (Table 5). OVERRIDE: a junior who serves or sells liquor, or who holds a trade qualification, must be paid the '
      + 'full adult rate for the work performed regardless of age (cl. 13.5) — in practice at least Level 2, since liquor '
      + 'service is a Level 2 duty.',
    columns: [col('Age', 18, 18), col('% of adult rate', 18, 20), col('Clause', 16, 22), col('Notes', 30, 40)],
    rows: [
      ['Under 17 years', '50%', 'cl. 18.4 (Table 5)', ''],
      ['17 years', '60%', 'cl. 18.4 (Table 5)', ''],
      ['18 years', '70%', 'cl. 18.4 (Table 5)', ''],
      ['19 years', '85%', 'cl. 18.4 (Table 5)', 'Verified — the award uses 85% (not 90%)'],
      ['20 years', '100%', 'cl. 18.4 (Table 5)', 'Adult rate'],
      ['Liquor service / trade-qualified junior', '100% (adult)', 'cl. 13.5', 'Adult rate regardless of age; bar work is Level 2+'],
    ],
    notes: ['cl. 18.4, Table 5 — Junior rates', 'cl. 13.5 — liquor-service / trade-qualified juniors paid adult rate', 'Verified against FWO Pay Guide (eff. 1 July 2025).'],
  },

  /* 10 ───────────────────────────────────────────────────────────── */
  {
    id: '10', number: 10, name: 'Decision Logic', sheetName: '10_Decision_Logic', eyebrow: 'SECTION 10',
    intro:
      'The order of operations the interpreter follows for a single shift. Each step names the inputs it needs, the '
      + 'section of this rulebook to consult, the governing clause, and what it outputs to the next step.',
    columns: [col('Step', 8, 6), col('Decision', 24, 18), col('Inputs', 26, 20), col('Consult', 16, 14), col('Clause', 14, 14), col('Output', 26, 28)],
    rows: [
      ['1', 'Identify classification', 'Role, duties performed', '§01', 'Sch A', 'Classification level + code'],
      ['2', 'Set base rate', 'Classification, employment type', '§02', 'cl. 18.1', 'Ordinary hourly rate'],
      ['3', 'Apply casual loading', 'Employment type (casual?)', '§03', 'cl. 11.4', 'Casual ordinary rate (loading on ordinary hrs only)'],
      ['4', 'Split ordinary vs overtime', 'Daily & weekly hours', '§08, §06', 'cl. 15, 28', 'Ordinary-hour and overtime-hour buckets'],
      ['5', 'Apply overtime multipliers', 'OT hours, day of week', '§06', 'cl. 28', 'Overtime pay (150/200/250%)'],
      ['6', 'Apply weekend / PH penalties', 'Day of week, employment type', '§04', 'cl. 29.2', 'Penalty pay on ordinary hours'],
      ['7', 'Apply evening / night loading', 'Shift times (Mon–Fri)', '§05', 'cl. 29', 'Flat $2.81 / $4.22 per-hour additions'],
      ['8', 'Add allowances', 'Shift attributes (split/broken, first aid, tools, travel)', '§07', 'cl. 26', 'Allowance amounts'],
      ['9', 'Junior adjustment & liquor override', 'Age, liquor-service duties', '§09', 'cl. 18.4, 13.5', 'Final rate + total pay with cited clauses'],
    ],
    notes: ['Run steps in order; later steps depend on earlier outputs.', 'Casual loading (step 3) is never compounded onto penalties (step 6).'],
  },

  /* 11 ───────────────────────────────────────────────────────────── */
  {
    id: '11', number: 11, name: 'Cross-Award Triggers', sheetName: '11_Cross_Award', eyebrow: 'SECTION 11',
    intro:
      'Patterns in the timesheet or role data that suggest another modern award may be the correct (or primary) award. '
      + 'These are flags for human review — do NOT split a single employee across two awards automatically.',
    columns: [col('Pattern observed', 30, 26), col('Candidate award', 24, 22), col('Code', 14, 12), col('Reason for flag', 30, 24), col('Action', 20, 16)],
    rows: [
      ['Standalone security / crowd control, no food & beverage duties', 'Security Services Industry Award', 'MA000016', 'Primary duties are security, not hospitality', 'Confirm primary award'],
      ['Restaurant-only venue, no bar or accommodation', 'Restaurant Industry Award', 'MA000119', 'Business may be a restaurant, not a hotel/pub', 'Confirm coverage'],
      ['Quick-service / takeaway food, minimal table service', 'Fast Food Industry Award', 'MA000003', 'Operation resembles fast food', 'Confirm coverage'],
      ['Employer is a registered or licensed club', 'Registered & Licensed Clubs Award', 'MA000058', 'Club employees may be covered by the Clubs Award', 'Confirm employer type'],
      ['Predominantly clerical / reception / back-office', 'Clerks—Private Sector Award', 'MA000002', 'Clerical work may fall under the Clerks Award', 'Confirm role coverage'],
    ],
    notes: ['Cross-award checks are advisory flags for review.', 'cl. 4 — Coverage', 'Never auto-split one employee across awards.'],
  },
]

if (SECTIONS.length !== 11) throw new Error(`Expected 11 sections, got ${SECTIONS.length}`)
