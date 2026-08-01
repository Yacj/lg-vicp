<script setup lang="ts">
import type {
  ContentWidth,
  LayoutMode,
  PageDensity,
  RadiusLevel,
  SidebarTheme,
  TabsStyle,
  ThemeMode,
  ThemePreset,
} from '@/types/appearance'
import { useAppFeedback } from '@/composables/useAppFeedback'
import { useSettingsStore } from '@/stores/settings'

defineOptions({ name: 'AppearanceDrawer' })

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
}>()

const settingsStore = useSettingsStore()
const feedback = useAppFeedback()

const themeOptions = [
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '跟随系统', value: 'system' },
] satisfies Array<{ label: string, value: ThemeMode }>

const layoutOptions = [
  { label: '侧边', value: 'side' },
  { label: '顶部', value: 'top' },
  { label: '混合', value: 'mixed' },
  { label: '双侧栏', value: 'dual' },
] satisfies Array<{ label: string, value: LayoutMode }>

const sidebarThemeOptions = [
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '自动', value: 'auto' },
] satisfies Array<{ label: string, value: SidebarTheme }>

const contentWidthOptions = [
  { label: '流式', value: 'fluid' },
  { label: '固定', value: 'fixed' },
] satisfies Array<{ label: string, value: ContentWidth }>

const densityOptions = [
  { label: '舒适', value: 'comfortable' },
  { label: '紧凑', value: 'compact' },
] satisfies Array<{ label: string, value: PageDensity }>

const tabsStyleOptions = [
  { label: '线型', value: 'line' },
  { label: '卡片', value: 'card' },
  { label: 'Chrome', value: 'chrome' },
] satisfies Array<{ label: string, value: TabsStyle }>

const radiusOptions = [
  { label: '方形', value: 'square' },
  { label: '小圆角', value: 'small' },
  { label: '中圆角', value: 'medium' },
  { label: '大圆角', value: 'large' },
] satisfies Array<{ label: string, value: RadiusLevel }>

const presetOptions = [
  { label: 'VICP 深蓝', value: 'vicp-blue' },
  { label: '科技蓝', value: 'technology-blue' },
  { label: '靛青', value: 'indigo' },
  { label: '青色', value: 'cyan' },
  { label: '生态绿', value: 'emerald' },
  { label: '紫色', value: 'purple' },
] satisfies Array<{ label: string, value: ThemePreset }>

function patch<Key extends keyof typeof settingsStore.settings>(
  key: Key,
  value: (typeof settingsStore.settings)[Key],
): void {
  settingsStore.patchSetting(key, value)
}

function reset(): void {
  settingsStore.resetSettings()
  void feedback.message('success', '外观设置已恢复默认')
}

function close(): void {
  emit('update:visible', false)
}
</script>

