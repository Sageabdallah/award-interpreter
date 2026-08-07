import { describe, expect, it } from 'vitest'
import { buildWorkPeriods, restEventsForShifts } from '../src/domain/workPeriods.js'

function shift(dateKey, start, finish, hours) {
  return { dateKey, start, finish, hours }
}

describe('attendance work periods', () => {
  it('merges touching classification segments while preserving their source rows', () => {
    const shifts = [
      shift('2024-12-16', '08:30', '09:00', 0.5),
      shift('2024-12-16', '09:00', '16:30', 7.5),
      shift('2024-12-16', '16:30', '17:30', 1),
    ]
    const periods = buildWorkPeriods(shifts)

    expect(periods).toHaveLength(1)
    expect(periods[0]).toMatchObject({ spanHours: 9, paidHours: 9, shifts })
    expect(restEventsForShifts(shifts, 8)).toEqual([])
  })

  it('keeps separate work periods and handles overnight finishes', () => {
    const shifts = [
      shift('2026-08-03', '20:00', '02:00', 6),
      shift('2026-08-04', '08:00', '12:00', 4),
    ]
    const events = restEventsForShifts(shifts, 8)

    expect(buildWorkPeriods(shifts)).toHaveLength(2)
    expect(events).toHaveLength(1)
    expect(events[0].gapHours).toBe(6)
  })
})
