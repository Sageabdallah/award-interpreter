import { parseTimesheetFileDirect } from '../timesheetParser.js'

self.onmessage = async ({ data }) => {
  try {
    const result = await parseTimesheetFileDirect(data.file)
    self.postMessage({ ok: true, result })
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Timesheet parsing failed.',
    })
  }
}
