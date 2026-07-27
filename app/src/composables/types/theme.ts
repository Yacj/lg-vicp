import type { ConfigProviderThemeVars } from '@wot-ui/ui'

export type PrimaryShadeKey
  = | 'primary1'
    | 'primary2'
    | 'primary3'
    | 'primary4'
    | 'primary5'
    | 'primary6'
    | 'primary7'
    | 'primary8'
    | 'primary9'
    | 'primary10'

export type ThemePrimaryShades = Record<PrimaryShadeKey, string>

export interface ThemeColorOption {
  name: string
  value: string
  primary: string
  primaryShades: ThemePrimaryShades
}

export type ThemeMode = 'light' | 'dark'

export interface ThemeState {
  theme: ThemeMode
  followSystem: boolean
  hasUserSet: boolean
  currentThemeColor: ThemeColorOption
  themeVars: ConfigProviderThemeVars
}

export interface SystemThemeState {
  theme: ThemeMode
  themeVars: ConfigProviderThemeVars
}

export const themeColorOptions: ThemeColorOption[] = [
  {
    name: '科技蓝',
    value: 'blue',
    primary: '#2563EB',
    primaryShades: {
      primary1: '#EFF6FF',
      primary2: '#DBEAFE',
      primary3: '#BFDBFE',
      primary4: '#93C5FD',
      primary5: '#60A5FA',
      primary6: '#2563EB',
      primary7: '#1D4ED8',
      primary8: '#1E40AF',
      primary9: '#1E3A8A',
      primary10: '#172554',
    },
  },
  {
    name: 'AI 蓝紫',
    value: 'ai',
    primary: '#5367D9',
    primaryShades: {
      primary1: '#F2F3FF',
      primary2: '#E5E8FF',
      primary3: '#C7CEFF',
      primary4: '#A4B0FF',
      primary5: '#7C8CEF',
      primary6: '#5367D9',
      primary7: '#4558C0',
      primary8: '#39489E',
      primary9: '#2D397D',
      primary10: '#20295C',
    },
  },
]
