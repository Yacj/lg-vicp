import { describe, expect, it } from 'vitest'
import { pickTokenFallbacks } from './theme'
import { createChartTokens } from './tokens'

describe('chart theme fallbacks', () => {
  it('keeps a stable token structure for both themes', () => {
    const light = pickTokenFallbacks('light')
    const dark = pickTokenFallbacks('dark')

    for (const tokens of [light, dark]) {
      expect(tokens.textPrimary).toBeTruthy()
      expect(tokens.textSecondary).toBeTruthy()
      expect(tokens.tooltipBg).toBeTruthy()
      expect(tokens.palette.length).toBeGreaterThanOrEqual(4)
      expect(tokens.brand).toBeTruthy()
    }
  })

  it('uses dark-friendly structural colors in dark mode while keeping semantic colors', () => {
    const light = pickTokenFallbacks('light')
    const dark = pickTokenFallbacks('dark')

    expect(dark.textPrimary).not.toBe(light.textPrimary)
    expect(dark.axisLine).not.toBe(light.axisLine)
    expect(dark.brand).toBe(light.brand)
    expect(dark.success).toBe(light.success)
  })

  it('builds tokens with the given theme and falls back to theme-aware values', () => {
    const tokens = createChartTokens('dark')

    expect(tokens.theme).toBe('dark')
    expect(tokens.textPrimary).toBeTruthy()
    expect(tokens.palette.length).toBeGreaterThanOrEqual(4)
  })
})