<template>
  <t-drawer
    :visible="visible"
    :close-on-overlay-click="true"
    :destroy-on-close="false"
    placement="right"
    size="min(440px, 100vw)"
    header="外观设置"
    :footer="false"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="appearance-drawer">
      <section class="appearance-drawer__section">
        <h3>主题</h3>
        <div class="appearance-drawer__field">
          <span>界面模式</span>
          <t-radio-group
            :options="themeOptions"
            theme="button"
            :value="settingsStore.settings.themeMode"
            variant="outline"
            @change="patch('themeMode', $event as ThemeMode)"
          />
        </div>
        <div class="appearance-drawer__field">
          <span>系统主题色</span>
          <t-select
            :options="presetOptions"
            :value="settingsStore.settings.systemThemePreset"
            @change="patch('systemThemePreset', $event as ThemePreset)"
          />
        </div>
        <div class="appearance-drawer__switch">
          <span>同步组件主题色</span>
          <t-switch
            :value="settingsStore.settings.syncThemeColors"
            @change="patch('syncThemeColors', Boolean($event))"
          />
        </div>
        <div class="appearance-drawer__field">
          <span>组件主题色</span>
          <t-select
            :disabled="settingsStore.settings.syncThemeColors"
            :options="presetOptions"
            :value="settingsStore.settings.componentThemePreset"
            @change="patch('componentThemePreset', $event as ThemePreset)"
          />
        </div>
      </section>

      <t-divider />

      <section class="appearance-drawer__section">
        <h3>布局</h3>
        <div class="appearance-drawer__field">
          <span>布局模式</span>
          <t-radio-group
            :options="layoutOptions"
            theme="button"
            :value="settingsStore.settings.layoutMode"
            variant="outline"
            @change="patch('layoutMode', $event as LayoutMode)"
          />
        </div>
        <div class="appearance-drawer__field">
          <span>侧栏主题</span>
          <t-radio-group
            :options="sidebarThemeOptions"
            theme="button"
            :value="settingsStore.settings.sidebarTheme"
            variant="outline"
            @change="patch('sidebarTheme', $event as SidebarTheme)"
          />
        </div>
        <div class="appearance-drawer__field">
          <span>内容宽度</span>
          <t-radio-group
            :options="contentWidthOptions"
            theme="button"
            :value="settingsStore.settings.contentWidth"
            variant="outline"
            @change="patch('contentWidth', $event as ContentWidth)"
          />
        </div>
      </section>

      <t-divider />

      <section class="appearance-drawer__section">
        <h3>显示</h3>
        <div class="appearance-drawer__field">
          <span>信息密度</span>
          <t-radio-group
            :options="densityOptions"
            theme="button"
            :value="settingsStore.settings.density"
            variant="outline"
            @change="patch('density', $event as PageDensity)"
          />
        </div>
        <div class="appearance-drawer__field">
          <span>标签页样式</span>
          <t-radio-group
            :options="tabsStyleOptions"
            theme="button"
            :value="settingsStore.settings.tabsStyle"
            variant="outline"
            @change="patch('tabsStyle', $event as TabsStyle)"
          />
        </div>
        <div class="appearance-drawer__field">
          <span>圆角等级</span>
          <t-radio-group
            :options="radiusOptions"
            theme="button"
            :value="settingsStore.settings.radiusLevel"
            variant="outline"
            @change="patch('radiusLevel', $event as RadiusLevel)"
          />
        </div>
        <div class="appearance-drawer__switch">
          <span>固定 Header</span>
          <t-switch
            :value="settingsStore.settings.fixedHeader"
            @change="patch('fixedHeader', Boolean($event))"
          />
        </div>
        <div class="appearance-drawer__switch">
          <span>显示标签页</span>
          <t-switch
            :value="settingsStore.settings.showTabs"
            @change="patch('showTabs', Boolean($event))"
          />
        </div>
      </section>

      <div class="appearance-drawer__footer">
        <t-button block theme="default" variant="outline" @click="reset">
          恢复默认设置
        </t-button>
        <t-button block theme="primary" @click="close">
          完成
        </t-button>
      </div>
    </div>
  </t-drawer>
</template>

<style scoped>
.appearance-drawer {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  gap: 4px;
}

.appearance-drawer__section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.appearance-drawer__section h3 {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: 15px;
}

.appearance-drawer__field,
.appearance-drawer__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.appearance-drawer__field > span,
.appearance-drawer__switch > span {
  color: var(--td-text-color-secondary);
  font-size: 13px;
}

.appearance-drawer__field :deep(.t-radio-group),
.appearance-drawer__field :deep(.t-select) {
  min-width: 0;
  flex: 1;
}

.appearance-drawer__field :deep(.t-radio-group) {
  justify-content: flex-end;
}

.appearance-drawer__field :deep(.t-select) {
  max-width: 240px;
}

.appearance-drawer__footer {
  display: flex;
  margin-top: auto;
  flex-direction: column;
  gap: 10px;
  padding-top: 24px;
}
</style>
