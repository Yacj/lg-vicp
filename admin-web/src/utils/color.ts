/**
 * 品牌色阶工具：以单一主色生成 TDesign 风格 10 级色阶。
 *
 * 亮度变换因子由现有 TDesign 色板（vicp-blue 等预设）拟合而来：
 * - light：主色位于第 7 级，前 6 级逐级提亮，后 3 级逐级压暗
 * - dark：主色位于第 8 级，前 7 级从深到浅逼近主色，后 2 级继续提亮
 * 色相与饱和度保持不变，仅调整明度，保证任意主色都能得到协调的色阶。
 */

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** light 模式主色之前 6 级的提亮因子：l' = l + (1 - l) * k */
const LIGHT_LIFT_FACTORS = [0.957, 0.873, 0.748, 0.617, 0.461, 0.278] as const
/** light 模式主色之后 3 级的压暗因子：l' = l * k */
const LIGHT_DROP_FACTORS = [0.79, 0.565, 0.4] as const
/** dark 模式 10 级的明度因子：l' = l * k */
const DARK_LIGHTNESS_FACTORS = [0.49, 0.565, 0.635, 0.705, 0.775, 0.895, 1.15, 1.375, 1.62, 1.835] as const

interface HslColor {
  h: number
  s: number
  l: number
}

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value)
}

/** 将 3 位或 6 位 hex 统一为小写 6 位形式，非法输入原样返回 */
export function normalizeHexColor(value: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value)
  if (short) {
    return `#${short.slice(1).map((channel) => channel + channel).join('')}`.toLowerCase()
  }
  return value.toLowerCase()
}

export function hexToHsl(hex: string): HslColor {
  const normalized = normalizeHexColor(hex)
  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255

  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  const lightness = (max + min) / 2

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness }
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  let hue: number
  if (max === red) {
    hue = 60 * (((green - blue) / delta) % 6)
  }
  else if (max === green) {
    hue = 60 * ((blue - red) / delta + 2)
  }
  else {
    hue = 60 * ((red - green) / delta + 4)
  }

  return { h: (hue + 360) % 360, s: saturation, l: lightness }
}

export function hslToHex({ h, s, l }: HslColor): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const hueSegment = (h % 360) / 60
  const secondary = chroma * (1 - Math.abs((hueSegment % 2) - 1))
  let red = 0
  let green = 0
  let blue = 0

  if (hueSegment < 1) {
    [red, green, blue] = [chroma, secondary, 0]
  }
  else if (hueSegment < 2) {
    [red, green, blue] = [secondary, chroma, 0]
  }
  else if (hueSegment < 3) {
    [red, green, blue] = [0, chroma, secondary]
  }
  else if (hueSegment < 4) {
    [red, green, blue] = [0, secondary, chroma]
  }
  else if (hueSegment < 5) {
    [red, green, blue] = [secondary, 0, chroma]
  }
  else {
    [red, green, blue] = [chroma, 0, secondary]
  }

  const offset = l - chroma / 2
  const toChannel = (channel: number) => Math.round((channel + offset) * 255)
  return `#${[red, green, blue].map((channel) => toChannel(channel).toString(16).padStart(2, '0')).join('')}`
}

function withLightness({ h, s }: HslColor, lightness: number): string {
  return hslToHex({ h, s, l: Math.min(1, Math.max(0, lightness)) })
}

export interface BrandColorScale {
  /** 浅色模式 10 级色阶，主色位于第 7 级 */
  light: readonly string[]
  /** 深色模式 10 级色阶，主色位于第 8 级 */
  dark: readonly string[]
}

export function generateBrandColorScale(primaryColor: string): BrandColorScale {
  if (!isValidHexColor(primaryColor)) {
    throw new RangeError(`非法主题色: ${primaryColor}`)
  }
  const source = hexToHsl(primaryColor)
  const base = normalizeHexColor(primaryColor)

  return {
    light: [
      ...LIGHT_LIFT_FACTORS.map((factor) => withLightness(source, source.l + (1 - source.l) * factor)),
      base,
      ...LIGHT_DROP_FACTORS.map((factor) => withLightness(source, source.l * factor)),
    ],
    dark: DARK_LIGHTNESS_FACTORS.map((factor) => withLightness(source, source.l * factor)),
  }
}