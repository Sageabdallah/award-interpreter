import { createHash } from 'node:crypto'

const PREVIEW_PERIODS_PER_EMPLOYEE = 1

function listValue(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function dayName(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? ''
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()]
}

function publicId(prefix, value) {
  return `${prefix}-${createHash('sha256').update(`axi-workspace/v1/${value}`).digest('hex').slice(0, 10).toUpperCase()}`
}

function chunkRefs(manifest, kind) {
  return (manifest.chunkRefs || [])
    .filter((ref) => ref.kind === kind)
    .sort((left, right) => left.index - right.index)
}

async function verifiedChunk(auditStore, ref, kind) {
  const record = await auditStore.get(ref.auditId)
  if (!record || record.kind !== 'payroll-import-chunk' || record.hash !== ref.hash) {
    throw new Error(`Persisted ${kind} chunk ${ref.index} failed audit verification.`)
  }
  return record
}

function normalizeHistoricalDate(value, payrollLastDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  const lastYear = Number(String(payrollLastDate || '').slice(0, 4))
  if (!match || !lastYear) return String(value || '')
  const year = Number(match[1])
  return year > lastYear + 1 && year - 100 >= 1900
    ? `${year - 100}-${match[2]}-${match[3]}`
    : String(value || '')
}

function sanitizeShift(row, employeeId) {
  const dateKey = String(row.dateKey || '')
  return {
    employeeId,
    employeeName: `Employee ${employeeId}`,
    jobRole: String(row.sourceClassificationRaw || ''),
    employmentType: '',
    date: dateKey,
    dateKey,
    day: dayName(dateKey),
    start: String(row.start || ''),
    finish: String(row.finish || ''),
    breakMinutes: 0,
    hours: Number(row.hours) || 0,
    notes: row.sourceEntryKind === 'worked' ? '' : 'Source leave/payroll entry',
    sourceShiftId: publicId('SHIFT', row.sourceShiftId || `${row.employeeId}:${dateKey}`),
    sourceAwardCode: String(row.sourceAwardCode || ''),
    sourceClassificationRaw: String(row.sourceClassificationRaw || ''),
    sourceShiftDefinition: String(row.sourceShiftDefinition || ''),
    sourceComponentCount: Number(row.sourceComponentCount) || 0,
    sourceOrdinaryBaseRate: Number(row.sourceOrdinaryBaseRate) || undefined,
    sourceOrdinaryHours: Number(row.sourceOrdinaryHours) || 0,
    sourceOvertimeHours: Number(row.sourceOvertimeHours) || 0,
    sourceLeaveHours: Number(row.sourceLeaveHours) || 0,
    sourceOrdinaryAmount: Number(row.sourceOrdinaryAmount) || 0,
    sourceOvertimeAmount: Number(row.sourceOvertimeAmount) || 0,
    sourcePenaltyAmount: Number(row.sourcePenaltyAmount) || 0,
    sourceAllowanceAmount: Number(row.sourceAllowanceAmount) || 0,
    sourceLeaveAmount: Number(row.sourceLeaveAmount) || 0,
    sourceOtherAmount: Number(row.sourceOtherAmount) || 0,
    sourceGrossAmount: Number(row.sourceGrossAmount) || 0,
    sourceEarningCodes: listValue(row.sourceEarningCodes).slice(0, 30),
    sourceImportWarnings: listValue(row.sourceImportWarnings).slice(0, 20),
    sourceEntryKind: String(row.sourceEntryKind || ''),
    releaseBlocked: true,
    sourceName: 'Protected backend payroll import',
  }
}

