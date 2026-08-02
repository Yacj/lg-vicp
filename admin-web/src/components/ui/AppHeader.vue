<script setup lang="ts">
import type { DropdownOption } from 'tdesign-vue-next'
import type { MenuNavigationTarget } from '@/types/menu'
import { useFullscreen } from '@vueuse/core'
import {
  BrightnessIcon,
  CloudyNightIcon,
  FullscreenExitIcon,
  FullscreenIcon,
  LockOnIcon,
  LogoutIcon,
  MoreIcon,
  NotificationIcon,
  PaletteIcon,
  RefreshIcon,
  RobotIcon,
  SearchIcon,
  SettingIcon,
  UserIcon,
} from 'tdesign-icons-vue-next'
import { computed, nextTick, ref } from 'vue'
import defaultAvatar from '@/assets/avatar.png'
import { useRoute, useRouter } from 'vue-router'
import { confirmAndRun } from '@/composables/useAppConfirm'
import { useResponsiveShell } from '@/composables/useResponsiveShell'
import { flattenNavigableMenus, findMenuById, navigateMenuTarget, withHomeMenu } from '@/router/dynamic-routes'
import { useAuthStore } from '@/stores/auth'
import { useRouteStore } from '@/stores/route'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'
import { useUserStore } from '@/stores/user'
import AppIcon from './AppIcon.vue'
import AppearanceDrawer from './AppearanceDrawer.vue'
import AppNavigationToggle from './AppNavigationToggle.vue'
import AppUserSummary from './AppUserSummary.vue'

defineOptions({ name: 'AppHeader' })

const props = withDefaults(defineProps<{
  compact?: boolean
  navigationCollapsed?: boolean
  showNavigationToggle?: boolean
}>(), {
  compact: false,
  navigationCollapsed: false,
  showNavigationToggle: false,
})

const emit = defineEmits<{
  toggleNavigation: []
}>()

const authStore = useAuthStore()
const routeStore = useRouteStore()
const settingsStore = useSettingsStore()
const tabsStore = useTabsStore()
const userStore = useUserStore()
const route = useRoute()
const router = useRouter()
const shell = useResponsiveShell()

const appearanceVisible = ref(false)
const searchVisible = ref(false)
const userPanelVisible = ref(false)
const searchKeyword = ref('')
const { isFullscreen, isSupported: fullscreenSupported, toggle: toggleFullscreen } = useFullscreen()

const userLabel = computed(() => userStore.profile?.displayName.trim() || '管理员')
// 用户模型暂无头像字段，统一回退本地默认头像
const userAvatar = defaultAvatar
const isCompactHeader = computed(() => props.compact || shell.usesDrawer.value)
const navigableMenus = computed(() => flattenNavigableMenus(withHomeMenu(routeStore.sidebarMenus)))
const searchResults = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  return navigableMenus.value.filter(item => {
    const targetText = item.target?.kind === 'external' ? item.target.href : item.path ?? ''
    return !keyword
      || item.title.toLowerCase().includes(keyword)
      || targetText.toLowerCase().includes(keyword)
  })
})
const assistantTarget = computed(() => navigableMenus.value.find((item) => {
  const searchable = `${item.id} ${item.title} ${item.icon ?? ''}`.toLowerCase()
  return searchable.includes('ai') || searchable.includes('筑小格') || searchable.includes('智能')
})?.target ?? null)
const themeIcon = computed(() => settingsStore.effectiveTheme === 'dark' ? CloudyNightIcon : BrightnessIcon)
const themeLabel = computed(() => settingsStore.effectiveTheme === 'dark' ? '切换为浅色' : '切换为深色')

const compactActionOptions = computed<DropdownOption[]>(() => [
  { content: '全局搜索', value: 'search' },
  { content: '刷新当前页', value: 'refresh' },
  { content: isFullscreen.value ? '退出全屏' : '全屏', value: 'fullscreen', disabled: !fullscreenSupported.value },
  { content: themeLabel.value, value: 'theme' },
  { content: '通知', value: 'notifications', disabled: true },
  { content: '筑小格 AI', value: 'assistant', disabled: !assistantTarget.value },
  { content: '外观设置', value: 'appearance' },
])

function navigate(target: MenuNavigationTarget | null): void {
  if (target) {
    navigateMenuTarget(target, router)
  }
}

function openSearch(): void {
  searchKeyword.value = ''
  searchVisible.value = true
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('.app-header__search-input input')
    input?.focus()
  })
}

function handleSearchChange(value: string | number): void {
  if (typeof value === 'string') {
    const item = findMenuById(navigableMenus.value, value)
    navigate(item?.target ?? null)
    searchVisible.value = false
  }
}

function refreshCurrentRoute(): void {
  tabsStore.refresh(route.fullPath)
}

