import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.AXI_WEB_URL || 'https://award-interpreter.vercel.app'
const outputDir = path.resolve(process.env.AXI_BROWSER_OUTPUT_DIR || 'test-results/backend-workspace-browser')
const workspaceFixture = process.env.AXI_WORKSPACE_FIXTURE

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

await fs.mkdir(outputDir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1728, height: 1117 } })
const page = await context.newPage()
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

if (workspaceFixture) {
  const fixture = await fs.readFile(path.resolve(workspaceFixture), 'utf8')
  await page.route('**/api/workspaces/mss/latest', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: fixture,
  }))
  await page.route('**/api/health', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, aiAvailable: false }),
  }))
}

try {
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/workspaces/mss/latest'), { timeout: 180_000 })
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const response = await responsePromise
  assert(response.status() === 200, `Backend workspace returned HTTP ${response.status()}`)
  const payload = await response.json()
  const source = payload?.workspace?.timesheetData
  assert(source?.backendLoaded === true, 'Workspace was not marked as backend loaded')
  assert(source?.employees?.length === 1619, `Expected 1,619 employees, received ${source?.employees?.length || 0}`)
  assert(source?.sourceSummary?.componentRows === 683141, 'Source component total changed')
  assert(source?.sourceSummary?.workPeriods === 257065, 'Source work-period total changed')
  assert(source?.employeeMaster?.matchedEmployees === 1343, 'Employee master matched count changed')
  assert(source?.employeeMaster?.unmatchedEmployees === 276, 'Employee master unmatched count changed')
  assert(source.employees.every((employee) => /^MSS-[A-F0-9]{10}$/.test(employee.employeeId)), 'A raw employee ID reached the browser workspace')
  const verifiedScope = source.workspaceScopes?.find((scope) => scope.id === 'verified-security-cohort')
  assert(source.defaultWorkspaceScopeId === 'verified-security-cohort', 'Verified cohort is not the default workspace scope')
  assert(verifiedScope?.employeeIds?.length === 1037, `Expected 1,037 verified employees, received ${verifiedScope?.employeeIds?.length || 0}`)
  assert(verifiedScope?.reconciliationGate?.status === 'verified', 'Verified cohort did not pass its backend gate')
  assert(verifiedScope.reconciliationGate.checks.every((check) => check.passed), 'A verified cohort backend check failed')

  const payRun = page.getByRole('button', { name: 'Pay Run', exact: true })
  await payRun.waitFor({ timeout: 60_000 })
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Pay Run')
    return button && !button.disabled
  }, null, { timeout: 60_000 })
  await payRun.click()
  await page.getByText('1037 Security employees reconciled', { exact: true }).waitFor({ timeout: 60_000 })
  const verifiedBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  const verifiedChecks = {
    gross: verifiedBody.includes('$60,941,866.09'),
    rows: /489,686/.test(verifiedBody),
    instrument: /Instrument verified\s+1\s+MA000016 source mapping/i.test(verifiedBody),
    matches: /1,037 employee records matched/i.test(verifiedBody),
    backendGate: /Backend checks passed for employee records/i.test(verifiedBody),
    noEmployeeGap: !/employee IDs need master-data records/i.test(verifiedBody),
    noEvidenceWarning: !/No entitlement has been recalculated/i.test(verifiedBody),
  }
  assert(Object.values(verifiedChecks).every(Boolean), `Verified cohort UI checks failed: ${JSON.stringify(verifiedChecks)}`)

  await page.screenshot({ path: path.join(outputDir, 'verified-cohort-desktop.png'), fullPage: true })

  await page.getByRole('tab', { name: 'Full annual audit' }).click()
  await page.getByText('1619 source employees loaded', { exact: true }).waitFor({ timeout: 60_000 })
  const auditBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  const auditChecks = {
    gross: auditBody.includes('$94,655,150.46'),
    rows: /683,141/.test(auditBody),
    instruments: /Instruments pending\s+10.*1 verified/i.test(auditBody),
    matches: /1,343 employee records matched/i.test(auditBody),
    genuineGaps: /276 employee IDs need master-data records/i.test(auditBody),
    noBlanketFailure: !/1,619 employee IDs need master-data records/i.test(auditBody),
  }
  assert(Object.values(auditChecks).every(Boolean), `Full annual audit UI checks failed: ${JSON.stringify(auditChecks)}`)

  await page.screenshot({ path: path.join(outputDir, 'full-audit-desktop.png'), fullPage: true })
  await page.getByRole('tab', { name: 'Verified cohort' }).click()
  await page.getByText('1037 Security employees reconciled', { exact: true }).waitFor({ timeout: 60_000 })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileChecks = {
    scopeControlVisible: await page.getByRole('tab', { name: 'Verified cohort' }).isVisible(),
    titleVisible: await page.getByText('1037 Security employees reconciled', { exact: true }).isVisible(),
    noPageOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  }
  assert(Object.values(mobileChecks).every(Boolean), `Mobile workspace UI checks failed: ${JSON.stringify(mobileChecks)}`)
  await page.screenshot({ path: path.join(outputDir, 'verified-cohort-mobile.png'), fullPage: false })
  const result = {
    auditId: payload.workspace.audit.id,
    verifiedChecks,
    auditChecks,
    mobileChecks,
    employees: source.employees.length,
    matchedEmployees: source.employeeMaster.matchedEmployees,
    unmatchedEmployees: source.employeeMaster.unmatchedEmployees,
    httpErrors,
    errors,
    failedRequests,
  }
  assert(httpErrors.length === 0, `HTTP errors: ${JSON.stringify(httpErrors)}`)
  assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`)
  assert(failedRequests.length === 0, `Failed requests: ${failedRequests.join(' | ')}`)
  await fs.writeFile(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
