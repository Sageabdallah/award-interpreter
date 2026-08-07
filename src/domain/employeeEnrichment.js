import { formatDateKey, round2 } from './utils.js'

export const DEFAULT_ANCHOR_KEY = '2026-07-20'

export function expiryStatus(expiryKey, anchorKey) {
  if (!expiryKey) return 'Unknown'
  if (expiryKey < anchorKey) return 'Expired'
  const threshold = new Date(`${anchorKey}T00:00:00Z`)
  threshold.setUTCDate(threshold.getUTCDate() + 90)
  if (expiryKey <= threshold.toISOString().slice(0, 10)) return 'Expiring soon'
  return 'Current'
}

const minutesOf = (value) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export function classifyShift(shift) {
  const start = minutesOf(shift.start)
  const finish = minutesOf(shift.finish)
  if (start == null || finish == null) return 'Day'
  if (finish <= start || start >= 20 * 60 || start < 5 * 60) return 'Night'
  if (finish > 18 * 60) return 'Evening'
  return 'Day'
}

export function summariseRoster(shifts = []) {
  const summary = { shifts: shifts.length, hours: 0, nightShifts: 0, eveningShifts: 0, weekendHours: 0, locations: [] }
  const locations = new Set()
  for (const shift of shifts) {
    const hours = Number(shift.hours) || 0
    summary.hours += hours
    const kind = classifyShift(shift)
    if (kind === 'Night') summary.nightShifts += 1
    if (kind === 'Evening') summary.eveningShifts += 1
    if (/satur|sun/i.test(shift.day || '')) summary.weekendHours += hours
    if (shift.location) locations.add(shift.location)
  }
  summary.hours = round2(summary.hours)
  summary.weekendHours = round2(summary.weekendHours)
  summary.locations = [...locations]
  return summary
}

function parseAnchor(timesheetMeta) {
  const periodStart = String(timesheetMeta?.payPeriod || '').split(/\s+-\s+/)[0]?.trim()
  const key = formatDateKey(periodStart || '')
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : DEFAULT_ANCHOR_KEY
}

function tenureYears(startDateKey, anchorKey) {
  const start = Date.parse(`${startDateKey}T00:00:00Z`)
  const anchor = Date.parse(`${anchorKey}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(anchor) || start > anchor) return '—'
  return round2((anchor - start) / (365.25 * 86400000))
}

function verifiedRegistration(profile, anchorKey) {
  if (!profile?.registration || typeof profile.registration !== 'object') return null
  const registration = { ...profile.registration }
  registration.status = registration.status || expiryStatus(registration.expiryKey, anchorKey)
  return registration
}

function verifiedCompliance(profile, anchorKey) {
  if (!Array.isArray(profile?.trainingCompliance)) return []
  return profile.trainingCompliance.map((item) => ({
    ...item,
    status: item.status || expiryStatus(item.expiryKey, anchorKey),
  }))
}

export function roleCatalogueFor() {
  return { education: [], registration: null, certificates: [], clinical: false }
}

export function buildEmployeeDossier({ profile = null, timesheetEmployee = null, timesheetMeta = null }) {
  const employeeName = profile?.employeeName || timesheetEmployee?.employeeName || ''
  const employeeId = profile?.employeeId || timesheetEmployee?.employeeId || ''
  const jobRole = timesheetEmployee?.jobRole || profile?.jobRole || ''
  const employmentType = timesheetEmployee?.employmentType || profile?.employmentType || 'Unknown'
  const anchorKey = parseAnchor(timesheetMeta)
  const roster = summariseRoster(timesheetEmployee?.shifts || [])
  const startDateKey = profile?.employmentStart || ''
  const casual = /casual/i.test(employmentType)

  return {
    employeeName,
    employeeId,
    jobRole,
    employmentType,
    anchorKey,
    onRegister: Boolean(profile),
    education: Array.isArray(profile?.education) ? [...profile.education] : [],
    registration: verifiedRegistration(profile, anchorKey),
    certificates: Array.isArray(profile?.certificates) ? [...profile.certificates] : [],
    compliance: verifiedCompliance(profile, anchorKey),
    leave: {
      annualHours: profile?.leave?.annualHours ?? '—',
      personalHours: profile?.leave?.personalHours ?? '—',
      longServiceWeeks: profile?.leave?.longServiceWeeks ?? 0,
      note: casual ? 'Leave balances were not supplied in the source data.' : '',
    },
    employment: {
      startDateKey,
      tenureYears: tenureYears(startDateKey, anchorKey),
      homeSite: profile?.site || profile?.area || roster.locations[0] || '—',
      payrollNumber: profile?.payrollNumber || '—',
      superFund: profile?.superFund || '—',
      contractedHours: Number(profile?.ordinaryHoursPerWeek) > 0 ? Number(profile.ordinaryHoursPerWeek) : null,
    },
    contact: {
      phone: profile?.phone || '—',
      email: profile?.email || '—',
      emergency: profile?.emergencyContact || { name: '—', relation: 'Not supplied', phone: '—' },
    },
    roster,
    priorPeriods: Array.isArray(profile?.priorPeriods) ? [...profile.priorPeriods] : [],
    dataQuality: {
      fabricatedFields: [],
      unavailable: [
        !profile?.registration && 'registration',
        !profile?.education?.length && 'education',
        !profile?.certificates?.length && 'certificates',
        !profile?.trainingCompliance?.length && 'training compliance',
        !profile?.leave && 'leave balances',
        !profile?.phone && 'phone',
        !profile?.email && 'email',
        !profile?.emergencyContact && 'emergency contact',
        !profile?.priorPeriods?.length && 'prior pay periods',
      ].filter(Boolean),
    },
  }
}
