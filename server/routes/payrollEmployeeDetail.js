import { publicPayrollId } from '../payrollPrivacy.js'

const DETAIL_SCHEMA_VERSION = 'mss-payroll-employee-detail/v1'
const DIRECTORY_SCHEMA_VERSION = 'mss-payroll-work-period-directory/v1'
const PUBLIC_EMPLOYEE_ID = /^MSS-[A-F0-9]{10}$/
const DETAIL_CACHE_LIMIT = 50

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function round(value, places = 2) {
  const scale = 10 ** places
  return Math.round((number(value) + Number.EPSILON) * scale) / scale
}

function listValue(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function isoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : ''
}

function addUtcDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function weekStartFor(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.getUTCDay()
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1))
  return date.toISOString().slice(0, 10)
}

function emptyTotals() {
  return {
    payableHours: 0,
    workedHours: 0,
    leaveHours: 0,
    ordinaryHours: 0,
    overtimeHours: 0,
    componentRows: 0,
    workPeriods: 0,
    sourceGrossAmount: 0,
    ordinaryAmount: 0,
    overtimeAmount: 0,
    penaltyAmount: 0,
    allowanceAmount: 0,
    leaveAmount: 0,
    otherAmount: 0,
  }
}

function addRow(totals, row) {
  const payableHours = number(row.hours)
  totals.payableHours += payableHours
  totals.workedHours += row.sourceEntryKind === 'worked' ? payableHours : 0
  totals.leaveHours += number(row.sourceLeaveHours)
  totals.ordinaryHours += number(row.sourceOrdinaryHours)
  totals.overtimeHours += number(row.sourceOvertimeHours)
  totals.componentRows += number(row.sourceComponentCount)
  totals.workPeriods += 1
  totals.sourceGrossAmount += number(row.sourceGrossAmount)
  totals.ordinaryAmount += number(row.sourceOrdinaryAmount)
  totals.overtimeAmount += number(row.sourceOvertimeAmount)
  totals.penaltyAmount += number(row.sourcePenaltyAmount)
  totals.allowanceAmount += number(row.sourceAllowanceAmount)
  totals.leaveAmount += number(row.sourceLeaveAmount)
  totals.otherAmount += number(row.sourceOtherAmount)
}

function finalizedTotals(totals) {
  return {
    payableHours: round(totals.payableHours, 2),
    workedHours: round(totals.workedHours, 2),
    leaveHours: round(totals.leaveHours, 2),
    ordinaryHours: round(totals.ordinaryHours, 2),
    overtimeHours: round(totals.overtimeHours, 2),
    componentRows: Math.round(totals.componentRows),
    workPeriods: Math.round(totals.workPeriods),
    sourceGrossAmount: round(totals.sourceGrossAmount, 2),
    effectiveGrossPerPayableHour: totals.payableHours > 0
      ? round(totals.sourceGrossAmount / totals.payableHours, 2)
      : 0,
    categories: {
      ordinary: round(totals.ordinaryAmount, 2),
      overtime: round(totals.overtimeAmount, 2),
      penalties: round(totals.penaltyAmount, 2),
      allowances: round(totals.allowanceAmount, 2),
      leave: round(totals.leaveAmount, 2),
      other: round(totals.otherAmount, 2),
    },
  }
}

function chunkRefs(manifest, kind) {
  return (manifest.chunkRefs || [])
    .filter((ref) => ref.kind === kind)
    .sort((left, right) => left.index - right.index)
}

async function verifiedChunk(auditStore, ref, kind) {
  const record = await auditStore.get(ref.auditId)
  if (!record || record.kind !== 'payroll-import-chunk' || record.hash !== ref.hash || record.data?.kind !== kind) {
    throw new Error(`Persisted ${kind} chunk ${ref.index} failed audit verification.`)
  }
  return record
}

async function sourceEmployeeIndex(auditStore, manifest, requestedId) {
  const publicIdByRawId = new Map()
  let match = null
  for (const ref of chunkRefs(manifest, 'employees')) {
    const chunk = await verifiedChunk(auditStore, ref, 'employees')
    for (const employee of chunk.data.rows || []) {
      const rawId = String(employee.employeeId || '')
      const publicId = publicPayrollId('MSS', rawId)
      publicIdByRawId.set(rawId, publicId)
      if (publicId === requestedId) match = { rawId, employee }
    }
  }
  return { match, publicIdByRawId }
}