async function buildWorkspace(auditStore, record) {
  const manifest = record.data
  if (!Array.isArray(manifest.chunkRefs)) throw new Error('The latest payroll import has no verified chunk references.')
  const employeeRows = []
  for (const ref of chunkRefs(manifest, 'employees')) {
    const chunk = await verifiedChunk(auditStore, ref, 'employees')
    employeeRows.push(...(chunk.data.rows || []))
  }
  const publicIds = new Map(employeeRows.map((row) => [
    String(row.employeeId || ''),
    publicId('MSS', row.employeeId),
  ]))
  const previewByEmployee = new Map(employeeRows.map((row) => [String(row.employeeId || ''), []]))

  for (const ref of chunkRefs(manifest, 'work-periods')) {
    const chunk = await verifiedChunk(auditStore, ref, 'work-periods')
    for (const row of chunk.data.rows || []) {
      const rawEmployeeId = String(row.employeeId || '')
      const preview = previewByEmployee.get(rawEmployeeId)
      if (!preview || preview.length >= PREVIEW_PERIODS_PER_EMPLOYEE) continue
      preview.push(sanitizeShift(row, publicIds.get(rawEmployeeId)))
    }
  }

  const summary = manifest.summary || {}
  const employees = employeeRows.map((row) => {
    const rawEmployeeId = String(row.employeeId || '')
    const employeeId = publicIds.get(rawEmployeeId)
    return {
      employeeId,
      employeeName: `Employee ${employeeId}`,
      jobRole: String(row.sourceClassification || ''),
      employmentType: String(row.employmentType || ''),
      employeeRank: String(row.employeeRank || ''),
      stateCode: String(row.stateCode || ''),
      homeArea: String(row.area || ''),
      publicHolidayArea: String(row.publicHolidayArea || ''),
      employmentStart: normalizeHistoricalDate(row.employmentStart, summary.lastDate),
      timeRotation: String(row.timeRotation || ''),
      employeeMasterAwardCode: String(row.employeeMasterAwardCode || ''),
      payrollBatchCode: String(row.payrollBatchCode || ''),
      sevenDayWorker: row.sevenDayWorker,
      trainee: row.trainee,
      overridePostAward: row.overridePostAward,
      employeeMasterMatched: row.employeeMasterMatched === true,
      sourceAwardCodes: listValue(row.sourceAwardCodes).slice(0, 20),
      shifts: previewByEmployee.get(rawEmployeeId) || [],
      workPeriodCount: Number(row.workPeriodCount) || 0,
      totalHours: Number(row.totalHours) || 0,
      sourceGrossAmount: Number(row.sourceGrossAmount) || 0,
      sourceComponentCount: Number(row.sourceComponentCount) || 0,
    }
  }).sort((left, right) => left.employeeId.localeCompare(right.employeeId))
  const pendingInstruments = (manifest.coverageInventory || [])
    .filter((item) => item.supportStatus !== 'supported-date-range-needs-employee-evidence').length

  return {
    audit: { id: record.id, createdAt: record.createdAt, hash: record.hash },
    timesheetData: {
      schemaVersion: manifest.schemaVersion,
      sourceOnly: true,
      backendLoaded: true,
      releaseBlocked: true,
      detailTruncated: true,
      meta: {
        payPeriod: summary.firstDate && summary.lastDate ? `${summary.firstDate} to ${summary.lastDate}` : '',
        business: manifest.business || 'MSS Security source payroll',
        generated: record.createdAt,
        sourceName: manifest.sourceName,
        sourceSize: Number(manifest.sourceSize) || 0,
        sourceSchema: 'protected-backend-import',
        backendAuditId: record.id,
      },
      employees,
      totalHours: Number(summary.payableHours) || 0,
      sourceSummary: {
        ...summary,
        detailedWorkPeriods: employees.reduce((count, employee) => count + employee.shifts.length, 0),
      },
      coverageInventory: manifest.coverageInventory || [],
      employeeMaster: manifest.employeeMaster || null,
      releaseBlockingGaps: [
        manifest.employeeMaster?.unmatchedEmployees > 0
          ? `${manifest.employeeMaster.unmatchedEmployees} historical payroll IDs are absent from the supplied employee master.`
          : '',
        'Agreed ordinary-hours arrangements still require verification for the applicable payroll dates.',
        pendingInstruments > 0
          ? `${pendingInstruments} source instruments still require verified operative rules.`
          : '',
      ].filter(Boolean),
      sourceDataNotes: [
        'The complete source ledger remains in the protected audit store; this response contains privacy-sanitised employee summaries and a bounded work-period preview.',
      ],
    },
  }
}

export function latestMssWorkspaceRoute({ auditStore }) {
  let cached = null
  let pending = null
  return async (_req, res) => {
    if (!auditStore?.list || !auditStore?.get) return res.status(503).json({ error: 'Payroll workspace persistence is unavailable.' })
    const [latest] = await auditStore.list({ kind: 'payroll-import', limit: 1 })
    if (!latest) return res.status(404).json({ error: 'No completed payroll import is available.' })
    if (cached?.auditId === latest.id) return res.json({ ok: true, workspace: cached.workspace })
    if (!pending || pending.auditId !== latest.id) {
      pending = {
        auditId: latest.id,
        promise: (async () => {
          const snapshots = await auditStore.list({ kind: 'payroll-workspace-snapshot', limit: 1 })
          const snapshot = snapshots.find((item) => item.data?.sourceAuditId === latest.id)
          if (snapshot?.data?.workspace) return snapshot.data.workspace

          const workspace = await buildWorkspace(auditStore, latest)
          // The source ledger stays chunked. This compact, sanitised read model
          // avoids rescanning 257k work periods whenever a free instance wakes.
          await auditStore.save('payroll-workspace-snapshot', {
            sourceAuditId: latest.id,
            schemaVersion: 'mss-workspace-snapshot/v1',
            workspace,
          })
          return workspace
        })(),
      }
    }
    const active = pending
    let workspace
    try {
      workspace = await active.promise
    } catch (error) {
      if (pending === active) pending = null
      throw error
    }
    cached = { auditId: latest.id, workspace }
    if (pending === active) pending = null
    return res.json({ ok: true, workspace })
  }
}
