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
    primary: '#2F6BFF',
    primaryShades: {
      primary1: '#EEF3FF',
      primary2: '#DCE7FF',
      primary3: '#BFD2FF',
      primary4: '#8FB0FF',
      primary5: '#5F8FFF',
      primary6: '#2F6BFF',
      primary7: '#2457D6',
      primary8: '#1747B5',
      primary9: '#123B93',
      primary10: '#102D6F',
    },
  },
  // {
  //   name: 'AI 蓝紫',
  //   value: 'ai',
  //   primary: '#5367D9',
  //   primaryShades: {
  //     primary1: '#F2F3FF',
  //     primary2: '#E5E8FF',
  //     primary3: '#C7CEFF',
  //     primary4: '#A4B0FF',
  //     primary5: '#7C8CEF',
  //     primary6: '#5367D9',
  //     primary7: '#4558C0',
  //     primary8: '#39489E',
  //     primary9: '#2D397D',
  //     primary10: '#20295C',
  //   },
  // },
]
