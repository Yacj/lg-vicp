<script setup lang="ts">
import type { ThemeMode } from '@/composables/types/theme'
import { useBackNavigation } from '@/composables/useBackNavigation'

definePage({
  name: 'appearance-settings',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '外观设置',
  },
})

type AppearanceMode = 'system' | ThemeMode

interface AppearanceOption {
  value: AppearanceMode
  label: string
  description: string
}

const options: AppearanceOption[] = [
  { value: 'system', label: '跟随系统', description: '随设备的浅色或深色模式自动切换' },
  { value: 'light', label: '浅色', description: '始终使用明亮、清晰的界面' },
  { value: 'dark', label: '深色', description: '始终使用低亮度的深色界面' },
]

const { goBack } = useBackNavigation()
const { theme, followSystem, toggleTheme, setFollowSystem } = useManualTheme()
const selectedMode = computed<AppearanceMode>({
  get: () => followSystem.value ? 'system' : theme.value,
  set: applyAppearance,
})

function applyAppearance(mode: AppearanceMode) {
  if (mode === 'system') {
    setFollowSystem(true)
    return
  }

  setFollowSystem(false)
  toggleTheme(mode)
}
</script>

<template>
  <view class="app-page min-h-screen">
    <wd-navbar
      custom-class="app-navbar"
      safe-area-inset-top
      left-arrow
      title="外观设置"
      @click-left="goBack"
    />

    <view class="app-enter mx-auto box-border max-w-750px w-full py-4">
      <view class="px-4 pb-2 text-26rpx font-bold leading-40rpx">
        主题模式
      </view>
      <view class="appearance-section">
        <wd-radio-group
          v-model="selectedMode"
          custom-class="appearance-options"
          type="circle"
          placement="right"
          checked-color="var(--app-action-primary)"
        >
          <wd-radio
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            custom-class="appearance-option"
          >
            <view class="min-w-0 flex-1">
              <view class="text-30rpx font-medium leading-42rpx">
                {{ option.label }}
              </view>
              <view class="app-tertiary mt-1 text-24rpx leading-34rpx">
                {{ option.description }}
              </view>
            </view>
          </wd-radio>
        </wd-radio-group>
      </view>

      <view class="app-tertiary px-4 pt-3 text-22rpx leading-34rpx">
        选择后立即生效，并保存在当前设备中。
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.appearance-section {
  border-top: 1px solid var(--app-border-default);
  border-bottom: 1px solid var(--app-border-default);
  background: var(--app-bg-surface);
}

:deep(.appearance-option) {
  min-height: 120rpx;
  padding: 24rpx 32rpx;
  box-sizing: border-box;
}

:deep(.appearance-option + .appearance-option) {
  border-top: 1px solid var(--app-border-default);
}

:deep(.appearance-option .wd-radio__label) {
  min-width: 0;
  flex: 1;
  margin-right: 24rpx;
}
</style>
