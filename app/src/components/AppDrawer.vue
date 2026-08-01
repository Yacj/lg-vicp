<script setup lang="ts">
import type { ProjectRecord } from '@/api/types'
import { getAppVersion } from '@/services/platform'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'select': [key: DrawerEntry, id?: string]
}>()

type DrawerEntry = 'projects' | 'public-projects' | 'project-detail' | 'create-project' | 'assistant' | 'profile' | 'login'
type DrawerTab = 'tasks' | 'projects'
type ProjectScope = 'mine' | 'public'

const drawerItems = [
  { key: 'mine', label: '我的项目', icon: 'home' },
  { key: 'public', label: '公开项目', icon: 'public' },
] as const

const authStore = useAuthStore()
const { requireLogin } = useAuthGate()
const {
  myProjects,
  publicProjects,
  conversations,
  loadAll,
  loadPublicProjects,
  resetPrivateData,
} = useDrawerData()

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const activeTab = ref<DrawerTab>('tasks')
const projectScope = ref<ProjectScope>('mine')
const platformVersion = ref('1.0.0')
const currentUser = computed(() => authStore.user)
const isAuthenticated = computed(() => authStore.isAuthenticated)
const displayName = computed(() => currentUser.value?.displayName || '访客用户')
const avatarText = computed(() => displayName.value.slice(0, 1))
const accountLabel = computed(() => {
  if (!isAuthenticated.value) {
    return '登录后查看项目与对话'
  }

  return maskPhone(currentUser.value?.phone) || '已登录工作空间'
})
const selectedProjects = computed(() => projectScope.value === 'mine' ? myProjects.value : publicProjects.value)

function selectedState(scope: ProjectScope) {
  return scope === 'mine' ? myProjects.value : publicProjects.value
}

watch([visible, isAuthenticated], ([isVisible, loggedIn]) => {
  if (!isVisible) {
    if (!loggedIn) {
      resetPrivateData()
    }
    return
  }

  if (loggedIn) {
    void loadAll()
  }
  else {
    resetPrivateData()
    void loadPublicProjects()
  }
}, { immediate: true })

onMounted(() => {
  platformVersion.value = getAppVersion()
})

function maskPhone(phone?: string | null) {
  if (!phone) {
    return ''
  }
  if (phone.length < 7) {
    return phone
  }
  return `${phone.slice(0, 3)} **** ${phone.slice(-4)}`
}

function selectProjectScope(scope: ProjectScope) {
  projectScope.value = scope
  if (scope === 'mine') {
    if (!isAuthenticated.value) {
      openLogin()
      return
    }
    openProjects('mine')
    return
  }
  void loadPublicProjects()
}

function openProjectScope(scope: ProjectScope) {
  openProjects(scope)
}

function openLogin() {
  visible.value = false
  requireLogin({ showToast: false })
}

function handleProfileClick() {
  if (!isAuthenticated.value) {
    openLogin()
    return
  }
  selectEntry('profile')
}

function handleGuestClick() {
  openLogin()
}

function selectEntry(key: DrawerEntry, id?: string) {
  if (key === 'login') {
    openLogin()
    return
  }
  emit('select', key, id)
}

function openProjects(scope: ProjectScope) {
  selectEntry(scope === 'mine' ? 'projects' : 'public-projects')
}

function openProject(project: ProjectRecord) {
  selectEntry('project-detail', project.id)
}

function openConversation(id: string) {
  selectEntry('assistant', id)
}

function createTask() {
  if (!requireLogin()) {
    return
  }
  selectEntry('assistant')
}

function getConversationMeta(conversation: { status: string }) {
  const status = conversation.status.toUpperCase()
  if (['FAILED', 'ERROR'].includes(status)) {
    return { label: '待复核', tone: 'warning', icon: 'warning' }
  }
  if (['COMPLETED', 'DONE', 'SUCCESS'].includes(status)) {
    return { label: '已完成', tone: 'success', icon: 'check' }
  }
  if (['PENDING', 'PROCESSING', 'STREAMING'].includes(status)) {
    return { label: '计算中', tone: 'processing', icon: 'time' }
  }
  return { label: '草稿', tone: 'draft', icon: 'edit' }
}

function projectName(projectId: string | null) {
  if (!projectId) {
    return '通用对话'
  }
  const project = [...myProjects.value.items, ...publicProjects.value.items].find(item => item.id === projectId)
  return project?.name || '项目对话'
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '刚刚'
  }
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()
  return isToday
    ? `今天 ${date.toTimeString().slice(0, 5)}`
    : `${date.getMonth() + 1}月${date.getDate()}日`
}

