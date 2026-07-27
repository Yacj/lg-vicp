<script setup lang="ts">
import { useAuthGate } from '@/composables/useAuthGate'

definePage({
  name: 'profile',
  layout: 'tabbar',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '我的',
  },
})

const { theme, toggleTheme } = useManualTheme()
const { requireLogin } = useAuthGate()
const { info } = useGlobalToast()
const authStore = useAuthStore()

const isAuthenticated = computed(() => authStore.isAuthenticated)
const profileName = computed(() => authStore.user?.displayName || '暂无登录')
const profileDescription = computed(() => isAuthenticated.value ? '业务员 · 当前租户工作空间' : '点击登录后管理项目和个人归档')
const profileStats = computed(() => isAuthenticated.value
  ? { projects: 3, reports: 2, files: 12 }
  : { projects: 0, reports: 0, files: 0 })

const isDark = computed({
  get: () => theme.value === 'dark',
  set: () => toggleTheme(),
})

const archiveItems = [
  { label: '我的文件', description: '图纸、资料和项目附件', icon: 'file', value: 'files' },
  { label: '报告归档', description: '设计说明和节能论证报告', icon: 'document', value: 'reports' },
  { label: '节点图库', description: 'VICP 标准构造节点', icon: 'picture', value: 'nodes' },
]

const settingItems = [
  { label: '隐私与协议', description: '隐私政策、用户协议和 AI 说明', icon: 'lock', value: 'privacy' },
  { label: '关于蓝格智配', description: '当前版本 0.1.0 · 基础骨架', icon: 'info', value: 'about' },
]

function openProfile() {
  requireLogin({ showToast: false })
}

function handleArchiveItemClick(label: string) {
  if (!requireLogin()) {
    return
  }

  info(`${label}接口待接入`)
}

function handleItemClick(label: string) {
  info(`${label}接口待接入`)
}

function logout() {
  authStore.clearSession()
  info('已退出登录')
}
</script>

<template>
  <view class="app-page app-page--immersive">
    <wd-navbar custom-class="app-navbar" safe-area-inset-top title="我的" />
    <view class="app-enter box-border px-4 py-4 pb-6">
      <view class="app-panel mb-5 overflow-hidden p-4" @click="openProfile">
        <view class="flex items-center gap-3">
          <view class="h-14 w-14 flex items-center justify-center rounded-2xl" :class="isAuthenticated ? 'bg-[var(--app-action-primary)]' : 'bg-[var(--app-action-primary-soft)]'">
            <wd-icon name="user" size="28px" :color="isAuthenticated ? '#fff' : 'var(--app-action-primary)'" />
          </view>
          <view class="min-w-0 flex-1">
            <view class="text-5 font-bold">
              {{ profileName }}
            </view>
            <view class="app-muted mt-1 text-3">
              {{ profileDescription }}
            </view>
          </view>
          <wd-tag v-if="isAuthenticated" type="success" plain>
            已登录
          </wd-tag>
          <wd-tag v-else type="warning" plain>
            点击登录
          </wd-tag>
        </view>
        <view class="app-divider my-4" />
        <view class="grid grid-cols-3 gap-3 text-center">
          <view>
            <view class="text-5 font-bold">
              {{ profileStats.projects }}
            </view>
            <view class="app-tertiary mt-1 text-2.5">
              我的项目
            </view>
          </view>
          <view>
            <view class="text-5 font-bold">
              {{ profileStats.reports }}
            </view>
            <view class="app-tertiary mt-1 text-2.5">
              已生成报告
            </view>
          </view>
          <view>
            <view class="text-5 font-bold">
              {{ profileStats.files }}
            </view>
            <view class="app-tertiary mt-1 text-2.5">
              我的文件
            </view>
          </view>
        </view>
      </view>

      <view class="app-section-title mb-3">
        个人归档
      </view>
      <view class="app-panel-flat mb-5 overflow-hidden">
        <wd-cell
          v-for="item in archiveItems"
          :key="item.value"
          :title="item.label"
          :label="item.description"
          :icon="item.icon"
          is-link
          @click="handleArchiveItemClick(item.label)"
        />
      </view>

      <view class="app-section-title mb-3">
        偏好设置
      </view>
      <view class="app-panel-flat mb-5 overflow-hidden">
        <wd-cell title="深色模式" label="适配夜间查看和低光环境" icon="moon">
          <template #value>
            <wd-switch v-model="isDark" size="20px" />
          </template>
        </wd-cell>
        <wd-cell
          v-for="item in settingItems"
          :key="item.value"
          :title="item.label"
          :label="item.description"
          :icon="item.icon"
          is-link
          @click="handleItemClick(item.label)"
        />
      </view>

      <wd-button v-if="isAuthenticated" plain block type="error" @click="logout">
        退出登录
      </wd-button>

      <view class="mt-5 text-center">
        <view class="app-tertiary text-2.5">
          蓝格智配 VICP · 建筑节能 AI 智配
        </view>
        <view class="app-tertiary mt-1 text-2.5">
          让每一次选型都有计算依据
        </view>
      </view>
    </view>
  </view>
</template>
