import type { ThemeColorOption, ThemeMode, ThemeState } from '@/composables/types/theme'
import { defineStore } from 'pinia'
import { themeColorOptions } from '@/composables/types/theme'

function buildThemeVars(color: ThemeColorOption, mode: ThemeMode = 'light') {
  const { primary1, primary2, primary6, primary7, primary8 } = color.primaryShades
  const isDark = mode === 'dark'
  const textMain = isDark ? '#F5F6F8' : '#1F1F1F'
  const textSecondary = isDark ? '#D9DCE3' : '#333333'
  const textAuxiliary = isDark ? '#969BA6' : '#8C8C8C'
  const canvas = isDark ? '#101114' : '#F5F6FA'
  const surface = isDark ? '#181A1F' : '#FFFFFF'
  const elevated = isDark ? '#1D2026' : '#FFFFFF'
  const drawer = isDark ? '#14161A' : '#F7F8FA'
  const border = isDark ? '#2A2E36' : '#E9EBF0'
  const soft = isDark ? '#22262F' : '#F1F5FF'

  return {
    ...color.primaryShades,
    baseBlack: '#000000',
    baseTransparent: 'transparent',
    baseWhite: '#FFFFFF',
    blue6: isDark ? '#60A5FA' : '#2F6BFF',
    cyan6: isDark ? '#38BDF8' : '#0EA5E9',
    green6: isDark ? '#79CBA2' : '#2F9B72',
    orange6: isDark ? '#E7B75F' : '#B7791F',
    red6: isDark ? '#EF9B83' : '#C05640',
    borderMain: border,
    borderLight: isDark ? '#20242B' : '#F2F3F6',
    borderStrong: isDark ? '#3A404C' : '#D9DDE5',
    borderZero: 'transparent',
    dividerMain: border,
    dividerLight: isDark ? '#1C3150' : '#F0F4FA',
    filledBottom: canvas,
    filledContent: surface,
    filledStrong: elevated,
    filledDrawer: drawer,
    filledZero: 'transparent',
    iconMain: textMain,
    iconSecondary: textSecondary,
    iconAuxiliary: textAuxiliary,
    textMain,
    textSecondary,
    textAuxiliary,
    textDisabled: isDark ? '#5F6570' : '#C9CDD4',
    textPlaceholder: textAuxiliary,
    textWhite: '#FFFFFF',
    // fontWeightRegular: '400',
    // fontWeightMedium: '600',
    // fontWeightSemibold: '600',
    // fontWeightBold: '700',
    n4: '8rpx',
    n8: '16rpx',
    n12: '24rpx',
    n16: '32rpx',
    n20: '40rpx',
    n24: '48rpx',
    spacingTight: '16rpx',
    spacingMain: '32rpx',
    spacingLoose: '48rpx',
    paddingTight: '16rpx',
    paddingMain: '32rpx',
    paddingLoose: '48rpx',
    // buttonPrimaryBg: `linear-gradient(135deg, ${primary6} 0%, ${primary8} 100%)`,
    // buttonPrimaryBgActive: primary7,
    // buttonPrimaryColor: '#FFFFFF',
    // buttonPrimaryColorActive: '#FFFFFF',
    // buttonPrimaryPlainBg: 'transparent',
    // buttonPrimaryPlainBgActive: soft,
    // buttonPrimaryPlainBorder: primary6,
    // buttonPrimaryPlainBorderActive: primary7,
    // buttonPrimarySoftBg: primary1,
    // buttonPrimarySoftBgActive: primary2,
    // buttonHeightLarge: '96rpx',
    // buttonHeightMedium: '88rpx',
    // buttonHeightSmall: '72rpx',
    buttonDangerSoftBg: isDark ? '#4E2F2A' : '#FFF0EC',
    buttonSuccessSoftBg: isDark ? '#1D4438' : '#E7F7EF',
    buttonWarningSoftBg: isDark ? '#4B3B20' : '#FFF6DF',
    cardBg: surface,
    cardBorderColor: border,
    // cardRadius: '32rpx',
    cardShadow: isDark ? '0 16rpx 48rpx rgba(0, 0, 0, 0.24)' : '0 16rpx 48rpx rgba(20, 43, 69, 0.06)',
    cellBg: surface,
    cellBgActive: soft,
    cellBorderColor: border,
    cellTapBg: soft,
    cellThemeColor: primary6,
    cellIconColor: textSecondary,
    cellIconSize: '40rpx',
    cellTitleColor: textMain,
    cellTitleFontSize: '30rpx',
    cellTitleLineHeight: '44rpx',
    cellLabelColor: textSecondary,
    cellLabelFontSize: '24rpx',
    cellLabelLineHeight: '36rpx',
    cellValueColor: textMain,
    cellValueFontSize: '28rpx',
    cellPadding: '32rpx',
    cellArrowColor: textAuxiliary,
    cellArrowSize: '36rpx',
    inputBg: surface,
    inputInnerColor: textMain,
    inputInnerFontSize: '30rpx',
    inputInnerPlaceholderColor: textAuxiliary,
    inputPadding: '0 8rpx',
    navbarBg: canvas,
    navbarColor: textMain,
    navbarDescColor: textSecondary,
    // navbarArrowSize: '40rpx',
    // navbarHeight: '88rpx',
    // navbarTitleFontSize: '34rpx',
    // navbarTitleFontWeight: '700',
    tabbarBg: surface,
    tabbarHeight: '100rpx',
    // tagRadius: '999rpx',
    // tagRoundRadius: '999rpx',
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
        backgroundColor: this.theme === 'light' ? '#F5F6FA' : '#101114',
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
