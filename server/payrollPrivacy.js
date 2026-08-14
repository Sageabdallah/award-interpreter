import { createHash } from 'node:crypto'

export function publicPayrollId(prefix, value) {
  return `${prefix}-${createHash('sha256').update(`axi-workspace/v1/${value}`).digest('hex').slice(0, 10).toUpperCase()}`
}
