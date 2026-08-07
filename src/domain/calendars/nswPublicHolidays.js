// Statewide dates published by NSW Industrial Relations. Local and part-day
// holidays require a worksite/locality match and are intentionally excluded.
// https://www.nsw.gov.au/about-nsw/public-holidays
const NSW_STATEWIDE_DATES = Object.freeze({
  2024: new Set([
    '2024-01-01', '2024-01-26', '2024-03-29', '2024-03-30', '2024-03-31',
    '2024-04-01', '2024-04-25', '2024-06-10', '2024-10-07', '2024-12-25', '2024-12-26',
  ]),
  2025: new Set([
    '2025-01-01', '2025-01-27', '2025-04-18', '2025-04-19', '2025-04-20',
    '2025-04-21', '2025-04-25', '2025-06-09', '2025-10-06', '2025-12-25', '2025-12-26',
  ]),
  2026: new Set([
    '2026-01-01', '2026-01-26', '2026-04-03', '2026-04-04', '2026-04-05',
    '2026-04-06', '2026-04-25', '2026-04-27', '2026-06-08', '2026-10-05',
    '2026-12-25', '2026-12-26', '2026-12-28',
  ]),
})

export function hasNswPublicHolidayCalendarYear(year) {
  return Boolean(NSW_STATEWIDE_DATES[Number(year)])
}

export function isNswStatewidePublicHoliday(dateKey) {
  const year = Number(String(dateKey || '').slice(0, 4))
  return NSW_STATEWIDE_DATES[year]?.has(String(dateKey)) || false
}
