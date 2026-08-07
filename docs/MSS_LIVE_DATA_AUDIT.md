# MSS Security Live Data Audit

## Status

Audit date: 7 August 2026 (Australia/Sydney)

Verdict: **blocked for payroll release**. The source is valuable for validation
and reconciliation, but it is not sufficient to determine legal gross pay for
the whole MSS population. The system now fails closed where the industrial
instrument or a pay-changing employment fact is missing.

This is an engineering audit, not legal advice or a coverage determination.
MSS payroll or workplace relations specialists must confirm the employing
entity, work performed, instrument coverage and written arrangements.

## Source Provenance

The audit used these local workbooks:

| Workbook | Rows | Filesystem modified time |
| --- | ---: | --- |
| `Award.xlsx` | 2,341 | 31 July 2026 13:46 AEST |
| `Employee.xlsx` | 6,461 | 31 July 2026 13:41 AEST |
| `Nsw_Payroll 1.xlsx` | 683,141 | 31 July 2026 13:47 AEST |
| `Projected_roster.xlsx` | 3,421 | 31 July 2026 13:46 AEST |

Combined SHA-256 source fingerprint:
`18ab3613f2963afc57d67c57878371bca020957f776d2f4eddcd3791fb8fe329`.

The files do not have timestamps from 7 August 2026. Vercel recorded a
deployment on 7 August at 13:55 AEST, but that deployment had no Git source or
build metadata and no request logs. It proves a deployment occurred; it does
not prove that these workbooks or the real-data integration were deployed.

## Instrument Inventory

The payroll export has 567,267 rows for the Security Services Industry Award and
115,874 rows assigned to instruments or rules that are not implemented.

| Source instrument/rule | Rows | Employees | Required document/action |
| --- | ---: | ---: | --- |
| Security Services Industry Award | 567,267 | 1,428 | Supported for 1 July 2023 onward |
| Chubb Defence Basic 2006-2011 | 41,257 | 137 | Agreement, approval record, undertakings, coverage and continuation status |
| Chubb Defence Intermediate 2006-2011 | 22,122 | 89 | Same evidence as above |
| NSW Flat Rate | 19,938 | 123 | Contract/IFA or other legal basis, effective dates and BOOT/award mapping |
| Chubb Defence Advanced 2006-2011 | 17,861 | 59 | Agreement, approval record, undertakings, coverage and continuation status |
| NSW - RBA Martin Place EBA | 8,012 | 39 | Exact applicable RBA agreement, coverage, undertakings and pay schedules |
| Chubb Defence Overtime B 2006-2011 | 6,218 | 174 | Agreement, approval record, undertakings, coverage and continuation status |
| Clerks day worker variants | 434 | 3 | Clerks Award versions and verified employee classifications |
| RBA Casual OT | 30 | 7 | Rule source and relationship to the applicable RBA agreement |
| MSS Victorian EA 2011 Light | 2 | 1 | Correct operative Victorian agreement and employee/site assignment |

The official FWC list records the MSS Security - Reserve Bank of Australia Armed
Security Officers' Enterprise Agreement 2020-2024 as AE510234, PR726509,
AG2020/3846, operative from 5 February 2021 with a nominal expiry of 1 September
2024. Its approval decision includes undertakings. The payroll label `NSW - RBA
Martin Place EBA` is not enough to prove that this armed-officer agreement covers
those 39 employees. The replacement 2025-2029 agreement is AE532078, PR796800,
AG2026/123 and became operative in February 2026, after the audited 2024 period.

The Defence labels refer to a 2006-2011 agreement. The FWC advises that pre-2010
"zombie" agreements generally sunsetted unless an extension application was
made. MSS must provide the instrument and evidence that it remained operative
for each employee in 2024. A payroll configuration label is not that evidence.

## Selected Fortnight

The generator selected the latest complete Sydney fortnight, 16-29 December
2024:

