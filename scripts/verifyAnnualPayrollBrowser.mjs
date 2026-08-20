import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.AXI_WEB_URL || 'http://127.0.0.1:4173'
const payrollPath = path.resolve(process.env.AXI_ANNUAL_PAYROLL || path.join(os.homedir(), 'Desktop/isoft_data/Nsw_Payroll 1.xlsx'))
const employeePath = path.resolve(process.env.AXI_EMPLOYEE_MASTER || path.join(os.homedir(), 'Desktop/isoft_data/Employee.xlsx'))
const liveDir = path.resolve(process.env.MSS_LIVE_DIR || 'data/live')
const outputDir = path.resolve(process.env.AXI_BROWSER_OUTPUT_DIR || 'test-results/annual-payroll-browser')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

await fs.mkdir(outputDir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1728, height: 1117 } })
const errors = []
const failedRequests = []
const httpErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`))
page.on('response', (response) => {
  if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() })
})

const normalizedBody = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ')
const layout = () => page.evaluate(() => ({
  viewport: document.documentElement.clientWidth,
  documentWidth: document.documentElement.scrollWidth,
  bodyWidth: document.body.scrollWidth,
}))

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const timeEntryNav = page.getByRole('button', { name: 'Time Entry', exact: true })
  await timeEntryNav.waitFor({ timeout: 60_000 })
  const backendWorkspaceRestored = await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((item) => item.textContent.trim() === 'Time Entry')
    return button && !button.disabled
  }, null, { timeout: 30_000 }).then(() => true).catch(() => false)

  let parseMs = 0
  if (backendWorkspaceRestored) {
    await timeEntryNav.click()
    await page.getByText(/Source payroll loaded successfully\./).waitFor({ timeout: 60_000 })
  } else {
    const dataNav = page.getByRole('button', { name: 'Data & Documents', exact: true })
    await dataNav.click()
    await page.getByRole('button', { name: 'Security (NSW)', exact: true }).click()
    const documents = page.locator('input[type=file]')
    await documents.nth(1).setInputFiles(path.join(liveDir, 'compliance-document-security-nsw.txt'))
    await documents.nth(2).setInputFiles(path.join(liveDir, 'employee-agreement-security-nsw.txt'))
    await page.getByRole('button', { name: 'Parse documents', exact: true }).click()
    await page.getByRole('button', { name: /Continue to timesheet/i }).waitFor({ timeout: 60_000 })
    await page.getByRole('button', { name: /Continue to timesheet/i }).click()

    const uploads = page.locator('input[type=file]')
    assert(await uploads.count() === 2, 'Expected source payroll and employee master upload inputs')
    await uploads.nth(1).setInputFiles(employeePath)
    await page.getByText('Reading employee master…', { exact: true }).waitFor({ state: 'hidden', timeout: 60_000 })

    const startedAt = Date.now()
    await uploads.nth(0).setInputFiles(payrollPath)
    await page.getByText(/Source payroll loaded successfully\./).waitFor({ timeout: 180_000 })
    parseMs = Date.now() - startedAt
  }
  const body = await normalizedBody()

  const checks = {
    rows: /683,141 source rows/.test(body),
    periods: /257,065 work periods/.test(body),
    employees: /1,?619 employees/.test(body),
    hours: /2,534,935\.27/.test(body),
    instruments: /10 pending · 1 verified instrument/.test(body),
    historicalWarningHidden: !/matched 1,343 of 1,619 payroll employees|remaining 276 historical IDs/.test(body),
    boundedEmployeePreview: await page.locator('.source-employee-row').count() === 12,
    noOldMismatch: !/1469 of 1619/.test(body),
    noDangerFlags: await page.locator('.danger-flag').count() === 0,
  }
  assert(Object.values(checks).every(Boolean), `Annual payroll UI checks failed: ${JSON.stringify(checks)}`)

  for (const label of ['Alerts', 'Fatigue Risk', 'Compliance Risk']) {
    const item = page.locator('.dsh-nav .dsh-item').filter({ hasText: label })
    assert(await item.locator('.dsh-badge').count() === 0, `${label} still shows a source-ledger finding badge`)
  }

  await page.screenshot({ path: path.join(outputDir, 'time-entry-desktop.png') })
  const desktopLayout = await layout()
  assert(desktopLayout.documentWidth <= desktopLayout.viewport + 1, 'Desktop document has horizontal overflow')

  const detailEmployeeReference = 'MSS-0AC7725C85'
  const employeeSearch = page.getByLabel('Search name, source EmployeeID or classification')
  await employeeSearch.fill(detailEmployeeReference)
  const detailToggle = page.getByRole('button', { name: `Open payroll detail for ${detailEmployeeReference}` })
  await detailToggle.waitFor({ timeout: 30_000 })
  await detailToggle.click()
  await page.getByText('How the Excel total is built', { exact: true }).waitFor({ timeout: 60_000 })
  const detailText = (await page.locator('.source-payroll-detail').innerText()).replace(/\s+/g, ' ')
  const payrollDetailChecks = {
    roundingLine: /Rounding Balances four-decimal payroll components to the recorded cent total \$0\.01/.test(detailText),
    recordedGross: /Recorded gross \$67,742\.74/.test(detailText),
    reconciled: /The protected ledger equals the Excel gross\./.test(detailText),
    zeroPayrollDifference: /Payroll difference \$0\.00/.test(detailText),
    noFalseMismatch: !/The detailed totals do not match Excel/.test(detailText),
  }
  assert(Object.values(payrollDetailChecks).every(Boolean), `Payroll detail checks failed: ${JSON.stringify(payrollDetailChecks)}`)

  await page.getByRole('button', { name: 'Show Excel rows', exact: true }).click()
  await page.locator('.source-row-check').waitFor({ timeout: 60_000 })
  const sourceRowText = (await page.locator('.source-row-ledger').innerText()).replace(/\s+/g, ' ')
  const sourceRowChecks = {
    rowsLoaded: await page.locator('.source-row-line').count() > 0,
    workbookNamed: /Nsw_Payroll 1\.xlsx/.test(sourceRowText),
    sumExplained: /SUM of \d+ Excel Amount cells = \$681\.2199.*\$681\.22 after cent rounding/.test(sourceRowText),
    weeklyGrossMatched: /weekly gross = \$681\.22/.test(sourceRowText),
    zeroDifference: /difference = \$0\.00/.test(sourceRowText),
    auditVerified: /verified audit chunk/i.test(sourceRowText),
    worksheetNamed: /Worksheet Nsw_Payroll/.test(sourceRowText),
  }
  assert(Object.values(sourceRowChecks).every(Boolean), `Source row checks failed: ${JSON.stringify(sourceRowChecks)}`)
  await page.locator('.source-row-toggle').first().click()
  await page.getByText('Verified source', { exact: true }).waitFor({ timeout: 10_000 })
  await page.screenshot({ path: path.join(outputDir, 'payroll-detail-rounding.png') })
  await page.getByRole('button', { name: `Close payroll detail for ${detailEmployeeReference}` }).click()
  await employeeSearch.fill('')

  const annualEmployeeReference = 'MSS-0A3D8DD2AA'
  await employeeSearch.fill(annualEmployeeReference)
  await page.getByRole('button', { name: `Open payroll detail for ${annualEmployeeReference}` }).click()
  await page.getByText('How the Excel total is built', { exact: true }).waitFor({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Show Excel rows for Ordinary' }).click()
  const annualLedger = page.locator('.annual-source-row-ledger')
  await annualLedger.locator('.source-row-check').waitFor({ timeout: 60_000 })
  const annualSourceText = (await annualLedger.innerText()).replace(/\s+/g, ' ')
  const annualSourceRowChecks = {
    rowsLoaded: await annualLedger.locator('.source-row-line').count() > 0,
    subtotalMatched: /Ordinary subtotal = \$21,677\.76/.test(annualSourceText),
    zeroDifference: /difference = \$0\.00/.test(annualSourceText),
    worksheetNamed: /Worksheet Nsw_Payroll/.test(annualSourceText),
    amountCellsShown: /[A-Z]+\d+/.test(annualSourceText),
  }
  assert(Object.values(annualSourceRowChecks).every(Boolean), `Annual source-row checks failed: ${JSON.stringify(annualSourceRowChecks)}`)
  await annualLedger.locator('.source-row-toggle').first().click()
  await annualLedger.getByText('Excel cells', { exact: true }).waitFor({ timeout: 10_000 })
  await page.screenshot({ path: path.join(outputDir, 'annual-category-source-rows.png') })
  await page.getByRole('button', { name: `Close payroll detail for ${annualEmployeeReference}` }).click()
  await employeeSearch.fill('')

  await page.getByRole('button', { name: /Review source payroll/i }).click()
  await page.getByText('1619 source employees loaded', { exact: true }).waitFor({ timeout: 60_000 })
  await page.waitForTimeout(600)
  const payRunChecks = {
    pendingInstruments: /Instruments pending\s+10.*1 verified/i.test(await normalizedBody()),
    boundedRows: await page.locator('.trow').count() === 25,
    sourceGrossRetained: /\$94,655,150\.46/.test(await normalizedBody()),
    evidenceActionEnabled: await page.getByRole('button', { name: /Review evidence gaps/i }).isEnabled(),
    noReleaseBlockedRows: await page.getByText('Release blocked', { exact: true }).count() === 0,
  }
  assert(Object.values(payRunChecks).every(Boolean), `Pay Run evidence checks failed: ${JSON.stringify(payRunChecks)}`)
  await page.screenshot({ path: path.join(outputDir, 'pay-run-desktop.png') })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(outputDir, 'pay-run-mobile.png') })
  const mobileLayout = await layout()
  assert(mobileLayout.documentWidth <= mobileLayout.viewport + 1, 'Mobile document has horizontal overflow')

  // A page reload simulates the next payroll update. The structured document
  // interpretation and privacy-minimised Employee.xlsx setup should both be
  // restored, leaving only the replacement payroll file to upload.
  await page.setViewportSize({ width: 1728, height: 1117 })
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
  await timeEntryNav.waitFor({ timeout: 30_000 })
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Time Entry')
    return button && !button.disabled
  }, null, { timeout: 30_000 })
  await timeEntryNav.click()
  await page.getByText('Employee.xlsx', { exact: true }).waitFor({ timeout: 30_000 })
  const reloadUploads = page.locator('input[type=file]')
  assert(await reloadUploads.count() === 2, 'Restored workspace did not open directly on the payroll inputs')
  await reloadUploads.nth(0).setInputFiles(payrollPath)
  await page.getByText(/Source payroll loaded successfully\./).waitFor({ timeout: 180_000 })
  const automaticSetupRestored = await page.locator('.source-record')
    .filter({ hasText: 'Employee master' })
    .filter({ hasText: 'Employee.xlsx · Protected backend' })
    .count() === 1
  assert(automaticSetupRestored, 'Retained Employee.xlsx setup did not auto-apply after reload')

  const optionalHealthErrors = httpErrors.filter(({ url }) => /\/api\/health(?:\?|$)/.test(url))
  const unexpectedHttpErrors = httpErrors.filter(({ url }) => !/\/api\/health(?:\?|$)/.test(url))
  const unexpectedConsoleErrors = errors.filter((error) => !/^Failed to load resource: the server responded with a status of 502/.test(error))
  const optionalHealthFailures = failedRequests.filter((request) => request.includes('/api/health'))
  const unexpectedFailedRequests = failedRequests.filter((request) => !request.includes('/api/health'))
  const result = { parseMs, checks, payRunChecks, payrollDetailChecks, sourceRowChecks, annualSourceRowChecks, automaticSetupRestored, desktopLayout, mobileLayout, optionalHealthErrors, optionalHealthFailures, errors: unexpectedConsoleErrors, failedRequests: unexpectedFailedRequests }
  assert(unexpectedHttpErrors.length === 0, `HTTP errors: ${JSON.stringify(unexpectedHttpErrors)}`)
  assert(unexpectedConsoleErrors.length === 0, `Browser errors: ${unexpectedConsoleErrors.join(' | ')}`)
  assert(unexpectedFailedRequests.length === 0, `Failed requests: ${unexpectedFailedRequests.join(' | ')}`)
  await fs.writeFile(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
