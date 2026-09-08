<script setup lang="ts">
import type {
  ApiEnvelope,
  ApiPage,
  ConversationListItem,
  FileRecord,
  ProjectRecord,
} from '@/api/types'
import { aiApi } from '@/api/modules/ai'
import { fileApi } from '@/api/modules/files'
import { projectApi } from '@/api/modules/projects'
import { useAsyncResource } from '@/composables/useAsyncResource'
import { useAsyncSection } from '@/composables/useAsyncSection'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { ENTRY_SCENE } from '@/constants/aiScene'
import { useAssistantStore } from '@/store/assistant'

definePage({
  name: 'project-detail',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
  },
})

const route = useRoute()
const router = useRouter()
const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const { openAssistant } = useAssistantNavigation()
const globalDialog = useGlobalDialog()
const assistantStore = useAssistantStore()

const projectId = computed(() => String(route.query.id || ''))

const projectResource = useAsyncResource<ProjectRecord | null>(async () => {
  if (!projectId.value) {
    throw new Error('缺少项目 ID')
  }
  const response = await projectApi.getDetail(projectId.value).send() as ApiEnvelope<{ project: ProjectRecord }>
  return response.data?.project || null
}, null)

const project = projectResource.data
const projectStatus = projectResource.status

const fileSection = useAsyncSection<FileRecord>(async () => {
  const response = await fileApi.list({ projectId: projectId.value, page: 1, pageSize: 50 })
    .send() as ApiEnvelope<ApiPage<FileRecord>>
  return response.data?.items || []
})

const conversationTotal = ref(0)
const conversationSection = useAsyncSection<ConversationListItem>(async () => {
  const response = await aiApi.listConversations({
    projectId: projectId.value,
    clientApp: 'c_app',
    page: 1,
    pageSize: 10,
  }).send() as ApiEnvelope<ApiPage<ConversationListItem>>
  conversationTotal.value = response.data?.total || 0
  return response.data?.items || []
})

// 直接消费后端 projectResponse 附带的 canManage，避免与后端权限规则双轨漂移。
const canManage = computed(() => project.value?.canManage ?? false)

const files = fileSection.items
const fileStatus = fileSection.status
const conversations = conversationSection.items
const conversationStatus = conversationSection.status
const hasShown = ref(false)

const projectMeta = computed(() => {
  if (!project.value) {
    return ''
  }
  return [project.value.region, project.value.buildingType].filter(Boolean).join(' · ') || '地区与建筑类型待补充'
})

const readyFileCount = computed(() => files.value.filter(file => file.status === 'READY').length)
const activeFileCount = computed(() => files.value.filter(file =>
  ['UPLOADING', 'UPLOADED', 'QUEUED', 'PARSING', 'INDEXING'].includes(file.status),
).length)
const attentionFileCount = computed(() => files.value.filter(file =>
  file.status === 'OCR_REQUIRED' || file.status === 'FAILED',
).length)

const fileSummary = computed(() => {
  if (!files.value.length) {
    return canManage.value
      ? '还没有项目资料，上传后可用于 AI 项目检索'
      : '项目创建者还未上传项目资料'
  }
  const parts = [`${files.value.length} 份资料`, `${readyFileCount.value} 份已就绪`]
  if (activeFileCount.value) {
    parts.push(`${activeFileCount.value} 份处理中`)
  }
  if (attentionFileCount.value) {
    parts.push(`${attentionFileCount.value} 份需处理`)
  }
  return parts.join(' · ')
})

onMounted(() => {
  if (!requireLogin({ showToast: false })) {
    return
  }
  void loadPage()
})

// 首次由 onMounted 加载；从资料或 AI 页返回时静默同步项目资产。
onShow(() => {
  if (hasShown.value && project.value) {
    void refreshProjectAssets()
  }
  hasShown.value = true
})

async function loadPage() {
  await projectResource.load()
  if (!project.value) {
    return
  }
  // 后端允许公开项目可读者读取资料，这里对非管理者同样加载（只读展示）。
  await Promise.all([
    conversationSection.load(),
    fileSection.load(),
  ])
}

async function refreshProjectAssets() {
  await projectResource.refresh()
  if (!project.value) {
    return
  }
  await Promise.all([
    conversationSection.refresh(),
    fileSection.refresh(),
  ])
}

function goEdit() {
  if (!requireLogin() || !project.value || !canManage.value) {
    return
  }
  router.push({ name: 'project-edit', query: { id: project.value.id } })
}

function goFiles() {
  if (!requireLogin() || !project.value || !canManage.value) {
    return
  }
  router.push({
    name: 'project-files',
    params: { id: project.value.id, name: project.value.name },
  })
}