function retryData() {
  void loadAll()
}
</script>

<template>
  <wd-popup
    v-model="visible"
    position="left"
    lock-scroll
    root-portal
    custom-class="app-drawer-popup"
    custom-style="width: 80vw; max-width: 390px; height: 100vh; height: 100dvh;"
  >
    <view class="app-drawer box-border h-full flex flex-col">
      <view class="app-drawer__header mb-5 mt-3 shrink-0">
        <view class="app-drawer__status-space" />
        <view class="app-drawer__profile flex items-center" @click="handleProfileClick">
          <wd-avatar
            v-if="isAuthenticated"
            :text="avatarText"
            size="104rpx"
            shape="round"
            bg-color="var(--app-action-primary)"
            color="var(--app-text-inverse)"
          />
          <wd-avatar
            v-else
            icon="user"
            size="104rpx"
            shape="round"
            bg-color="var(--app-action-primary-soft)"
            color="var(--app-action-primary)"
          />
          <view class="ml-3 min-w-0 flex-1">
            <view class="truncate text-3.5 font-bold leading-5">
              {{ displayName }}
            </view>
            <view class="app-muted mt-0.5 truncate text-2.5">
              {{ accountLabel }}
            </view>
          </view>
          <!-- <view class="app-drawer__theme flex shrink-0 items-center justify-center rounded-full" aria-label="切换主题" @click="toggleTheme()">
            <wd-icon :name="isDark ? 'moon-fill' : 'sun-fill'" size="38rpx" color="var(--app-text-primary)" />
          </view> -->
        </view>
      </view>

      <view class="app-drawer__body min-h-0 flex-1">
        <view v-if="activeTab === 'tasks'" class="app-drawer__content">
          <view class="app-drawer__section flex items-center justify-between">
            <text class="app-muted text-[27rpx] font-bold">
              项目
            </text>
            <text class="app-primary-text text-[23rpx]" @click="openProjects('mine')">
              管理
            </text>
          </view>
          <view class="app-drawer__project-links mt-3">
            <view v-for="item in drawerItems" :key="item.key" class="app-drawer__project-link mb-1 flex items-center" @click="openProjectScope(item.key)">
              <view class="app-drawer__project-icon flex shrink-0 items-center justify-center">
                <wd-icon :name="item.icon" size="38rpx" />
              </view>
              <text class="flex-1 text-[25rpx] font-medium">
                {{ item.label }}
              </text>
              <text v-if="selectedState(item.key).status === 'loading'" class="app-drawer__count app-tertiary text-3">
                …
              </text>
              <text v-else class="app-drawer__count app-muted text-3">
                {{ selectedState(item.key).total }}
              </text>
            </view>
          </view>
          <view class="app-drawer__section mt-3 flex items-center justify-between">
            <text class="app-muted text-[27rpx] font-bold">
              最近任务
            </text>
            <text class="app-primary-text text-[23rpx]" @click="activeTab = 'tasks'">
              编辑
            </text>
          </view>
          <view v-if="isAuthenticated" class="app-drawer__new-task flex items-center rounded-3" @click="createTask">
            <view class="app-drawer__new-task-icon flex items-center justify-center rounded-full">
              <wd-icon name="plus" size="28rpx" color="var(--app-action-primary)" />
            </view>
            <text class="app-primary-text ml-1 text-29rpx font-medium">
              新建任务
            </text>
          </view>

          <view v-if="conversations.status === 'loading'" class="app-drawer__state app-muted">
            <wd-loading size="38rpx" color="var(--app-action-primary)" />
            <text class="mt-2">
              正在加载最近任务
            </text>
          </view>
          <view v-else-if="!isAuthenticated" class="app-drawer__guest-empty" @click="handleGuestClick">
            <wd-empty tip="登录后查看最近任务" icon-size="120rpx" custom-class="app-drawer__empty" />
          </view>
          <view v-else-if="conversations.status === 'error'" class="app-drawer__state app-danger-text" @click="retryData">
            <wd-empty icon="no-result" tip="最近任务加载失败，点击重试" icon-size="120rpx" custom-class="app-drawer__empty"/>
          </view>
          <wd-empty v-else-if="conversations.status === 'success' && !conversations.items.length" icon-size="120rpx" tip="暂无对话，开始一次 AI 对话" custom-class="app-drawer__empty "  class="mt-6"/>
          <view v-else class="app-drawer__tasks">
            <view v-for="conversation in conversations.items" :key="conversation.id" class="app-drawer__task flex items-center" @click="openConversation(conversation.id)">
              <view class="app-drawer__task-icon flex shrink-0 items-center justify-center rounded-xl" :class="`app-drawer__task-icon--${getConversationMeta(conversation).tone}`">
                <wd-icon :name="getConversationMeta(conversation).icon" size="40rpx" color="var(--app-action-primary)" />
              </view>
              <view class="ml-3 min-w-0 flex-1">
                <text class="block truncate text-3 font-bold">
                  {{ conversation.title || '未命名对话' }}
                </text>
                <text class="app-muted mt-0.5 block truncate text-2.5">
                  {{ formatTime(conversation.updatedAt) }} · {{ projectName(conversation.projectId) }}
                </text>
              </view>
              <wd-icon name="more" size="36rpx" color="var(--app-text-secondary)" />
            </view>
          </view>
        </view>

        <view v-else class="app-drawer__content">
          <view class="app-drawer__section flex items-center justify-between">
            <text class="app-muted text-2.5 font-bold">
              项目列表
            </text>
            <text class="app-primary-text text-2.5" @click="selectEntry('create-project')">
              新建
            </text>
          </view>
          <view class="app-drawer__scope-tabs flex rounded-2 p-1">
            <view class="flex-1 rounded-1.5 py-1.5 text-center text-2.5" :class="projectScope === 'mine' ? 'app-drawer__scope-tab--active' : 'app-muted'" @click="selectProjectScope('mine')">
              我的项目
            </view>
            <view class="flex-1 rounded-1.5 py-1.5 text-center text-2.5" :class="projectScope === 'public' ? 'app-drawer__scope-tab--active' : 'app-muted'" @click="selectProjectScope('public')">
              公开项目
            </view>
          </view>
          <wd-empty v-if="projectScope === 'mine' && !isAuthenticated" icon="user" icon-size="22" tip="登录后查看我的项目" custom-class="app-drawer__empty">
            <template #bottom>
              <wd-button type="primary" size="small" custom-class="mt-1!" @click="selectEntry('login')">
                去登录
              </wd-button>
            </template>
          </wd-empty>
          <view v-else-if="selectedProjects.status === 'loading'" class="app-drawer__state app-muted">
            <wd-loading size="48rpx" color="var(--app-action-primary)" />
            <text class="mt-2">
              正在加载项目
            </text>
          </view>
          <view v-else-if="selectedProjects.status === 'error'" class="app-drawer__state app-danger-text" @click="retryData">
            <wd-empty icon="warning" icon-size="24" tip="项目加载失败，点击重试" custom-class="app-drawer__empty" />
          </view>
          <wd-empty v-else-if="selectedProjects.status === 'success' && !selectedProjects.items.length" icon="folder" icon-size="24" :tip="projectScope === 'mine' ? '还没有项目，创建第一个项目' : '暂无公开项目'" custom-class="app-drawer__empty">
            <template #bottom>
              <wd-button v-if="projectScope === 'mine'" type="primary" size="small" custom-class="mt-2!" @click="selectEntry('create-project')">
                新建项目
              </wd-button>
            </template>
          </wd-empty>
          <view v-else class="app-drawer__project-list">
            <view v-for="project in selectedProjects.items" :key="project.id" class="app-drawer__project-card" @click="openProject(project)">
              <view class="flex items-start justify-between gap-2">
                <text class="min-w-0 flex-1 truncate text-3 font-bold">
                  {{ project.name }}
                </text>
                <wd-icon name="arrow-right" size="30rpx" color="var(--app-text-tertiary)" />
              </view>
              <text class="app-muted mt-1 block truncate text-2.5">
                {{ project.region || '未填写地区' }} · {{ project.buildingType || '未填写建筑类型' }}
              </text>
              <text class="app-tertiary mt-2 block text-2.5">
                更新于 {{ formatTime(project.updatedAt) }}
              </text>
            </view>
          </view>
        </view>
      </view>

      <view class="app-drawer__footer shrink-0">
        <text class="app-tertiary block text-center text-2.5">
          VICP · v{{ platformVersion }} · 蓝格智配
        </text>
      </view>
    </view>
  </wd-popup>