function toggleTheme(): void {
  settingsStore.patchSetting('themeMode', settingsStore.effectiveTheme === 'dark' ? 'light' : 'dark')
}

function openAssistant(): void {
  navigate(assistantTarget.value)
}

function handleCompactAction(option: DropdownOption): void {
  switch (option.value) {
    case 'search':
      openSearch()
      break
    case 'refresh':
      refreshCurrentRoute()
      break
    case 'fullscreen':
      void toggleFullscreen()
      break
    case 'theme':
      toggleTheme()
      break
    case 'assistant':
      openAssistant()
      break
    case 'appearance':
      appearanceVisible.value = true
      break
  }
}

async function handleLogout(): Promise<void> {
  userPanelVisible.value = false
  const result = await confirmAndRun(
    {
      title: '退出管理后台',
      content: '退出后将清除当前会话和已打开的页面标签。',
      confirmText: '退出登录',
      danger: true,
    },
    () => authStore.logout(),
  )
  if (!result.confirmed) {
    return
  }

  const logoutSucceeded = result.value
  userStore.reset()
  routeStore.reset(router)
  tabsStore.reset()
  if (!logoutSucceeded) {
    await import('@/composables/useAppFeedback').then(({ useAppFeedback }) => (
      useAppFeedback().message('warning', '服务端会话撤销失败，本地登录状态已清除')
    ))
  }
  await router.replace({ name: 'Login' })
}
</script>

<template>
  <header
    class="app-header"
    :class="{ 'is-fixed': settingsStore.settings.fixedHeader, 'is-compact': isCompactHeader }"
  >
    <div class="app-header__start">
      <AppNavigationToggle
        v-if="showNavigationToggle"
        :collapsed="navigationCollapsed"
        @click="emit('toggleNavigation')"
      />

      <slot name="brand" />
      <slot name="navigation" />
      <slot name="breadcrumb" />
    </div>

    <div v-if="!isCompactHeader" class="app-header__actions" aria-label="壳层工具">
      <t-tooltip content="全局搜索" placement="bottom">
        <t-button aria-label="全局搜索" shape="square" theme="default" variant="text" @click="openSearch">
          <SearchIcon />
        </t-button>
      </t-tooltip>
      <t-tooltip content="刷新当前页" placement="bottom">
        <t-button aria-label="刷新当前页" shape="square" theme="default" variant="text" @click="refreshCurrentRoute">
          <RefreshIcon />
        </t-button>
      </t-tooltip>
      <t-tooltip :content="isFullscreen ? '退出全屏' : '全屏'" placement="bottom">
        <t-button
          :aria-label="isFullscreen ? '退出全屏' : '全屏'"
          :disabled="!fullscreenSupported"
          shape="square"
          theme="default"
          variant="text"
          @click="toggleFullscreen"
        >
          <FullscreenExitIcon v-if="isFullscreen" />
          <FullscreenIcon v-else />
        </t-button>
      </t-tooltip>
      <t-tooltip :content="themeLabel" placement="bottom">
        <t-button :aria-label="themeLabel" shape="square" theme="default" variant="text" @click="toggleTheme">
          <component :is="themeIcon" />
        </t-button>
      </t-tooltip>
      <t-tooltip content="通知" placement="bottom">
        <t-button aria-label="通知" disabled shape="square" theme="default" variant="text">
          <NotificationIcon />
        </t-button>
      </t-tooltip>
      <t-tooltip content="筑小格 AI" placement="bottom">
        <t-button
          aria-label="筑小格 AI"
          :disabled="!assistantTarget"
          shape="square"
          theme="default"
          variant="text"
          @click="openAssistant"
        >
          <RobotIcon />
        </t-button>
      </t-tooltip>
      <t-tooltip content="外观设置" placement="bottom">
        <t-button aria-label="外观设置" shape="square" theme="default" variant="text" @click="appearanceVisible = true">
          <PaletteIcon />
        </t-button>
      </t-tooltip>
    </div>

    <div class="app-header__end">
      <t-dropdown
        v-if="isCompactHeader"
        :options="compactActionOptions"
        placement="bottom-right"
        trigger="click"
        @click="handleCompactAction"
      >
        <t-button aria-label="更多工具" shape="square" theme="default" variant="text">
          <MoreIcon />
        </t-button>
      </t-dropdown>

      <t-popup v-model:visible="userPanelVisible" placement="bottom-right" trigger="click">
        <t-button aria-label="用户菜单" class="app-header__user" theme="default" variant="text">
          <t-avatar :image="userAvatar" alt="用户头像" shape="circle" size="40px" />
          <span>{{ userLabel }}</span>
        </t-button>
        <template #content>
          <div class="app-header__user-panel">
            <AppUserSummary />
            <t-divider />
            <div class="app-header__user-actions">
              <t-button block variant="text" class="app-header__user-action" disabled>
                <UserIcon />
                <span>个人信息</span>
              </t-button>
              <t-button block variant="text" class="app-header__user-action" disabled>
                <SettingIcon />
                <span>账号设置</span>
              </t-button>
              <t-button block variant="text" class="app-header__user-action" disabled>
                <LockOnIcon />
                <span>修改密码</span>
              </t-button>
            </div>
            <t-divider />
            <t-button block variant="text" class="app-header__user-action is-danger" @click="handleLogout">
              <LogoutIcon />
              <span>退出登录</span>
            </t-button>
          </div>
        </template>
      </t-popup>
    </div>

    <t-drawer
      v-model:visible="searchVisible"
      attach="body"
      header="全局搜索"
      placement="right"
      :prevent-scroll-through="true"
      size="min(420px, 92vw)"
    >
      <div class="app-header__search-panel">
        <t-input
          v-model="searchKeyword"
          autofocus
          clearable
          class="app-header__search-input"
          placeholder="搜索已授权页面"
        >
          <template #prefixIcon>
            <SearchIcon />
          </template>
        </t-input>
        <t-menu
          v-if="searchResults.length > 0"
          class="app-header__search-menu"
          :value="route.path"
          @change="handleSearchChange"
        >
          <t-menu-item v-for="item in searchResults" :key="item.id" :value="item.id">
            <template #icon>
              <AppIcon :name="item.icon" />
            </template>
            {{ item.title }}
          </t-menu-item>
        </t-menu>
        <t-empty v-else description="没有匹配的已授权页面" />
      </div>
    </t-drawer>

    <AppearanceDrawer v-model:visible="appearanceVisible" />
  </header>
