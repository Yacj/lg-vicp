import { describe, expect, it } from 'vitest'
import { getDaysInMonth, getLastDayOfMonth } from './day'

describe('day utils', () => {
  it('gets days in month with 1-based month', () => {
    expect(getDaysInMonth({ year: 2024, month: 2 })).toBe(29)
    expect(getDaysInMonth({ year: 2025, month: 2 })).toBe(28)
  })

  it('gets last day with 0-based month', () => {
    expect(getLastDayOfMonth({ year: 2024, month: 1 }).getDate()).toBe(29)
    expect(getLastDayOfMonth({ year: 2025, month: 1 }).getDate()).toBe(28)
  })
})