function openProjectAssistant() {
  if (!requireLogin() || !project.value) {
    return
  }

  const navigate = () => openAssistant({
    projectId: project.value!.id,
    projectName: project.value!.name,
    scene: ENTRY_SCENE.project,
  })

  if (assistantStore.isStreaming && assistantStore.projectId !== project.value.id) {
    globalDialog.confirm({
      title: '切换项目对话',
      msg: '当前回答仍在生成，切换项目将停止本次生成。',
      confirmButtonText: '停止并切换',
      cancelButtonText: '继续当前对话',
      success: navigate,
    })
    return
  }
  navigate()
}

function openConversation(conversation: ConversationListItem) {
  if (!requireLogin()) {
    return
  }

  const navigate = () => openAssistant({
    conversationId: conversation.id,
    projectName: project.value?.name,
  })

  if (assistantStore.isStreaming && assistantStore.conversationId !== conversation.id) {
    globalDialog.confirm({
      title: '切换项目对话',
      msg: '当前回答仍在生成，切换会话将停止本次生成。',
      confirmButtonText: '停止并切换',
      cancelButtonText: '继续当前对话',
      success: navigate,
    })
    return
  }
  navigate()
}

function conversationTitle(conversation: ConversationListItem) {
  return conversation.title?.trim() || conversation.lastMessage?.preview || '新建项目对话'
}

