import { describe, expect, it } from 'vitest'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'

describe('parseTimesheetRows', () => {
  it('parses the sample-style timesheet header and shift rows', () => {
    const rows = [
      ['Pay Period', 'Mon 4 May 2026 - Sun 17 May 2026'],
      ['Business', 'The Wharf Tavern Pty Ltd'],
      [],
      ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day', 'Start', 'Finish', 'Break (mins)', 'Hours', 'Location', 'Notes'],
      ['EMP-001', 'Sarah Chen', 'Senior Bartender', 'Permanent FT', '05/05/2026', 'Tue', '16:00', '00:00', '30', '7.5', 'The Wharf Tavern', ''],
      ['EMP-001', 'Sarah Chen', 'Senior Bartender', 'Permanent FT', '09/05/2026', 'Sat', '18:00', '02:00', '30', '7.5', 'The Wharf Tavern', ''],
    ]

    const parsed = parseTimesheetRows(rows, 'sample-timesheet.csv')
    expect(parsed.meta.business).toBe('The Wharf Tavern Pty Ltd')
    expect(parsed.employees).toHaveLength(1)
    expect(parsed.employees[0].totalHours).toBe(15)
  })
})