| Measure | Result |
| --- | ---: |
| Employees | 587 |
| Source components retained | 14,894 / 14,894 |
| Components in worked cohort | 14,619 |
| Coalesced work periods | 4,170 |
| Leave/adjustment-only rows excluded from attendance | 275 |
| Calculations resolved | 560 / 587 |
| Calculations unresolved | 27 |
| Employees with release-blocking evidence gaps | 587 / 587 |

The 27 unresolved rows comprise 13 missing employment types, 13 part-time
employees without the written weekly/per-shift pattern, and one public-holiday
work period where unpaid time cannot be positioned across differently rated
segments.

## Reconciliation

Of 560 calculated employees, only 14 reconcile within two cents. The engine is
above source for 216 employees and below source for 330 employees.

| Total | Amount |
| --- | ---: |
| Source gross components | $1,783,167.84 |
| Calculated award interpretation | $1,750,147.21 |
| Difference | -$33,020.63 |

This difference is not an underpayment conclusion. It combines unresolved
eligibility evidence, company-specific payments, source roster logic and
calculation differences. Every difference remains a release blocker.

There are 327 source rows totalling $9,600.55 whose earning codes have no
verified rule: `OVER AWARD`, `Special Knowledge 2`, `SPECIAL C/D/F/M/Q`, and
`LEADING HAND A/C/F/G`. They remain source-only reconciliation amounts until
their contract, policy or industrial-instrument basis is supplied.

## Missing Evidence

The main pay-changing evidence gaps are:

| Missing fact or record | Employees |
| --- | ---: |
| Duties/work type for Award coverage and exclusions | 587 |
| Legal employing entity | 587 |
| Roster-cycle arrangement | 587 |
| Break record or operational-impracticability basis | 584 |
| Written majority agreement for ordinary shifts over 10 hours | 390 |
| First-aid qualification and nomination | 157 |
| Permanent-night roster-cycle test | 110 |
| Relieving-officer appointment | 55 |
| Written basis for employee-master override flag | 44 |
| Minimum-engagement top-up or exception (full-time) | 60 |
| Employee-master AwardCode mismatch/missing | 18 |
| Employer direction following a short rest | 8 |
| Minimum-engagement top-up or exception (casual) | 1 |
| Regulated-airport aviation work evidence | 1 |

The compliance engine also reports 12 rest-period breaches, 27 pay validation
failures and 3 work periods over 14 hours. It records 1,196 evidence gaps. These
are review signals and release holds, not automated legal findings.

## Capability Gaps

The current backend does not calculate:

- annual-leave loading, the additional shiftworker week, leave balances or NES
  eligibility for the 905 leave components across 227 employees;
- projected-versus-worked roster variance, because `Projected_roster.xlsx` has
  no verified employee or payroll-shift join key;
- superannuation, PAYG withholding, deductions, net pay or a statutory payslip;
- historical remediation, interest or rolling anomaly baselines;
- any of the unsupported enterprise agreements, flat-rate rules or Clerks rows.

## Implemented Controls

- Effective-dated MA000016 rates and allowances for 2023-24, 2024-25,
  2025-26 and 2026 onward.
- Segment-level day, night, weekend, public-holiday and overtime calculation.
- Lossless source ledger and exact-adjacent ShiftID coalescing.
- Explicit unsupported-instrument resolution; no fallback to MA000016.
- NSW public-holiday calendars for 2024, 2025 and 2026.
- Evidence-gated allowances, 12-hour arrangements, short rest and part-time
  patterns.
- Source-versus-calculated reconciliation and a blocking release gate.
- Deterministic public employee/shift IDs; raw IDs and source row numbers stay
  in gitignored private artifacts.
- Token-protected production pay-run persistence and live mail, bounded request
  bodies/rates, parsed origin allowlists and a tamper-evident audit chain.
- Server-side ERP interpretation, pay-run creation/list/retrieval and a durable
  PostgreSQL audit-store option, while retaining the local append-only file store
  for development.
