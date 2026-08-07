import { describe, expect, it } from 'vitest'
import { minutesOfDay, segmentShift, segmentShifts } from '../src/domain/payEngine/segments.js'

function shift(overrides = {}) {
  return {
    date: '07/08/2026',
    dateKey: '2026-08-07',
    day: 'Friday',
    start: '22:00',
    finish: '02:00',
    breakMinutes: 0,
    hours: 4,
    notes: '',
    ...overrides,
  }
}

describe('pay time segmentation', () => {
  it('validates clock values including 24:00', () => {
    expect(minutesOfDay('00:00')).toBe(0)
    expect(minutesOfDay('24:00')).toBe(1440)
    expect(minutesOfDay('24:01')).toBeNull()
    expect(minutesOfDay('12:60')).toBeNull()
  })

  it('splits a cross-midnight shift onto the correct calendar days', () => {
    const result = segmentShift(shift())
    expect(result.status).toBe('resolved')
    expect(result.segments.map(({ dateKey, day, start, finish, hours, period }) => ({ dateKey, day, start, finish, hours, period }))).toEqual([
      { dateKey: '2026-08-07', day: 'Friday', start: '22:00', finish: '24:00', hours: 2, period: 'night' },
      { dateKey: '2026-08-08', day: 'Saturday', start: '00:00', finish: '02:00', hours: 2, period: 'night' },
    ])
  })

  it('splits at both weekday night boundaries', () => {
    const result = segmentShift(shift({
      date: '03/08/2026',
      dateKey: '2026-08-03',
      day: 'Monday',
      start: '05:00',
      finish: '19:00',
      hours: 14,
    }))
    expect(result.segments.map(({ start, finish, hours, period }) => ({ start, finish, hours, period }))).toEqual([
      { start: '05:00', finish: '06:00', hours: 1, period: 'night' },
      { start: '06:00', finish: '18:00', hours: 12, period: 'day' },
      { start: '18:00', finish: '19:00', hours: 1, period: 'night' },
    ])
  })

  it('subtracts a positioned break from only the affected segment', () => {
    const result = segmentShift(shift({
      date: '03/08/2026',
      dateKey: '2026-08-03',
      day: 'Monday',
      start: '14:00',
      finish: '22:30',
      breakMinutes: 30,
      breakStart: '17:30',
      hours: 8,
    }))
    expect(result.status).toBe('resolved')
    expect(result.segments.map(({ start, finish, hours }) => ({ start, finish, hours }))).toEqual([
      { start: '14:00', finish: '17:30', hours: 3.5 },
      { start: '18:00', finish: '22:30', hours: 4.5 },
    ])
  })

  it('fails closed when an unpositioned break could change the rate', () => {
    const result = segmentShift(shift({
      date: '03/08/2026',
      dateKey: '2026-08-03',
      day: 'Monday',
      start: '14:00',
      finish: '22:30',
      breakMinutes: 30,
      hours: 8,
    }))
    expect(result.status).toBe('unresolved')
    expect(result.issues).toContain('Break start is required when an unpaid break could cross differently rated time segments.')
  })

  it('marks only the nominated calendar date as a public holiday across midnight', () => {
    const result = segmentShift(shift({ publicHolidayDate: '2026-08-08' }))
    expect(result.segments.map((segment) => segment.publicHoliday)).toEqual([false, true])
  })

  it('applies a public holiday only after midnight for a Christmas Eve shift', () => {
    const result = segmentShift(shift({
      date: '24/12/2024',
      dateKey: '2024-12-24',
      day: 'Tuesday',
      start: '18:00',
      finish: '06:00',
      hours: 12,
      publicHolidayDates: ['2024-12-25'],
    }))

    expect(result.status).toBe('resolved')
    expect(result.segments.map(({ dateKey, start, finish, publicHoliday }) => ({ dateKey, start, finish, publicHoliday }))).toEqual([
      { dateKey: '2024-12-24', start: '18:00', finish: '24:00', publicHoliday: false },
      { dateKey: '2024-12-25', start: '00:00', finish: '06:00', publicHoliday: true },
    ])
  })

  it('reports invalid and inconsistent shift facts', () => {
    const results = segmentShifts([
      shift({ start: '', finish: '' }),
      shift({ start: '22:00', finish: '23:00', hours: 2 }),
    ])
    expect(results.status).toBe('unresolved')
    expect(results.issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/Valid start and finish/),
      expect.stringMatching(/Stated paid hours exceed/),
    ]))
  })
})
