import { describe, expect, it } from 'vitest'
import { buildSourcePayBreakdown } from '../src/domain/sourcePayBreakdown.js'

describe('source pay breakdown', () => {
  it('shows a transparent cent adjustment when displayed categories round below source gross', () => {
    const result = buildSourcePayBreakdown({
      ordinary: 42614.63,
      overtime: 11739.32,
      penalties: 4362.66,
      allowances: 3993.18,
      leave: 5032.94,
    }, 67742.74)

    expect(result.items.at(-1)).toEqual({
      key: 'rounding',
      label: 'Rounding',
      description: 'Balances four-decimal payroll components to the recorded cent total',
      amount: 0.01,
    })
    expect(result.total).toBe(67742.74)
    expect(result.reconciled).toBe(true)
  })

  it('does not add a rounding line when displayed categories already reconcile', () => {
    const result = buildSourcePayBreakdown({ ordinary: 329.04, penalties: 12.1, leave: 334.56 }, 675.7)
    expect(result.items.map((item) => item.key)).toEqual(['ordinary', 'penalties', 'leave'])
    expect(result.roundingAdjustment).toBe(0)
    expect(result.reconciled).toBe(true)
  })

  it('does not disguise a material category mismatch as rounding', () => {
    const result = buildSourcePayBreakdown({ ordinary: 100 }, 125)
    expect(result.items.map((item) => item.key)).toEqual(['ordinary'])
    expect(result.total).toBe(100)
    expect(result.reconciled).toBe(false)
  })
})
