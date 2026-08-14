import { describe, expect, it } from 'vitest'
import { publicPayrollId } from '../server/payrollPrivacy.js'
import { publicPayrollReference } from '../src/domain/payrollPrivacy.js'

describe('payroll privacy references', () => {
  it('resolves a source EmployeeID to the same protected reference in the browser and backend', async () => {
    expect(await publicPayrollReference(' 30458 ')).toBe(publicPayrollId('MSS', '30458'))
  })

  it('does not create a reference for an empty lookup', async () => {
    expect(await publicPayrollReference('')).toBe('')
  })
})