function dayRecord(dateKey) {
  return {
    date: dateKey,
    ...emptyTotals(),
    entryKinds: new Set(),
    earningCodes: new Set(),
  }
}

function weekRecord(weekStart) {
  return {
    weekStart,
    weekEnd: addUtcDays(weekStart, 6),
    ...emptyTotals(),
    entryKinds: new Set(),
    earningCodes: new Set(),
    days: new Map(),
  }
}

function finalizeDay(day) {
  return {
    date: day.date,
    ...finalizedTotals(day),
    entryKinds: [...day.entryKinds].sort(),
    earningCodes: [...day.earningCodes].sort(),
  }
}

function finalizeWeek(week) {
  return {
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    ...finalizedTotals(week),
    entryKinds: [...week.entryKinds].sort(),
    earningCodes: [...week.earningCodes].sort(),
    days: [...week.days.values()].sort((left, right) => left.date.localeCompare(right.date)).map(finalizeDay),
  }
}

function buildDirectory(sourceRecord, chunkIndexesByEmployee) {
  return {
    schemaVersion: DIRECTORY_SCHEMA_VERSION,
    sourceAuditId: sourceRecord.id,
    chunkIndexesByEmployee: Object.fromEntries(
      [...chunkIndexesByEmployee.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([employeeId, indexes]) => [employeeId, [...indexes].sort((left, right) => left - right)]),
    ),
  }
}

async function buildEmployeeDetail(auditStore, sourceRecord, requestedId, directory = null) {
  const manifest = sourceRecord.data || {}
  const { match, publicIdByRawId } = await sourceEmployeeIndex(auditStore, manifest, requestedId)
  if (!match) return null

  const totals = emptyTotals()
  const weeks = new Map()
  const earningCodes = new Set()
  const sourceInstruments = new Set()
  let firstDate = ''
  let lastDate = ''
  const chunkIndexesByEmployee = directory ? null : new Map()
  const workPeriodRefs = chunkRefs(manifest, 'work-periods')
  const requestedChunkIndexes = directory?.chunkIndexesByEmployee?.[requestedId]
  const selectedRefs = Array.isArray(requestedChunkIndexes)
    ? workPeriodRefs.filter((ref) => requestedChunkIndexes.includes(ref.index))
    : workPeriodRefs

  for (const ref of selectedRefs) {
    const chunk = await verifiedChunk(auditStore, ref, 'work-periods')
    for (const row of chunk.data.rows || []) {
      const rawEmployeeId = String(row.employeeId || '')
      if (chunkIndexesByEmployee) {
        const publicEmployeeId = publicIdByRawId.get(rawEmployeeId)
        if (publicEmployeeId) {
          if (!chunkIndexesByEmployee.has(publicEmployeeId)) chunkIndexesByEmployee.set(publicEmployeeId, new Set())
          chunkIndexesByEmployee.get(publicEmployeeId).add(ref.index)
        }
      }
      if (rawEmployeeId !== match.rawId) continue
      const dateKey = isoDate(row.dateKey)
      if (!dateKey) continue
      const weekStart = weekStartFor(dateKey)
      if (!weeks.has(weekStart)) weeks.set(weekStart, weekRecord(weekStart))
      const week = weeks.get(weekStart)
      if (!week.days.has(dateKey)) week.days.set(dateKey, dayRecord(dateKey))
      const day = week.days.get(dateKey)

      addRow(totals, row)
      addRow(week, row)
      addRow(day, row)
      const entryKind = String(row.sourceEntryKind || '')
      if (entryKind) {
        week.entryKinds.add(entryKind)
        day.entryKinds.add(entryKind)
      }
      for (const code of listValue(row.sourceEarningCodes)) {
        earningCodes.add(code)
        week.earningCodes.add(code)
        day.earningCodes.add(code)
      }
      const instrument = String(row.sourceAwardCode || '').trim()
      if (instrument) sourceInstruments.add(instrument)
      if (!firstDate || dateKey < firstDate) firstDate = dateKey
      if (!lastDate || dateKey > lastDate) lastDate = dateKey
    }
  }

  const calculated = finalizedTotals(totals)
  const expected = {
    payableHours: round(match.employee.totalHours, 2),
    workPeriods: Math.round(number(match.employee.workPeriodCount)),
    componentRows: Math.round(number(match.employee.sourceComponentCount)),
    sourceGrossAmount: round(match.employee.sourceGrossAmount, 2),
  }
  const differences = {
    payableHours: round(calculated.payableHours - expected.payableHours, 2),
    workPeriods: calculated.workPeriods - expected.workPeriods,
    componentRows: calculated.componentRows - expected.componentRows,
    sourceGrossAmount: round(calculated.sourceGrossAmount - expected.sourceGrossAmount, 2),
  }
  const reconciled = Math.abs(differences.payableHours) <= 0.01
    && differences.workPeriods === 0
    && differences.componentRows === 0
    && Math.abs(differences.sourceGrossAmount) <= 0.01

  const detail = {
    schemaVersion: DETAIL_SCHEMA_VERSION,
    sourceAuditId: sourceRecord.id,
    sourceName: String(manifest.sourceName || ''),
    sourcePeriod: { firstDate, lastDate },
    employee: {
      employeeId: requestedId,
      employeeName: `Employee ${requestedId}`,
      classification: String(match.employee.sourceClassification || ''),
      employmentType: String(match.employee.employmentType || ''),
    },
    annual: { expected, calculated, differences, reconciled },
    sourceInstruments: [...sourceInstruments].sort(),
    earningCodes: [...earningCodes].sort(),
    weeks: [...weeks.values()].sort((left, right) => left.weekStart.localeCompare(right.weekStart)).map(finalizeWeek),
  }
  return {
    detail,
    directory: chunkIndexesByEmployee ? buildDirectory(sourceRecord, chunkIndexesByEmployee) : null,
  }
}

