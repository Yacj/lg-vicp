import type { ThemeColorOption, ThemeMode, ThemeState } from '@/composables/types/theme'
import { defineStore } from 'pinia'
import { themeColorOptions } from '@/composables/types/theme'

function buildThemeVars(color: ThemeColorOption, mode: ThemeMode = 'light') {
  const { primary1, primary2, primary6, primary7, primary8 } = color.primaryShades
  const isDark = mode === 'dark'
  const textMain = isDark ? '#EEF5FF' : '#142B45'
  const textSecondary = isDark ? '#B8C7DC' : '#62748A'
  const textAuxiliary = isDark ? '#7890AE' : '#8A9BB0'
  const canvas = isDark ? '#0B1424' : '#F5F8FC'
  const surface = isDark ? '#111F33' : '#FFFFFF'
  const elevated = isDark ? '#172B47' : '#FFFFFF'
  const border = isDark ? '#263D5D' : '#E4EBF5'
  const soft = isDark ? '#142E52' : '#EFF6FF'

  return {
    ...color.primaryShades,
    baseBlack: '#000000',
    baseTransparent: 'transparent',
    baseWhite: '#FFFFFF',
    blue6: isDark ? '#60A5FA' : '#2563EB',
    cyan6: isDark ? '#38BDF8' : '#0EA5E9',
    green6: isDark ? '#79CBA2' : '#2F9B72',
    orange6: isDark ? '#E7B75F' : '#B7791F',
    red6: isDark ? '#EF9B83' : '#C05640',
    borderMain: border,
    borderLight: isDark ? '#1C3150' : '#F0F4FA',
    borderStrong: isDark ? '#3C5C86' : '#C8D8EC',
    borderZero: 'transparent',
    dividerMain: border,
    dividerLight: isDark ? '#1C3150' : '#F0F4FA',
    filledBottom: canvas,
    filledContent: surface,
    filledStrong: elevated,
    filledZero: 'transparent',
    iconMain: textMain,
    iconSecondary: textSecondary,
    iconAuxiliary: textAuxiliary,
    textMain,
    textSecondary,
    textAuxiliary,
    textDisabled: isDark ? '#5D7290' : '#B4C1D2',
    textPlaceholder: textAuxiliary,
    textWhite: '#FFFFFF',
    fontWeightRegular: '400',
    fontWeightMedium: '500',
    fontWeightSemibold: '600',
    fontWeightBold: '700',
    n4: '4px',
    n8: '8px',
    n12: '12px',
    n16: '16px',
    n20: '20px',
    n24: '24px',
    spacingTight: '8px',
    spacingMain: '16px',
    spacingLoose: '24px',
    paddingTight: '8px',
    paddingMain: '16px',
    paddingLoose: '24px',
    radiusZero: '0px',
    radiusMain: '16px',
    radiusLarge: '22px',
    radiusFull: '999px',
    buttonPrimaryBg: `linear-gradient(135deg, ${primary6} 0%, ${primary8} 100%)`,
    buttonPrimaryBgActive: primary7,
    buttonPrimaryColor: '#FFFFFF',
    buttonPrimaryColorActive: '#FFFFFF',
    buttonPrimaryPlainBg: 'transparent',
    buttonPrimaryPlainBgActive: soft,
    buttonPrimaryPlainBorder: primary6,
    buttonPrimaryPlainBorderActive: primary7,
    buttonPrimarySoftBg: primary1,
    buttonPrimarySoftBgActive: primary2,
    buttonRadiusMain: '999px',
    buttonRadiusFull: '999px',
    buttonHeightLarge: '48px',
    buttonHeightMedium: '44px',
    buttonHeightSmall: '36px',
    buttonDangerSoftBg: isDark ? '#4E2F2A' : '#FFF0EC',
    buttonSuccessSoftBg: isDark ? '#1D4438' : '#E7F7EF',
    buttonWarningSoftBg: isDark ? '#4B3B20' : '#FFF6DF',
    cardBg: surface,
    cardBorderColor: border,
    cardRadius: '16px',
    cardShadow: isDark ? '0 8px 24px rgba(0, 0, 0, 0.24)' : '0 8px 24px rgba(20, 43, 69, 0.06)',
    cellBg: surface,
    cellBgActive: soft,
    cellBorderColor: border,
    cellTapBg: soft,
    cellThemeColor: primary6,
    cellIconColor: textSecondary,
    cellIconSize: '20px',
    cellTitleColor: textMain,
    cellTitleFontSize: '15px',
    cellTitleLineHeight: '22px',
    cellLabelColor: textSecondary,
    cellLabelFontSize: '12px',
    cellLabelLineHeight: '18px',
    cellValueColor: textMain,
    cellValueFontSize: '14px',
    cellPadding: '16px',
    cellArrowColor: textAuxiliary,
    cellArrowSize: '18px',
    inputBg: surface,
    inputInnerColor: textMain,
    inputInnerFontSize: '15px',
    inputInnerPlaceholderColor: textAuxiliary,
    inputPadding: '0 4px',
    navbarBg: canvas,
    navbarColor: textMain,
    navbarDescColor: textSecondary,
    navbarArrowSize: '20px',
    navbarHeight: '44px',
    navbarTitleFontSize: '17px',
    navbarTitleFontWeight: '700',
    tabbarBg: surface,
    tabbarHeight: '50px',
    tagRadius: '999px',
    tagRoundRadius: '999px',
    tagPrimaryBg: primary6,
    tagPrimaryLightBg: primary1,
    tagPrimaryColor: primary6,
  }
}

