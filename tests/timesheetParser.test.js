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

  it('preserves additive pay facts needed by the security calculator', () => {
    const rows = [
      [
        'Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day', 'Start', 'Finish',
        'Break Mins', 'Break Start', 'Hours', 'Location', 'Notes', 'Public Holiday Date',
        'First Aid Nominated', 'Firearm Required', 'Broken Shift', 'Supervised Employees',
        'Relieving Officer', 'Aviation Security', 'Motor Vehicle Km', 'Motorcycle Km',
        'Meal Allowance Eligible', 'Higher Duties Level', 'Callback Type',
        'Higher Duties Hours', 'Higher Duties Start', 'Short Rest Directed',
        'Minimum Engagement Applies', 'Minimum Engagement Top Up Hours', 'Broken Shift Top Up Hours',
        'Shift ID', 'Source Award Code', 'Source Classification', 'Source Classification Raw',
        'Source Shift Definition', 'Break Recorded', 'Unallocated Span Minutes', 'Source Import Warnings', 'Source Components JSON',
        'Source Ordinary Base Rate', 'Source Ordinary Hours', 'Source Overtime Hours', 'Source Ordinary Amount',
        'Source Overtime Amount', 'Source Penalty Amount', 'Source Allowance Amount',
      ],
      [
        'MSS-1', 'Demo Officer', 'Security Officer', 'Full-time', '07/08/2026', 'Friday',
        '22:00', '02:30', '30', '00:30', '4', 'Sydney CBD', '', '08/08/2026',
        'yes', 'no', 'false', '7', '1', 'true', '12.5', '0', 'yes',
        'Security Officer Level 4', 'other', '2', '19:00', 'no', 'yes', '1.5', '2',
        '9001', '(NSW) Security Services Industry Award', 'Security Officer Level 4', 'Level 4 Officer',
        'Night Shift', 'no', '0', 'first warning | second warning', '[{"EarningCode":"ORDINARY","Amount":60}]',
        '30', '2', '2', '60', '100', '20', '7.68',
      ],
    ]

    const shift = parseTimesheetRows(rows).shifts[0]
    expect(shift).toMatchObject({
      breakStart: '00:30',
      publicHolidayDate: '2026-08-08',
      firstAidNominated: true,
      firearmRequired: false,
      brokenShift: false,
      supervisedEmployees: 7,
      relievingOfficer: true,
      aviationSecurity: true,
      motorVehicleKm: 12.5,
      motorcycleKm: 0,
      mealAllowanceEligible: true,
      higherDutiesLevel: 'Security Officer Level 4',
      callbackType: 'other',
      higherDutiesHours: 2,
      higherDutiesStart: '19:00',
      shortRestDirected: false,
      minimumEngagementApplies: true,
      minimumEngagementTopUpHours: 1.5,
      brokenShiftTopUpHours: 2,
      sourceShiftId: '9001',
      sourceAwardCode: '(NSW) Security Services Industry Award',
      sourceClassification: 'Security Officer Level 4',
      sourceClassificationRaw: 'Level 4 Officer',
      sourceShiftDefinition: 'Night Shift',
      breakRecorded: false,
      unallocatedSpanMinutes: 0,
      sourceImportWarnings: ['first warning', 'second warning'],
      sourceComponents: [{ EarningCode: 'ORDINARY', Amount: 60 }],
      sourceOrdinaryBaseRate: 30,
      sourceOrdinaryHours: 2,
      sourceOvertimeHours: 2,
      sourceOrdinaryAmount: 60,
      sourceOvertimeAmount: 100,
      sourcePenaltyAmount: 20,
      sourceAllowanceAmount: 7.68,
    })
  })
})
