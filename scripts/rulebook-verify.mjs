/* Pure verification for the rulebook data. Imported by both generators, which
   abort (process.exit(1)) before writing if !ok — same gate as the timesheet
   generator. Checks the rate identities and the structural invariants. */
import { LEVELS, SECTIONS, PENALTY_EXAMPLES, casualOf, round2 } from './rulebook-data.mjs'

export function verifyAll() {
  const failures = []
  const ok = (cond, msg) => { if (!cond) failures.push(msg) }

  // 1. published hourly === round(weekly / 38, 2) for every level
  for (const l of LEVELS) {
    const expected = round2(l.weekly / 38)
    ok(l.hourly === expected, `${l.code}: hourly ${l.hourly} != weekly/38 (${expected})`)
  }

  // 2. casual hourly === round(hourly * 1.25, 2)
  for (const l of LEVELS) {
    ok(casualOf(l.hourly) === round2(l.hourly * 1.25), `${l.code}: casual loading identity failed`)
  }

  // 3. penalty dollar examples === base hourly * percentage
  const b = PENALTY_EXAMPLES.base
  const checks = [
    ['FT/PT Sat', PENALTY_EXAMPLES.ftpt.sat, 1.25], ['FT/PT Sun', PENALTY_EXAMPLES.ftpt.sun, 1.5], ['FT/PT PH', PENALTY_EXAMPLES.ftpt.ph, 2.25],
    ['Casual Sat', PENALTY_EXAMPLES.casual.sat, 1.5], ['Casual Sun', PENALTY_EXAMPLES.casual.sun, 1.75], ['Casual PH', PENALTY_EXAMPLES.casual.ph, 2.5],
  ]
  for (const [label, ex, mult] of checks) {
    ok(ex.amt === round2(b * mult), `${label}: $${ex.amt} != ${b} * ${mult} (${round2(b * mult)})`)
    ok(ex.pct === Math.round(mult * 100), `${label}: pct ${ex.pct} != ${Math.round(mult * 100)}`)
  }

  // 4. structural invariants
  ok(SECTIONS.length === 11, `expected 11 sections, got ${SECTIONS.length}`)
  const names = new Set()
  for (const s of SECTIONS) {
    ok(/^(0[1-9]|1[01])_/.test(s.sheetName), `bad sheetName ${s.sheetName}`)
    ok(s.sheetName.length <= 31, `sheetName too long: ${s.sheetName}`)
    ok(!names.has(s.sheetName), `duplicate sheetName ${s.sheetName}`)
    names.add(s.sheetName)
    ok(Array.isArray(s.rows) && s.rows.length >= 1, `section ${s.id} has no rows`)
    ok(s.rows.every((r) => r.length === s.columns.length), `section ${s.id}: row/column width mismatch`)
    ok(typeof s.intro === 'string' && s.intro.length > 20, `section ${s.id}: missing intro`)
  }

  const rowCount = SECTIONS.reduce((n, s) => n + s.rows.length, 0)
  const report = failures.length
    ? 'VERIFY FAILED:\n  ' + failures.join('\n  ')
    : `VERIFY OK: ${SECTIONS.length} sections, ${rowCount} rows; all rate identities and penalty examples hold.`
  return { ok: failures.length === 0, failures, report }
}