- Real mail is disabled unless `MAIL_DELIVERY_ENABLED=true`; Security Award mail
  also requires a matching release-cleared persisted pay run. The existing
  frontend can still generate a blocked dry-run preview without delivering mail.

## Integrated Backend Proof

The generated 7.77 MiB normalized payload was submitted through the real Express
`POST /api/pay-runs/interpret` route. The route parsed all 4,170 work periods,
calculated the same 587 result rows and totals as the browser path, persisted a
tamper-evident 614 KB audit record without employee names, and returned this gate:

| Gate reason | Rows |
| --- | ---: |
| Unresolved calculation | 27 |
| Missing source reconciliation | 27 |
| Reconciliation difference over $0.02 | 546 |
| Work-period compliance hold | 3 |
| Missing pay-changing evidence | 587 |

## Integrated Browser Proof

The unchanged frontend completed the generated MSS journey against the local
backend: document interpretation, 587-profile agreement cache, 4,170 work
periods, pay calculation, Employees, Pay Anomalies, Compliance Risk, Reports,
Pay Run and a Security Award payslip preview. The browser totals matched the
server totals exactly. The preview response was HTTP 200 with `mode: dry-run`
and `deliveryBlocked: true`; no email was delivered. There were no browser
console errors or failed network requests.

Two frontend-scale defects remain outside this backend branch:

- Roster Optimiser does not finish its synchronous local search within two
  minutes on the 587-employee/4,170-period pack and blocks the browser main
  thread while it runs.
- The pay-dispersal confirmation page is 415 pixels wide in a 390-pixel mobile
  viewport because its three KPI cards use a fixed three-column layout.

These defects do not change the pay-run or release-gate result, but the roster
engine is not usable at MSS scale until it is bounded, moved off the main thread,
or run asynchronously on the backend. The mobile confirmation view needs a
responsive KPI layout before mobile production use.

## Required MSS Data Pack

Before payroll use, obtain:

1. Legal employer ABN/entity and worksite for each employee.
2. Duties, licences and classification assessment against Schedule A.
3. Exact agreement/award assignment with effective dates and coverage basis.
4. Full agreement PDFs, approval decisions, undertakings, variations and any
   continuation/termination orders for every source instrument above.
5. Roster-cycle start/length, written 12-hour arrangements and part-time work
   patterns.
6. Actual start/finish, break times, paid/unpaid status and exception records.
7. First-aid, firearm, aviation, supervision, relieving, meal, vehicle, broken
   shift, higher-duties and callback eligibility/quantity evidence.
8. Rule definitions for all company-specific earning codes.
9. A roster export with stable employee and shift keys.
10. Leave balances, shiftworker status, super, tax, deductions, pay date and
    employee payment/contact records if the product is to become payroll rather
    than a gross-award audit tool.

## Official Sources

- [Security Services Industry Award MA000016](https://awards.fairwork.gov.au/MA000016.html)
- [Security Services Award pay guide effective 1 July 2026](https://calculate.fairwork.gov.au/Download/AwardSummary?awardCode=ma000016&fileType=pdf)
- [FWC Annual Wage Review 2026 determinations](https://www.fwc.gov.au/hearings-decisions/major-cases/annual-wage-reviews/annual-wage-review-2026/determinations-annual-wage-review-2026)
- [FWC agreements list for 2021](https://www.fwc.gov.au/documents/agreements/resources/agreements2021.pdf)
- [RBA 2020-2024 approval decision [2021] FWCA 438](https://www.fwc.gov.au/documents/decisionssigned/pdf/2021fwca438.pdf)
- [FWC agreements list for 2026](https://www.fwc.gov.au/documents/agreements/resources/agreements2026.pdf)
- [FWC enterprise-agreement finder and pre-2010 sunset guidance](https://www.fwc.gov.au/work-conditions/enterprise-agreements/find-enterprise-agreement)
- [NSW statewide public holidays](https://www.nsw.gov.au/about-nsw/public-holidays)
