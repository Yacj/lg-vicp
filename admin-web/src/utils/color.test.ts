import { describe, expect, it } from 'vitest'
import {
  generateBrandColorScale,
  hexToHsl,
  hslToHex,
  isValidHexColor,
  normalizeHexColor,
} from './color'

describe('isValidHexColor', () => {
  it('accepts 3-digit and 6-digit hex colors', () => {
    expect(isValidHexColor('#0052d9')).toBe(true)
    expect(isValidHexColor('#0b6cc4')).toBe(true)
    expect(isValidHexColor('#FFF')).toBe(true)
    expect(isValidHexColor('#ABCdef')).toBe(true)
  })

  it('rejects malformed color strings', () => {
    expect(isValidHexColor('')).toBe(false)
    expect(isValidHexColor('0052d9')).toBe(false)
    expect(isValidHexColor('#0052')).toBe(false)
    expect(isValidHexColor('#0052dg')).toBe(false)
    expect(isValidHexColor('#0052d9ff')).toBe(false)
    expect(isValidHexColor('blue')).toBe(false)
  })
})

describe('normalizeHexColor', () => {
  it('expands short hex colors to 6 digits', () => {
    expect(normalizeHexColor('#fff')).toBe('#ffffff')
    expect(normalizeHexColor('#aBc')).toBe('#aabbcc')
  })

  it('lowercases and keeps 6-digit hex colors', () => {
    expect(normalizeHexColor('#0052D9')).toBe('#0052d9')
    expect(normalizeHexColor('#0B6CC4')).toBe('#0b6cc4')
  })
})

describe('hex and hsl conversion', () => {
  it('round-trips a color through hsl', () => {
    expect(hslToHex(hexToHsl('#0052d9'))).toBe('#0052d9')
    expect(hslToHex(hexToHsl('#0b8fa8'))).toBe('#0b8fa8')
    expect(hslToHex(hexToHsl('#ffffff'))).toBe('#ffffff')
    expect(hslToHex(hexToHsl('#000000'))).toBe('#000000')
  })

  it('converts known colors to expected hsl', () => {
    const source = hexToHsl('#0052d9')
    expect(source.h).toBeCloseTo(217.33, 2)
    expect(source.s).toBe(1)
    expect(source.l).toBeCloseTo(0.4255, 3)
    expect(hexToHsl('#ffffff')).toMatchObject({ h: 0, s: 0, l: 1 })
  })
})

describe('generateBrandColorScale', () => {
  it('places the primary color at level 7 in light mode', () => {
    const scale = generateBrandColorScale('#0052d9')
    expect(scale.light[6]).toBe('#0052d9')
    expect(scale.light).toHaveLength(10)
  })

  it('spans from darker than the primary to lighter than it in dark mode', () => {
    const scale = generateBrandColorScale('#0052d9')
    expect(scale.dark).toHaveLength(10)
    const baseLightness = hexToHsl('#0052d9').l
    expect(hexToHsl(scale.dark[0]).l).toBeLessThan(baseLightness)
    expect(hexToHsl(scale.dark[9]).l).toBeGreaterThan(baseLightness)
  })

  it('produces monotonically lightening light and dark scales', () => {
    for (const preset of ['#0052d9', '#0b6cc4', '#5b50c8', '#0b8fa8', '#07885d', '#7a3fc5']) {
      const scale = generateBrandColorScale(preset)
      const lightLightness = scale.light.map((color) => hexToHsl(color).l)
      const darkLightness = scale.dark.map((color) => hexToHsl(color).l)

      for (let index = 0; index < lightLightness.length - 1; index += 1) {
        expect(lightLightness[index]).toBeGreaterThan(lightLightness[index + 1])
      }
      for (let index = 0; index < darkLightness.length - 1; index += 1) {
        expect(darkLightness[index]).toBeLessThan(darkLightness[index + 1])
      }
    }
  })

  it('emits valid 6-digit hex colors and keeps the hue stable', () => {
    const scale = generateBrandColorScale('#07885d')
    for (const color of [...scale.light, ...scale.dark]) {
      expect(isValidHexColor(color)).toBe(true)
      expect(normalizeHexColor(color)).toBe(color)
    }
    const baseHue = hexToHsl('#07885d').h
    for (const color of [...scale.light, ...scale.dark]) {
      const hueDelta = Math.abs(hexToHsl(color).h - baseHue)
      // 8bit RGB 量化会引入约 ±2° 的色相漂移
      expect(Math.min(hueDelta, 360 - hueDelta)).toBeLessThan(3)
    }
  })

  it('approximates the shipped TDesign brand scales', () => {
    const scale = generateBrandColorScale('#0052d9')
    expect(hexToHsl(scale.light[0]).l).toBeGreaterThan(0.95)
    expect(hexToHsl(scale.light[9]).l).toBeLessThan(0.2)
    expect(hexToHsl(scale.dark[0]).l).toBeLessThan(0.25)
    expect(hexToHsl(scale.dark[9]).l).toBeGreaterThan(0.7)
  })

  it('normalizes the primary color form in the scale', () => {
    const scale = generateBrandColorScale('#0052D9')
    expect(scale.light[6]).toBe('#0052d9')
  })

  it('rejects invalid primary colors', () => {
    expect(() => generateBrandColorScale('not-a-color')).toThrow(RangeError)
  })

  it('tolerates extreme colors without clamping artifacts', () => {
    const white = generateBrandColorScale('#ffffff')
    const black = generateBrandColorScale('#000000')
    for (const color of [...white.light, ...white.dark, ...black.light, ...black.dark]) {
      expect(isValidHexColor(color)).toBe(true)
    }
  })
})