</template>

<style scoped>
.app-header {
  position: relative;
  z-index: 10;
  display: flex;
  min-width: 0;
  height: var(--vicp-header-height);
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-5);
  padding: 0 var(--td-size-6);
  border-bottom: 1px solid var(--td-component-stroke);
  background: var(--td-bg-color-container);
}

.app-header.is-fixed {
  position: sticky;
  top: 0;
}

.app-header__start,
.app-header__actions,
.app-header__end {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-2);
}

.app-header__start {
  flex: 1 1 auto;
  overflow: hidden;
}

.app-header__actions,
.app-header__end {
  flex: 0 0 auto;
}

.app-header__start :deep(.app-top-nav) {
  margin-left: var(--td-size-2);
}

.app-header__start :deep(.t-breadcrumb),
.app-header__mobile-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-header__user {
  gap: var(--td-size-2);
  height: auto; /* 覆盖 text variant 的 32px 固定高度，避免 40px 头像上下被裁切 */
  padding-block: var(--td-size-1);
  padding-inline: var(--td-size-2);
}

.app-header__user-panel {
  display: grid;
  width: 260px;
  gap: var(--td-size-2);
  padding: var(--td-size-4);
}

.app-header__user-actions {
  display: grid;
  gap: var(--td-size-1);
}

.app-header__user-action {
  height: auto;
  justify-content: flex-start;
  padding: var(--td-size-2) var(--td-size-3);
  border-radius: var(--td-radius-default);
}

/* t-button 全局把 .t-button__text 设为 inline-flex，会导致行内图标/头像与文字基线错位，
   这里统一还原为行内布局，用 vertical-align 对齐 */
.app-header__user :deep(.t-button__text),
.app-header__user-action :deep(.t-button__text) {
  display: inline;
}

.app-header__user :deep(.t-avatar),
.app-header__user :deep(.t-button__text > span) {
  vertical-align: middle;
}

.app-header__user :deep(.t-button__text > span) {
  margin-left: var(--td-size-2);
}

.app-header__user-action :deep(.t-button__text) {
  font-size: var(--td-font-size-body-medium);
}

.app-header__user-action :deep(.t-button__text svg) {
  margin-right: var(--td-size-3);
  font-size: var(--td-font-size-body-large);
  vertical-align: middle;
}

.app-header__user-action:not(:disabled):hover {
  background: var(--td-bg-color-container-hover);
}

.app-header__user-action.is-danger {
  color: var(--td-error-color);
}

.app-header__user-panel :deep(.t-divider) {
  margin: var(--td-size-2) 0;
}

.app-header__search-panel {
  display: grid;
  min-height: 100%;
  gap: var(--td-size-4);
}

.app-header__search-menu {
  min-height: 0;
  overflow: auto;
}

@media (max-width: 760px) {
  .app-header {
    padding-inline: var(--td-size-4);
  }

  .app-header__user span {
    display: none;
  }
}
</style>