export function payrollEmployeeDetailRoute({ auditStore }) {
  const memoryCache = new Map()
  const directoryCache = new Map()
  const pending = new Map()

  function remember(key, detail) {
    memoryCache.delete(key)
    memoryCache.set(key, detail)
    if (memoryCache.size > DETAIL_CACHE_LIMIT) memoryCache.delete(memoryCache.keys().next().value)
  }

  return async (req, res) => {
    const requestedId = String(req.params.employeeId || '').toUpperCase()
    if (!PUBLIC_EMPLOYEE_ID.test(requestedId)) return res.status(400).json({ error: 'A valid MSS employee reference is required.' })
    const [latest] = await auditStore.list({ kind: 'payroll-import', limit: 1 })
    if (!latest) return res.status(404).json({ error: 'No completed payroll import is available.' })

    const cacheKey = `${latest.id}:${requestedId}`
    if (memoryCache.has(cacheKey)) {
      res.set('Cache-Control', 'private, no-store')
      return res.json({ ok: true, payrollDetail: memoryCache.get(cacheKey) })
    }

    const saved = (await auditStore.list({ kind: 'payroll-employee-detail', limit: 200 }))
      .find((record) => record.data?.schemaVersion === DETAIL_SCHEMA_VERSION
        && record.data?.sourceAuditId === latest.id
        && record.data?.employee?.employeeId === requestedId)
    if (saved) {
      remember(cacheKey, saved.data)
      res.set('Cache-Control', 'private, no-store')
      return res.json({ ok: true, payrollDetail: saved.data })
    }

    if (!pending.has(cacheKey)) {
      pending.set(cacheKey, (async () => {
        let directory = directoryCache.get(latest.id)
        if (!directory) {
          const savedDirectories = await auditStore.list({ kind: 'payroll-work-period-directory', limit: 10 })
          directory = savedDirectories.find((record) => record.data?.schemaVersion === DIRECTORY_SCHEMA_VERSION
            && record.data?.sourceAuditId === latest.id)?.data || null
          if (directory) directoryCache.set(latest.id, directory)
        }
        const built = await buildEmployeeDetail(auditStore, latest, requestedId, directory)
        const detail = built?.detail || null
        if (built?.directory) {
          await auditStore.save('payroll-work-period-directory', built.directory)
          directoryCache.set(latest.id, built.directory)
        }
        if (detail) await auditStore.save('payroll-employee-detail', detail)
        return detail
      })())
    }

    let detail
    try {
      detail = await pending.get(cacheKey)
    } finally {
      pending.delete(cacheKey)
    }
    if (!detail) return res.status(404).json({ error: 'Employee payroll detail was not found in the latest import.' })
    remember(cacheKey, detail)
    res.set('Cache-Control', 'private, no-store')
    return res.json({ ok: true, payrollDetail: detail })
  }
}