</template>

<style lang="scss" scoped>
.app-drawer {
  min-height: 100vh;
  min-height: 100dvh;
  color: var(--app-text-primary);
  background: var(--app-bg-drawer);
  padding-bottom: env(safe-area-inset-bottom);
}

.app-drawer__header {
  padding: 0 40rpx 12rpx;
}

.app-drawer__status-space {
  height: max(20rpx, env(safe-area-inset-top));
}

.app-drawer__profile {
  min-height: 104rpx;
  cursor: pointer;
}

.app-drawer__guest-empty {
  cursor: pointer;
}

.app-drawer__avatar {
  box-shadow: 0 12rpx 28rpx rgba(47, 107, 255, 0.16);
}

:deep(.app-drawer__avatar .wd-avatar__text) {
  font-size: 44rpx;
}

.app-drawer__theme {
  width: 76rpx;
  height: 76rpx;
  background: var(--app-bg-soft);
}

.app-drawer__login {
  border: 1px solid var(--app-action-primary-soft);
  background: var(--app-bg-soft);
}

.app-drawer__tabs,
.app-drawer__scope-tabs {
  background: var(--app-bg-soft);
}

.app-drawer__tab,
.app-drawer__scope-tabs view {
  transition: background-color var(--app-transition-fast) ease, color var(--app-transition-fast) ease;
}

