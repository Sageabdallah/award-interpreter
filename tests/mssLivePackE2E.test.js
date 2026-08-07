import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import XLSX from 'xlsx'

XLSX.set_fs(fs)

const run = promisify(execFile)
const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function excelSerial(year, monthIndex, day) {
  return (Date.UTC(year, monthIndex, day) - Date.UTC(1899, 11, 30)) / 86400000
}

function writeWorkbook(filePath, sheetName, rows) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), sheetName)
  XLSX.writeFile(workbook, filePath)
}

describe('MSS live pack generator', () => {
  it('conserves source components through generated upload and audit artifacts', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mss-pack-'))
    temporaryDirectories.push(directory)
    const sourceDirectory = path.join(directory, 'source')
    const outputDirectory = path.join(directory, 'output')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(sourceDirectory, { recursive: true }))

    const awardRates = [26.22, 26.97, 27.42, 27.88, 28.78]
    writeWorkbook(path.join(sourceDirectory, 'Award.xlsx'), 'Sheet1', awardRates.map((Rate) => ({
      AwardCode: 'MA000016-NSW', AwardRule: 'Fixed - Fulltime', EmpType: 2,
      MinOrdHrsDay: 7.6, MinOrdHrsWeek: 38, MaxOTHrsDay: 8, MaxOrdHrsWeek: 38, MaxShiftLength: 14, Rate,
    })))
    writeWorkbook(path.join(sourceDirectory, 'Employee.xlsx'), 'Employee', [{
      EmployeeId: 41001, JoiningDate: excelSerial(2020, 0, 1), EmployeeType: 'Fulltime',
      AwardCode: 'MA000016-NSW', Area: 'Sydney', PHLArea: 'Sydney', EmpRank: 'NSW Team 1',
      TimeRotation: 'Rotating', Is7DayWorker: 'Yes', PayrollBatchCode: 'NSW1', OverridePostAward: 'N',
    }])
    const monday = excelSerial(2024, 9, 14)
    const base = {
      EmployeeID: 41001, Area: 'Sydney', ShiftID: 9001, ShiftDate: monday,
      ShiftStartTime: 600, ShiftFinishTime: 1400, AwardCode: '(NSW) Security Services Industry Award',
      AwardClassificationCode: 'Level 4 Officer', Hours: 8, Rate: 27.88, RateType: 1,
      Amount: 223.04, EarningCode: 'ORDINARY', EarningType: 'Ordinary', ShiftDefinition: 'Day Shift', PayIndicator: 'Ordinary',
    }
    writeWorkbook(path.join(sourceDirectory, 'Nsw_Payroll 1.xlsx'), 'Nsw_Payroll', [
      base,
      { ...base, Rate: 21.7, RateType: 2, Amount: 48.4, EarningCode: '21.7% SHFT', EarningType: 'Penalties', PayIndicator: 'ShiftAllowance' },
      { ...base, ShiftID: 9002, ShiftDate: monday + 13 },
      { ...base, EmployeeID: 42002, AwardCode: 'NSW - RBA Martin Place EBA' },
    ])
    writeWorkbook(path.join(sourceDirectory, 'Projected_roster.xlsx'), 'Projected Roster', [
      { ComponentId: 1, projectedOrdinaryHrs: 76, projectedOvertimeHrs: 0 },
    ])

    const { stdout } = await run(process.execPath, ['scripts/generateSecurityLivePack.mjs'], {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        ISOFT_DATA_DIR: sourceDirectory,
        LIVE_OUT_DIR: outputDirectory,
        AREA: 'Sydney',
        MAX_EMPLOYEES: '1',
      },
      timeout: 30000,
    })
    expect(stdout).toContain('Retained 3/3 source payroll components losslessly; 3 belong to the worked cohort across 2 shifts.')

    const validation = JSON.parse(await readFile(path.join(outputDirectory, 'import-validation-report.json'), 'utf8'))
    expect(validation).toMatchObject({
      retainedLedgerRows: 3,
      retainedShiftRows: 2,
      parserShiftRows: 2,
      parserEmployeeRows: 1,
      calculatedEmployeeRows: 1,
      unresolvedEmployeeRows: 0,
      calculationStats: {
        employees: 1,
        totalCalculatedPay: expect.any(Number),
      },
    })
    const ledger = JSON.parse(await readFile(path.join(outputDirectory, 'source-ledger.private.json'), 'utf8'))
    expect(ledger.sourcePayrollComponents).toHaveLength(3)
    expect(ledger.shifts[0].sourceComponents).toHaveLength(2)
    expect(ledger.projectedRoster.status).toBe('unjoined')

    const coverage = JSON.parse(await readFile(path.join(outputDirectory, 'industrial-instrument-coverage-report.json'), 'utf8'))
    expect(coverage.find((entry) => entry.sourceCode.includes('RBA'))).toMatchObject({
      supportStatus: 'missing-verified-rules',
      instrumentType: 'enterprise-agreement',
    })
    const uploadCsv = await readFile(path.join(outputDirectory, 'timesheet-security-nsw.csv'), 'utf8')
    const replayWorkbook = XLSX.read(uploadCsv, { type: 'string' })
    const replayRows = XLSX.utils.sheet_to_json(replayWorkbook.Sheets[replayWorkbook.SheetNames[0]], {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    })
    expect(replayRows).toHaveLength(validation.parserShiftRows + 5)
    expect(uploadCsv).toContain('Source Components JSON')
    expect(uploadCsv).toContain('Level 4 Officer')
    expect(uploadCsv).toContain('MSS-')
    expect(uploadCsv).not.toContain('41001')
    expect(uploadCsv).not.toContain('"sourceRow"')
    expect(await readFile(path.join(outputDirectory, 'employee-agreement-security-nsw.txt'), 'utf8')).not.toContain('41001')
    expect(JSON.stringify(validation)).not.toContain('41001')
    expect(JSON.stringify(ledger)).toContain('41001')

    const pseudonyms = JSON.parse(await readFile(path.join(outputDirectory, 'pseudonym-map.private.json'), 'utf8'))
    expect(pseudonyms['41001']).toMatchObject({ publicEmployeeId: expect.stringMatching(/^MSS-/), pseudonym: expect.any(String) })
  }, 40000)
})