/**
 * 完整版主题状态管理
 * 支持手动切换主题、主题色选择、跟随系统主题等完整功能
 */
export const useManualThemeStore = defineStore('manualTheme', {
  state: (): ThemeState => ({
    theme: 'light',
    followSystem: true, // 是否跟随系统主题
    hasUserSet: false, // 用户是否手动设置过主题
    currentThemeColor: themeColorOptions[0],
    themeVars: buildThemeVars(themeColorOptions[0], 'light'),
  }),

  getters: {
    isDark: state => state.theme === 'dark',
  },

  actions: {
    /**
     * 手动切换主题
     * @param mode 指定主题模式，不传则自动切换
     * @param isFollw 是否是跟随系统
     */
    toggleTheme(mode?: ThemeMode, isFollw: boolean = false) {
      this.theme = mode || (this.theme === 'light' ? 'dark' : 'light')
      this.themeVars = buildThemeVars(this.currentThemeColor, this.theme)
      if (!isFollw) {
        // 如果不是跟随系统，是手动切换
        this.hasUserSet = true // 标记用户已手动设置
        this.followSystem = false // 不再跟随系统
      }
      this.setNavigationBarColor()
    },

    /**
     * 设置是否跟随系统主题
     * @param follow 是否跟随系统
     */
    setFollowSystem(follow: boolean) {
      this.followSystem = follow
      if (follow) {
        this.hasUserSet = false
        this.initTheme() // 重新获取系统主题
      }
    },

    /**
     * 设置导航栏颜色
     */
    setNavigationBarColor() {
      uni.setNavigationBarColor({
        frontColor: this.theme === 'light' ? '#000000' : '#ffffff',
        backgroundColor: this.theme === 'light' ? '#F5F8FC' : '#0B1424',
      })
    },

    /**
     * 设置主题色
     * @param color 主题色选项
     */
    setCurrentThemeColor(color: ThemeColorOption) {
      this.currentThemeColor = color
      this.themeVars = buildThemeVars(color, this.theme)
    },

    /**
     * 获取系统主题
     * @returns 系统主题模式
     */
    getSystemTheme(): ThemeMode {
      try {
        // #ifdef MP-WEIXIN
        // 微信小程序使用 getAppBaseInfo
        const appBaseInfo = uni.getAppBaseInfo()
        if (appBaseInfo && appBaseInfo.theme) {
          return appBaseInfo.theme as ThemeMode
        }
        // #endif

        // #ifndef MP-WEIXIN
        // 其他平台使用 getSystemInfoSync
        const systemInfo = uni.getSystemInfoSync()
        if (systemInfo && systemInfo.theme) {
          return systemInfo.theme as ThemeMode
        }
        // #endif
      }
      catch (error) {
        console.warn('获取系统主题失败:', error)
      }
      return 'light' // 默认返回 light
    },

    /**
     * 初始化主题
     */
    initTheme() {
      // 迁移旧版工程青主题，避免持久化状态继续覆盖新的默认蓝色。
      if (this.currentThemeColor.value === 'teal') {
        this.currentThemeColor = themeColorOptions[0]
      }

      // 如果用户已手动设置且不跟随系统，保持当前主题
      if (this.hasUserSet && !this.followSystem) {
        this.themeVars = buildThemeVars(this.currentThemeColor, this.theme)
        console.log('使用用户设置的主题:', this.theme)
        this.setNavigationBarColor()
        return
      }

      // 获取系统主题
      const systemTheme = this.getSystemTheme()

      // 如果是首次启动或跟随系统，使用系统主题
      if (!this.hasUserSet || this.followSystem) {
        this.theme = systemTheme
        if (!this.hasUserSet) {
          this.followSystem = true
          console.log('首次启动，使用系统主题:', this.theme)
        }
        else {
          console.log('跟随系统主题:', this.theme)
        }
      }

      this.themeVars = buildThemeVars(this.currentThemeColor, this.theme)
      this.setNavigationBarColor()
    },
  },
})