.app-drawer__tab--active {
  color: var(--app-action-primary);
  font-weight: 700;
  background: var(--app-bg-surface);
  box-shadow: 0 4rpx 16rpx rgba(47, 107, 255, 0.08);
}

.app-drawer__scope-tab--active {
  color: var(--app-action-primary);
  font-weight: 700;
  background: var(--app-bg-surface);
}

.app-drawer__body {
  overflow: hidden;
  padding: 0 25rpx;
}

.app-drawer__content {
  padding-bottom: 16rpx;
}

.app-drawer__section {
  min-height: 48rpx;
}

.app-drawer__project-links {
  margin-top: 10rpx;
}

.app-drawer__project-link {
  min-height: 84rpx;
}

.app-drawer__project-icon {
  width: 64rpx;
  height: 64rpx;
}

.app-drawer__project-icon--blue {
  background: var(--app-action-primary-soft);
}

.app-drawer__project-icon--cyan {
  background: var(--app-ai-soft);
}

.app-drawer__count {
  width: 48rpx;
  text-align: right;
}

.app-drawer__new-task {
  min-height: 84rpx;
  margin-top: 10rpx;
  padding: 0 24rpx;
  background: var(--app-bg-soft);
  border: 1px solid var(--app-border-default);
}

.app-drawer__new-task-icon {
  width: 54rpx;
  height: 54rpx;
}

.app-drawer__tasks,
.app-drawer__project-list {
  margin-top: 16rpx;
}

.app-drawer__task {
  min-height: 120rpx;
  padding: 10rpx 0;
}

.app-drawer__task-icon {
  width: 78rpx;
  height: 78rpx;
}

.app-drawer__task-icon--processing {
  background: var(--app-state-processing-bg);
}

.app-drawer__task-icon--success {
  background: var(--app-state-success-bg-soft);
}

.app-drawer__task-icon--warning {
  background: var(--app-state-warning-bg-soft);
}

.app-drawer__task-icon--draft {
  background: var(--app-state-draft-bg-soft);
}

.app-drawer__project-card {
  padding: 26rpx 28rpx;
  border: 1px solid var(--app-border-default);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-surface);
  box-shadow: 0 8rpx 28rpx rgba(20, 43, 69, 0.04);
}

.app-drawer__project-card + .app-drawer__project-card {
  margin-top: 20rpx;
}

.app-drawer__state {
  min-height: 152rpx;
  padding: 20rpx 16rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 26rpx;
}

:deep(.app-drawer__empty) {
  min-height: 152rpx;
  padding: 8rpx 0;
}

:deep(.app-drawer__empty .wd-empty__text) {
  margin-top: 12rpx;
  font-size: 24rpx;
  line-height: 36rpx;
}

.app-drawer__footer {
  padding: 12rpx 40rpx calc(14rpx + env(safe-area-inset-bottom));
  background: var(--app-bg-drawer);
}

@media (min-width: 500px) {
  .app-drawer__header,
  .app-drawer__body {
    padding-left: 48rpx;
    padding-right: 48rpx;
  }
}
</style>
