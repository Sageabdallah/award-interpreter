import { createHash } from 'node:crypto'
import { buildParsedCacheFromTexts } from '../../src/domain/cacheBuilder.js'
import { calculateTimesheetResults } from '../../src/domain/payCalculator.js'
import { parseTimesheetRows } from '../../src/domain/timesheetParser.js'
import { persistPayRun } from './payRuns.js'

const MAX_DOCUMENT_CHARACTERS = 5_000_000
const MAX_TIMESHEET_ROWS = 20_000
const MAX_TIMESHEET_COLUMNS = 100

function validText(value) {
  return typeof value === 'string' && value.length <= MAX_DOCUMENT_CHARACTERS
}

export function validInterpretPayRunPayload(body) {
  if (!body || !validText(body.agreementText) || !body.agreementText.trim()) {
    return 'Body must include agreementText.'
  }
  if (body.complianceText != null && !validText(body.complianceText)) return 'complianceText is too large.'
  if (body.awardText != null && !validText(body.awardText)) return 'awardText is too large.'
  if (!Array.isArray(body.timesheetRows) || !body.timesheetRows.length || body.timesheetRows.length > MAX_TIMESHEET_ROWS) {
    return `Body must include 1-${MAX_TIMESHEET_ROWS} timesheetRows.`
  }
  if (body.timesheetRows.some((row) => !Array.isArray(row) || row.length > MAX_TIMESHEET_COLUMNS)) {
    return `Every timesheet row must be an array of at most ${MAX_TIMESHEET_COLUMNS} cells.`
  }
  return null
}

function interpretationFingerprint(body) {
  return createHash('sha256').update(JSON.stringify({
    awardText: body.awardText || '',
    complianceText: body.complianceText || '',
    agreementText: body.agreementText,
    timesheetRows: body.timesheetRows,
  })).digest('hex')
}

export function interpretPayRunRoute({ auditStore, library }) {
  return async (req, res) => {
    const problem = validInterpretPayRunPayload(req.body)
    if (problem) return res.status(400).json({ error: problem })

    const fingerprint = interpretationFingerprint(req.body)
    const parsedCache = await buildParsedCacheFromTexts({
      awardText: req.body.awardText || '',
      complianceText: req.body.complianceText || '',
      agreementText: req.body.agreementText,
    }, {
      cacheFingerprint: fingerprint,
      sourceNames: {
        award: 'api-award-document',
        compliance: 'api-compliance-document',
        agreement: 'api-agreement-document',
      },
      preloadedAwards: library,
      industry: 'security',
    })
    const timesheetData = parseTimesheetRows(req.body.timesheetRows, 'api-timesheet')
    const results = calculateTimesheetResults(parsedCache, timesheetData)
    const persisted = await persistPayRun(auditStore, {
      sourceFingerprint: req.body.sourceFingerprint || fingerprint,
      payPeriod: req.body.payPeriod || timesheetData.meta.payPeriod,
      business: req.body.business || timesheetData.meta.business,
      rows: results.rows,
    }, {
      interpretation: {
        payloadFingerprint: fingerprint,
        awardCodes: parsedCache.awardCodes,
        employeeProfiles: parsedCache.employeeProfiles.length,
        timesheetRows: timesheetData.shifts.length,
        parseWarnings: parsedCache.parseWarnings,
      },
    })
    if (persisted.problem) return res.status(400).json({ error: persisted.problem })

    return res.status(201).json({
      ok: true,
      persisted: true,
      payloadFingerprint: fingerprint,
      parseWarnings: parsedCache.parseWarnings,
      timesheet: {
        employeeCount: timesheetData.employees.length,
        shiftCount: timesheetData.shifts.length,
        totalHours: timesheetData.totalHours,
      },
      results,
      releaseGate: persisted.releaseGate,
      audit: persisted.audit,
    })
  }
}