function conversationPreview(conversation: ConversationListItem) {
  if (!conversation.lastMessage) {
    return '尚未开始交流'
  }
  return conversation.lastMessage.role === 'ASSISTANT'
    ? `筑小格：${conversation.lastMessage.preview}`
    : `你：${conversation.lastMessage.preview}`
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function formatRelativeTime(value?: string | null) {
  if (!value) {
    return '刚刚创建'
  }
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) {
    return '最近更新'
  }
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000))
  if (minutes < 1) {
    return '刚刚'
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} 小时前`
  }
  const days = Math.floor(hours / 24)
  if (days < 7) {
    return `${days} 天前`
  }
  return formatDate(value)
}
</script>

<template>
  <view class="project-detail-page app-page app-page--immersive box-border min-h-screen">
    <wd-navbar
      custom-class="app-navbar"
      safe-area-inset-top
      left-arrow
      title="项目工作台"
      @click-left="goBack"
    />

    <view class="project-detail__body app-enter box-border px-4 pt-3">
      <view v-if="projectStatus === 'loading'" class="app-panel-flat flex items-center justify-center gap-2 py-16">
        <wd-loading size="32rpx" color="var(--app-action-primary)" />
        <text class="app-tertiary text-3">
          正在整理项目数据
        </text>
      </view>

      <view
        v-else-if="projectStatus === 'error' || !project"
        class="app-panel-flat flex flex-col items-center justify-center px-6 py-16 text-center"
      >
        <wd-icon name="warning" size="56rpx" color="var(--app-danger)" />
        <text class="mt-3 text-3.5 font-medium">
          项目加载失败
        </text>
        <text class="app-muted mt-1 text-2.5">
          请检查网络后重试
        </text>
        <wd-button size="small" plain custom-class="mt-4!" @click="loadPage">
          重新加载
        </wd-button>
      </view>

      <template v-else>
        <view class="project-hero relative overflow-hidden rounded-5 p-5">
          <view class="project-hero__mark" />
          <view class="relative z-1">
            <view class="flex items-center justify-between gap-3">
              <view class="project-hero__eyebrow">
                项目工作档案
              </view>
              <view
                class="shrink-0 rounded-full px-2.5 py-1 text-2.5 font-medium"
                :class="project.visibility === 'PUBLIC' ? 'app-state-active' : 'app-state-draft'"
              >
                {{ project.visibility === 'PUBLIC' ? '公开' : '私有' }}
              </view>
            </view>

            <view class="mt-5 text-6.5 font-bold leading-9">
              {{ project.name }}
            </view>
            <view class="app-muted mt-1.5 text-3 leading-5">
              {{ projectMeta }}
            </view>

            <view class="grid grid-cols-2 mt-6 gap-3">
              <view class="project-metric rounded-3 px-3.5 py-3">
                <view class="app-tertiary text-2.5">
                  项目资料
                </view>
                <view class="mt-1 text-4.5 font-bold">
                  {{ files.length }} 份
                </view>
              </view>
              <view class="project-metric rounded-3 px-3.5 py-3">
                <view class="app-tertiary text-2.5">
                  AI 对话
                </view>
                <view class="mt-1 text-4.5 font-bold">
                  {{ conversationTotal }} 次
                </view>
              </view>
            </view>
          </view>
        </view>

        <view class="mt-6 flex items-center justify-between px-1">
          <view>
            <view class="text-4 font-bold">
              项目档案
            </view>
            <view class="app-tertiary mt-0.5 text-2.5">
              AI 识别项目语境的基础信息
            </view>
          </view>
          <text
            v-if="canManage"
            class="app-primary-text app-pressable text-2.5 font-medium"
            @click="goEdit"
          >
            编辑
          </text>
          <view v-else class="app-tertiary text-2.5">
            创建于 {{ formatDate(project.createdAt) }}
          </view>
        </view>

        <view class="app-panel-flat mt-3 overflow-hidden">
          <view class="project-field flex items-start gap-4 px-4 py-3.5">
            <text class="app-tertiary w-18 shrink-0 text-3">
              所在地区
            </text>
            <text class="min-w-0 flex-1 text-right text-3 font-medium">
              {{ project.region || '待补充' }}
            </text>
          </view>
          <view class="project-field flex items-start gap-4 px-4 py-3.5">
            <text class="app-tertiary w-18 shrink-0 text-3">
              建筑类型
            </text>
            <text class="min-w-0 flex-1 text-right text-3 font-medium">
              {{ project.buildingType || '待补充' }}
            </text>
          </view>
          <view class="project-field flex items-start gap-4 px-4 py-3.5">
            <text class="app-tertiary w-18 shrink-0 text-3">
              更新时间
            </text>
            <text class="min-w-0 flex-1 text-right text-3 font-medium">
              {{ formatDate(project.updatedAt) }}
            </text>
          </view>
          <view v-if="project.description" class="project-field flex items-start gap-4 px-4 py-3.5">
            <text class="app-tertiary w-18 shrink-0 text-3">
              项目说明
            </text>
            <text class="min-w-0 flex-1 text-right text-3 font-medium leading-5.5">
              {{ project.description }}
            </text>
          </view>
        </view>

        <view class="mt-6 flex items-end justify-between px-1">
          <view>
            <view class="text-4 font-bold">
              项目资料
            </view>
            <view class="app-tertiary mt-0.5 text-2.5">
              {{ canManage ? '解析完成后可供项目 AI 检索引用' : '项目资料的解析与处理概况' }}
            </view>
          </view>
          <text
            v-if="canManage"
            class="app-primary-text app-pressable text-2.5 font-medium"
            @click="goFiles"
          >
            管理资料
          </text>
        </view>

        <view class="app-panel app-pressable mt-3 p-4" @click="goFiles">
          <view v-if="fileStatus === 'loading'" class="flex items-center gap-2 py-2">
            <wd-loading size="28rpx" color="var(--app-action-primary)" />
            <text class="app-muted text-3">
              正在统计项目资料
            </text>
          </view>
          <view v-else-if="fileStatus === 'error'" class="flex items-center justify-between gap-3">
            <view class="min-w-0 flex-1">
              <view class="text-3.5 font-semibold">
                资料加载失败
              </view>
              <view class="app-muted mt-1 text-2.5">
                不影响项目对话，可稍后重试
              </view>
            </view>
            <text class="app-primary-text shrink-0 text-2.5 font-medium" @click.stop="fileSection.load">
              重试
            </text>
          </view>
          <view v-else class="flex items-center gap-3">
            <view class="app-primary-text h-11 w-11 flex shrink-0 items-center justify-center rounded-3 bg-[var(--app-action-primary-soft)]">
              <text class="i-my-icons-project text-5" />
            </view>
            <view class="min-w-0 flex-1">
              <view class="text-3.5 font-semibold">
                {{ files.length ? '资料处理概况' : (canManage ? '上传第一份项目资料' : '暂无项目资料') }}
              </view>
              <view class="app-muted mt-1 text-2.5 leading-4.5">
                {{ fileSummary }}
              </view>
            </view>
            <wd-icon v-if="canManage" name="arrow-right" size="30rpx" color="var(--app-text-tertiary)" />
          </view>
        </view>

        <view class="mt-6 flex items-end justify-between px-1">
          <view>
            <view class="text-4 font-bold">
              项目对话
            </view>
            <view class="app-tertiary mt-0.5 text-2.5">
              围绕本项目持续讨论，结论不再散落
            </view>
          </view>
          <text v-if="conversationTotal" class="app-tertiary text-2.5">
            共 {{ conversationTotal }} 次
          </text>
        </view>

        <view v-if="conversationStatus === 'loading'" class="app-panel-flat mt-3 flex items-center justify-center gap-2 py-10">
          <wd-loading size="30rpx" color="var(--app-action-primary)" />
          <text class="app-muted text-3">
            正在同步项目对话
          </text>
        </view>

        <view v-else-if="conversationStatus === 'error'" class="app-panel-flat mt-3 px-4 py-7 text-center">
          <view class="text-3.5 font-semibold">
            对话记录加载失败
          </view>
          <view class="app-muted mt-1 text-2.5">
            你仍然可以发起新的项目对话
          </view>
          <wd-button size="small" plain custom-class="mt-4!" @click="conversationSection.load">
            重新加载
          </wd-button>
        </view>

        <view v-else-if="!conversations.length" class="project-conversation-empty mt-3 rounded-4 p-5">
          <view class="flex items-start gap-3">
            <view class="app-primary-text h-11 w-11 flex shrink-0 items-center justify-center rounded-3 bg-[var(--app-action-primary-soft)]">
              <text class="i-my-icons-conversation text-5" />
            </view>
            <view class="min-w-0 flex-1">
              <view class="text-4 font-bold">
                从项目问题开始
              </view>
              <view class="app-muted mt-1 text-2.5 leading-5">
                筑小格将把本次会话归档到「{{ project.name }}」，便于后续继续追问和回看。
              </view>
            </view>
          </view>
          <view class="app-primary-text app-pressable mt-4 flex items-center justify-center gap-1 rounded-3 bg-[var(--app-action-primary-soft)] py-3 text-3 font-semibold" @click="openProjectAssistant">
            开始项目对话
            <wd-icon name="arrow-right" size="28rpx" color="var(--app-action-primary)" />
          </view>
        </view>

        <view v-else class="app-panel-flat mt-3 overflow-hidden">
          <view
            v-for="conversation in conversations"
            :key="conversation.id"
            class="project-conversation app-pressable flex items-center gap-3 px-4 py-3.5"
            @click="openConversation(conversation)"
          >
            <view class="project-conversation__index h-9 w-9 flex shrink-0 items-center justify-center rounded-2 text-2.5 font-bold">
              AI
            </view>
            <view class="min-w-0 flex-1">
              <view class="flex items-center gap-2">
                <text class="min-w-0 flex-1 truncate text-3.5 font-semibold">
                  {{ conversationTitle(conversation) }}
                </text>
                <text v-if="conversation.isPinned" class="app-primary-text shrink-0 text-2.5">
                  置顶
                </text>
              </view>
              <view class="app-muted mt-1 truncate text-2.5">
                {{ conversationPreview(conversation) }}
              </view>
              <view class="app-tertiary mt-1.5 flex items-center gap-2 text-2.5">
                <text>{{ conversation.messageCount }} 条消息</text>
                <text>·</text>
                <text>{{ formatRelativeTime(conversation.lastMessage?.createdAt || conversation.updatedAt) }}</text>
              </view>
            </view>
            <wd-icon name="arrow-right" size="28rpx" color="var(--app-text-tertiary)" />
          </view>
        </view>
      </template>
    </view>

    <view v-if="project" class="project-detail__dock">
      <view class="project-detail__dock-inner">
        <wd-button type="primary" block @click="openProjectAssistant">
          <view class="flex items-center justify-center gap-2">
            <text class="i-my-icons-conversation text-4" />
            <text>与筑小格讨论此项目</text>
          </view>
        </wd-button>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.project-detail-page {
  background: var(--app-project-page-gradient);
}

.project-detail__body {
  width: 100%;
  max-width: 750px;
  min-height: calc(100vh - 88rpx);
  margin: 0 auto;
  padding-bottom: calc(196rpx + env(safe-area-inset-bottom));
}

.project-hero {
  border: 1px solid var(--app-border-default);
  background: var(--app-bg-surface);
  box-shadow: var(--app-shadow-card);
}

.project-hero__mark {
  position: absolute;
  top: -84rpx;
  right: -72rpx;
  width: 260rpx;
  height: 260rpx;
  border: 36rpx solid var(--app-action-primary-soft);
  border-radius: 50%;
  opacity: 0.72;
}

.project-hero__eyebrow {
  color: var(--app-action-primary);
  font-size: 22rpx;
  font-weight: 700;
  letter-spacing: 4rpx;
}

.project-metric,
.project-conversation-empty {
  border: 1px solid var(--app-border-default);
  background: var(--app-bg-drawer);
}

.project-field,
.project-conversation {
  border-bottom: 1px solid var(--app-border-default);
}

.project-field:last-child,
.project-conversation:last-child {
  border-bottom: 0;
}

.project-conversation__index {
  color: var(--app-action-primary);
  background: var(--app-action-primary-soft);
}

.project-detail__dock {
  position: fixed;
  z-index: 100;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 20rpx 32rpx calc(20rpx + env(safe-area-inset-bottom));
  border-top: 1px solid var(--app-border-default);
  background: var(--app-bg-surface);
  box-shadow: var(--app-shadow-dock);
}

.project-detail__dock-inner {
  width: 100%;
  max-width: 686px;
  margin: 0 auto;
}
</style>
