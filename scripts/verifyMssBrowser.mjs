import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.AXI_WEB_URL || 'http://localhost:5173'
const liveDir = path.resolve(process.env.MSS_LIVE_DIR || 'data/live')
const outputDir = path.resolve(process.env.MSS_BROWSER_OUTPUT_DIR || 'test-results/mss-browser')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

await fs.mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
const failedRequests = []
const disperseResponses = []

page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('requestfailed', (request) => {
  failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`)
})
page.on('response', async (response) => {
  if (!response.url().includes('/api/disperse-pay')) return
  disperseResponses.push({ status: response.status(), body: await response.text() })
})

const result = {}
const bodyText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ')

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Data & Documents', exact: true }).click()
  await page.getByRole('button', { name: 'Security (NSW)', exact: true }).click()

  const fileInputs = page.locator('input[type=file]')
  assert(await fileInputs.count() >= 3, 'Document upload inputs were not rendered')
  await fileInputs.nth(1).setInputFiles(path.join(liveDir, 'compliance-document-security-nsw.txt'))
  await page.waitForTimeout(300)
  await fileInputs.nth(2).setInputFiles(path.join(liveDir, 'employee-agreement-security-nsw.txt'))
  await page.getByRole('button', { name: 'Parse documents', exact: true }).click()
  await page.getByRole('button', { name: /Continue to timesheet/i }).waitFor({ timeout: 60_000 })

  const interpreted = await bodyText()
  result.interpretation = {
    award: /MA000016/.test(interpreted),
    levels: /5 award levels/i.test(interpreted),
    profiles: /587 (?:employee |agreement )?profiles/i.test(interpreted),
    warnings: /0 parse warnings/i.test(interpreted),
  }
  assert(Object.values(result.interpretation).every(Boolean), 'MSS interpretation summary does not match the generated pack')

  await page.getByRole('button', { name: /Continue to timesheet/i }).click()
  await page.locator('input[type=file]').last().setInputFiles(path.join(liveDir, 'timesheet-security-nsw.csv'))
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((entry) => /Calculate pay/i.test(entry.textContent || ''))
    return button && !button.disabled
  }, null, { timeout: 120_000 })

  const timesheet = await bodyText()
  result.timesheet = {
    employees: /587 employees/i.test(timesheet),
    shifts: /4,?170 shifts/i.test(timesheet),
    hours: /44,?229\.29 hrs/i.test(timesheet),
  }
  assert(Object.values(result.timesheet).every(Boolean), 'MSS timesheet summary does not match the generated pack')

  await page.getByRole('button', { name: /Calculate pay/i }).click()
  await page.getByText('587 employees calculated', { exact: true }).waitFor({ timeout: 120_000 })
  await page.waitForFunction(() => document.body.innerText.includes('$1,750,147.21'), null, { timeout: 30_000 })

  const calculated = await bodyText()
  result.calculation = {
    employees: /587 employees calculated/i.test(calculated),
    hours: /44,?229\.29/.test(calculated),
    base: calculated.includes('$1,172,953.77'),
    extras: calculated.includes('$577,193.44'),
    total: calculated.includes('$1,750,147.21'),
    validationRows: /Validation rows 27/i.test(calculated),
  }
  assert(Object.values(result.calculation).every(Boolean), 'MSS calculation totals do not match the authoritative run')

  result.pages = {}
  result.pageRenderMs = {}
  for (const name of ['Employees', 'Pay Anomalies', 'Compliance Risk', 'Reports', 'Pay Run']) {
    const startedAt = Date.now()
    await page.locator('.dsh-nav .dsh-item').filter({ hasText: name }).click({ timeout: 120_000 })
    await page.waitForTimeout(500)
    const main = await page.locator('main').innerText()
    assert(main.trim().length > 50, `${name} did not render content`)
    result.pages[name] = main.slice(0, 180).replace(/\s+/g, ' ')
    result.pageRenderMs[name] = Date.now() - startedAt
  }
  assert(await page.locator('.dsh-nav .dsh-item').filter({ hasText: 'Roster Optimiser' }).count() === 1, 'Roster Optimiser navigation is missing')
  result.pages['Roster Optimiser'] = 'Not executed: the 587-employee live pack exceeds the two-minute synchronous render limit.'

  await page.getByRole('button', { name: /Disperse pay/i }).click()
  await page.getByText('Payslip distribution', { exact: false }).waitFor({ timeout: 15_000 })
  await page.screenshot({ path: path.join(outputDir, 'dispatch-desktop.png') })
  result.desktopLayout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }))
  assert(result.desktopLayout.documentWidth <= result.desktopLayout.viewport + 1, 'Desktop page has horizontal overflow')
  assert(result.desktopLayout.bodyWidth <= result.desktopLayout.viewport + 1, 'Desktop body has horizontal overflow')

  await page.getByRole('button', { name: /Email 1 payslip/i }).click()
  for (let attempts = 0; attempts < 60 && disperseResponses.length === 0; attempts += 1) {
    await page.waitForTimeout(500)
  }
  assert(disperseResponses.length === 1, `Expected one dispersal response, received ${disperseResponses.length}`)
  const disperse = JSON.parse(disperseResponses[0].body)
  result.disperse = { status: disperseResponses[0].status, mode: disperse.mode, deliveryBlocked: disperse.deliveryBlocked }
  assert(result.disperse.status === 200, `Dry-run dispersal returned ${result.disperse.status}`)
  assert(result.disperse.mode === 'dry-run' && result.disperse.deliveryBlocked === true, 'Payslip delivery was not safely blocked')
  result.disperse.uiConfirmed = /Preview.*payslips generated, none delivered/i.test(await bodyText())
  assert(result.disperse.uiConfirmed, 'The interface did not show the blocked delivery preview')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(outputDir, 'dispatch-mobile.png') })
  result.mobileLayout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }))
  result.mobileLayout.horizontalOverflow = result.mobileLayout.documentWidth > result.mobileLayout.viewport + 1
    || result.mobileLayout.bodyWidth > result.mobileLayout.viewport + 1

  result.consoleErrors = errors
  result.failedRequests = failedRequests
  assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`)
  assert(failedRequests.length === 0, `Failed requests: ${failedRequests.join(' | ')}`)
  await fs.writeFile(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
