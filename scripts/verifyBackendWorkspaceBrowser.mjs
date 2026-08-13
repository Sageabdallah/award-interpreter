import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.AXI_WEB_URL || 'https://award-interpreter.vercel.app'
const outputDir = path.resolve(process.env.AXI_BROWSER_OUTPUT_DIR || 'test-results/backend-workspace-browser')

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

  const payRun = page.getByRole('button', { name: 'Pay Run', exact: true })
  await payRun.waitFor({ timeout: 60_000 })
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Pay Run')
    return button && !button.disabled
  }, null, { timeout: 60_000 })
  await payRun.click()
  await page.getByText('1619 source employees loaded', { exact: true }).waitFor({ timeout: 60_000 })
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  const checks = {
    gross: body.includes('$94,655,150.46'),
    rows: /683,141/.test(body),
    instruments: /Instruments pending\s+10.*1 verified/i.test(body),
    matches: /1,343 employee records auto-matched/i.test(body),
    genuineGaps: /276 employee IDs need master-data records/i.test(body),
    noBlanketFailure: !/1,619 employee IDs need master-data records/i.test(body),
  }
  assert(Object.values(checks).every(Boolean), `Backend workspace UI checks failed: ${JSON.stringify(checks)}`)

  await page.screenshot({ path: path.join(outputDir, 'pay-run-desktop.png'), fullPage: true })
  const result = {
    auditId: payload.workspace.audit.id,
    checks,
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
