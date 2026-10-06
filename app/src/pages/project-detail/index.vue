<script setup lang="ts">
import type {
  ApiEnvelope,
  ApiPage,
  ConversationListItem,
  MyReportItem,
  ProjectRecord,
} from '@/api/types'
import { aiApi } from '@/api/modules/ai'
import { projectApi } from '@/api/modules/projects'
import { reportApi } from '@/api/modules/reports'
import ProjectVisibilityBadge from '@/components/project/ProjectVisibilityBadge.vue'
import ReportListCard from '@/components/report/ReportListCard.vue'
import { useAsyncResource } from '@/composables/useAsyncResource'
import { useAsyncSection } from '@/composables/useAsyncSection'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { useSelectableDepartments } from '@/composables/useSelectableDepartments'
import { useAssistantStore } from '@/store/assistant'
import { projectVisibilityLabel } from '@/utils/projectVisibility'

definePage({
  name: 'project-detail',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    enablePullDownRefresh: true,
  },
})

const REPORT_PREVIEW_SIZE = 3
const CONVERSATION_PREVIEW_SIZE = 5

const route = useRoute()
const router = useRouter()
const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const { openAssistant } = useAssistantNavigation()
const globalDialog = useGlobalDialog()
const { success: showSuccess, error: showError } = useGlobalToast()
const globalLoading = useGlobalLoading()
const assistantStore = useAssistantStore()
const { load: loadDepartments, nameOf } = useSelectableDepartments()
const deleting = ref(false)

function routeText(value: unknown) {
  if (Array.isArray(value)) {
    return String(value[0] || '')
  }
  return String(value || '')
}

// @wot-ui/router 命名跳转只把 params 写入 URL，落地后两边都能读到 id。
const projectId = computed(() => routeText(route.query.id) || routeText(route.params.id))

const projectResource = useAsyncResource<ProjectRecord | null>(async () => {
  if (!projectId.value) {
    throw new Error('缺少项目 ID')
  }
  const response = await projectApi.getDetail(projectId.value).send() as ApiEnvelope<{ project: ProjectRecord }>
  return response.data?.project || null
}, null)

const project = projectResource.data
const projectStatus = projectResource.status

const conversationTotal = ref(0)
const reportTotal = ref(0)
const conversationSection = useAsyncSection<ConversationListItem>(async () => {
  const response = await aiApi.listConversations({
    projectId: projectId.value,
    clientApp: 'c_app',
    page: 1,
    pageSize: CONVERSATION_PREVIEW_SIZE,
  }).send() as ApiEnvelope<ApiPage<ConversationListItem>>
  conversationTotal.value = response.data?.total || 0
  return response.data?.items || []
})

const reportSection = useAsyncSection<MyReportItem>(async () => {
  const response = await reportApi.listMy({
    projectId: projectId.value,
    page: 1,
    pageSize: REPORT_PREVIEW_SIZE,
  }).send() as ApiEnvelope<ApiPage<MyReportItem>>
  reportTotal.value = response.data?.total || 0
  return response.data?.items || []
})

const canManage = computed(() => project.value?.canManage ?? false)
const conversations = conversationSection.items
const conversationStatus = conversationSection.status
const reports = reportSection.items
const reportStatus = reportSection.status
const hasShown = ref(false)

const navbarTitle = computed(() => project.value?.name || '项目详情')
const projectMeta = computed(() => {
  if (!project.value) {
    return ''
  }
  return [project.value.region, project.value.buildingType].filter(Boolean).join(' · ') || '地区与建筑类型待补充'
})
const canViewAllReports = computed(() => reportTotal.value > reports.value.length)
const canViewAllConversations = computed(() => conversationTotal.value > conversations.value.length)
const hasBoundAssets = computed(() => conversationTotal.value > 0 || reportTotal.value > 0)
const assetsReady = computed(() =>
  (reportStatus.value === 'success' || reportStatus.value === 'error')
  && (conversationStatus.value === 'success' || conversationStatus.value === 'error'),
)
const visibilityText = computed(() => projectVisibilityLabel(project.value?.visibility))
const departmentName = computed(() => nameOf(project.value?.visibleDepartmentId, project.value?.visibleDepartmentName))

const activeTab = ref(0)
const moreVisible = ref(false)
const moreActions = [
  { name: '编辑项目' },
  { name: '删除项目', color: 'var(--app-project-danger)' },
]
const reportTabTitle = computed(() => (reportStatus.value === 'success' ? `报告 ${reportTotal.value}` : '报告'))
const conversationTabTitle = computed(() => (conversationStatus.value === 'success' ? `对话 ${conversationTotal.value}` : '对话'))

function handleMoreSelect({ index }: { index: number }) {
  if (index === 0) {
    goEdit()
  }
  else {
    confirmDelete()
  }
}

onMounted(() => {
  if (!requireLogin({ showToast: false })) {
    return
  }
  void loadDepartments()
  void loadPage()
})

watch(projectId, (id, prev) => {
  if (!id || id === prev) {
    return
  }
  conversationTotal.value = 0
  reportTotal.value = 0
  conversationSection.reset()
  reportSection.reset()
  void loadPage()
})

// 首次由 onMounted 加载；从编辑、报告或 AI 页返回时静默同步。
onShow(() => {
  if (hasShown.value && project.value?.id === projectId.value) {
    void refreshProjectAssets()
  }
  hasShown.value = true
})

onPullDownRefresh(async () => {
  if (requireLogin({ showToast: false })) {
    await refreshProjectAssets()
  }
  uni.stopPullDownRefresh()
})

async function loadPage() {
  await projectResource.load()
  if (!project.value) {
    return
  }
  await Promise.all([
    conversationSection.load(),
    reportSection.load(),
  ])
}

async function refreshProjectAssets() {
  await projectResource.refresh()
  if (!project.value) {
    return
  }
  await Promise.all([
    conversationSection.refresh(),
    reportSection.refresh(),
  ])
}

function openEditForm() {
  if (!project.value) {
    return
  }
  router.push({ name: 'project-create', params: { id: project.value.id } })
}

function goEdit() {
  if (!requireLogin() || !project.value || !canManage.value) {
    return
  }
  if (!assetsReady.value) {
    showError('项目数据仍在加载，请稍后再试')
    return
  }
  if (!hasBoundAssets.value) {
    openEditForm()
    return
  }
  globalDialog.confirm({
    title: '编辑项目信息',
    msg: `该项目已有 ${conversationTotal.value} 次对话、${reportTotal.value} 份报告。修改地区或建筑类型可能影响后续 AI 语境，确定继续？`,
    confirmButtonText: '继续编辑',
    cancelButtonText: '取消',
    success: openEditForm,
  })
}

function confirmDelete() {
  if (!requireLogin() || !project.value || !canManage.value || deleting.value) {
    return
  }
  if (!assetsReady.value) {
    showError('项目数据仍在加载，请稍后再试')
    return
  }

  const name = project.value.name
  if (!hasBoundAssets.value) {
    globalDialog.confirm({
      title: '删除项目',
      msg: `确定删除「${name}」？删除后无法恢复。`,
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonProps: { type: 'danger' },
      success: () => {
        void deleteProject()
      },
    })
    return
  }

  globalDialog.confirm({
    title: '删除项目',
    msg: `该项目已有 ${conversationTotal.value} 次对话、${reportTotal.value} 份报告。删除项目不会删除这些记录，但它们将失去项目归属。`,
    confirmButtonText: '仍要删除',
    cancelButtonText: '取消',
    confirmButtonProps: { type: 'danger' },
    success: () => {
      void deleteProject()
    },
  })
}

async function deleteProject() {
  if (!project.value || deleting.value) {
    return
  }
  deleting.value = true
  globalLoading.loading('正在删除项目...')
  try {
    await projectApi.remove(project.value.id).send()
    showSuccess('项目已删除')
    goBack()
  }
  catch (error) {
    showError(error instanceof Error ? error.message : '删除失败，请重试')
  }
  finally {
    deleting.value = false
    globalLoading.close()
  }
}

function goReports() {
  if (!requireLogin() || !project.value) {
    return
  }
  router.push({
    name: 'reports',
    params: { projectId: project.value.id },
  })
}

function goConversations() {
  if (!requireLogin() || !project.value) {
    return
  }
  router.push({
    name: 'conversation-history',
    params: { projectId: project.value.id },
  })
}

function openReport(item: MyReportItem) {
  if (!requireLogin()) {
    return
  }
  router.push({ name: 'report-detail', params: { id: item.id } })
}

function openLinkedProject(id: string) {
  if (!id || id === projectId.value) {
    return
  }
  router.push({ name: 'project-detail', params: { id } })
}

function confirmSwitch(title: string, onConfirm: () => void) {
  globalDialog.confirm({
    title,
    msg: '当前回答仍在生成，切换后将停止本次生成。',
    confirmButtonText: '停止并切换',
    cancelButtonText: '继续当前对话',
    success: onConfirm,
  })
}

function openProjectAssistant() {
  if (!requireLogin() || !project.value) {
    return
  }

  const navigate = () => openAssistant({
    projectId: project.value!.id,
    projectName: project.value!.name,
  })

  if (assistantStore.isStreaming && assistantStore.projectId !== project.value.id) {
    confirmSwitch('切换项目对话', navigate)
    return
  }
  navigate()
}

function startNewProjectConversation() {
  if (!requireLogin() || !project.value) {
    return
  }

  const navigate = () => openAssistant({
    projectId: project.value!.id,
    projectName: project.value!.name,
    startNew: true,
  })

  if (assistantStore.isStreaming) {
    confirmSwitch('新建项目对话', navigate)
    return
  }
  navigate()
}

function openProjectMemory() {
  if (!requireLogin() || !project.value) {
    return
  }
  router.push({
    name: 'project-memory',
    params: { projectId: project.value.id },
  })
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
    confirmSwitch('切换项目对话', navigate)
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
      placeholder
      fixed
      :title="navbarTitle"
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
          {{ projectId ? '请检查网络后重试' : '缺少项目信息，请从项目列表重新进入' }}
        </text>
        <wd-button v-if="projectId" size="small" plain custom-class="mt-4!" @click="loadPage">
          重新加载
        </wd-button>
      </view>

      <template v-else>
        <view class="project-header app-panel-flat flex items-start gap-3 px-4 py-4">
          <view class="min-w-0 flex-1">
            <view class="flex items-center gap-2">
              <text class="min-w-0 flex-1 truncate text-4.5 font-bold leading-7">
                {{ project.name }}
              </text>
              <ProjectVisibilityBadge
                class="shrink-0"
                :visibility="project.visibility"
                :department-name="departmentName"
                :include-child-departments="project.includeChildDepartments"
              />
            </view>
            <view class="app-tertiary mt-1.5 text-2.5 leading-4.5">
              {{ projectMeta }}
            </view>
            <view class="app-tertiary mt-1 text-2.5">
              更新于 {{ formatDate(project.updatedAt) }}
            </view>
          </view>
          <view
            v-if="canManage"
            class="app-pressable h-8 w-8 flex shrink-0 items-center justify-center -mr-2"
            aria-label="更多"
            @click="moreVisible = true"
          >
            <wd-icon name="more" size="36rpx" color="var(--app-text-secondary)" />
          </view>
        </view>

        <view class="project-tabs app-panel-flat mt-3 overflow-hidden">
          <wd-tabs v-model="activeTab">
            <wd-tab title="档案">
              <view class="py-1">
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
                    创建时间
                  </text>
                  <text class="min-w-0 flex-1 text-right text-3 font-medium">
                    {{ formatDate(project.createdAt) }}
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
                <view class="project-field project-field--block px-4 py-3.5">
                  <text class="app-tertiary block text-3">
                    项目说明
                  </text>
                  <text class="mt-1.5 block text-3 font-medium leading-5.5">
                    {{ project.description || '待补充' }}
                  </text>
                </view>
                <view class="project-field flex items-start justify-between gap-3 px-4 py-3.5">
                  <view class="min-w-0">
                    <view class="text-3 font-medium">
                      可见范围
                    </view>
                    <view class="app-tertiary mt-0.5 text-2.5">
                      {{ visibilityText }}
                      <template v-if="project.visibility === 'DEPARTMENT' && departmentName">
                        · {{ departmentName }}
                      </template>
                      <template v-if="project.visibility === 'DEPARTMENT' && project.includeChildDepartments !== false">
                        · 包含下级部门
                      </template>
                    </view>
                  </view>
                  <text
                    v-if="canManage"
                    class="app-primary-text app-pressable shrink-0 text-2.5"
                    @click="goEdit"
                  >
                    修改
                  </text>
                  <text v-else class="app-tertiary shrink-0 text-2.5">
                    只读
                  </text>
                </view>
              </view>
            </wd-tab>

            <wd-tab :title="reportTabTitle">
              <view class="px-4 pb-4 pt-3">
                <view v-if="reportTotal" class="mb-3 flex items-center justify-between">
                  <text class="app-tertiary text-2.5">
                    仅展示本项目报告
                  </text>
                  <text class="app-primary-text app-pressable shrink-0 text-2.5" @click="goReports">
                    {{ canViewAllReports ? `全部 ${reportTotal}` : `${reportTotal} 份` }}
                  </text>
                </view>

                <view v-if="reportStatus === 'loading'" class="flex items-center justify-center gap-2 py-10">
                  <wd-loading size="30rpx" color="var(--app-action-primary)" />
                  <text class="app-muted text-3">
                    正在加载项目报告
                  </text>
                </view>

                <view v-else-if="reportStatus === 'error'" class="py-7 text-center">
                  <view class="text-3.5 font-semibold">
                    报告加载失败
                  </view>
                  <view class="app-muted mt-1 text-2.5">
                    不影响项目对话，可稍后重试
                  </view>
                  <wd-button size="small" plain custom-class="mt-4!" @click="reportSection.load">
                    重新加载
                  </wd-button>
                </view>

                <view v-else-if="!reports.length" class="py-7 text-center">
                  <view class="text-3.5 font-semibold">
                    还没有项目报告
                  </view>
                  <view class="app-muted mt-1 text-2.5">
                    在项目对话中生成报告后，会自动归属到本项目
                  </view>
                  <view
                    class="app-primary-text app-pressable mt-4 inline-flex items-center justify-center gap-1 rounded-3 bg-[var(--app-action-primary-soft)] px-4 py-2.5 text-3 font-semibold"
                    @click="openProjectAssistant"
                  >
                    去项目对话生成
                    <wd-icon name="arrow-right" size="26rpx" color="var(--app-action-primary)" />
                  </view>
                </view>

                <view v-else>
                  <ReportListCard
                    v-for="item in reports"
                    :key="item.id"
                    :item="item"
                    hide-project
                    @open="openReport"
                    @open-project="openLinkedProject"
                  />
                </view>
              </view>
            </wd-tab>

            <wd-tab :title="conversationTabTitle">
              <view class="px-4 pb-4 pt-3">
                <view class="mb-3 flex items-center justify-between gap-2">
                  <text class="app-tertiary min-w-0 flex-1 text-2.5">
                    历史对话是原始聊天记录，项目记忆是跨对话共享的已确认事实
                  </text>
                  <text class="app-primary-text app-pressable shrink-0 text-2.5" @click="openProjectMemory">
                    项目记忆
                  </text>
                </view>

                <view v-if="conversationStatus === 'loading'" class="flex items-center justify-center gap-2 py-10">
                  <wd-loading size="30rpx" color="var(--app-action-primary)" />
                  <text class="app-muted text-3">
                    正在同步项目对话
                  </text>
                </view>

                <view v-else-if="conversationStatus === 'error'" class="py-7 text-center">
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

                <view v-else-if="!conversations.length" class="project-conversation-empty rounded-4 p-5">
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

                <view v-else class="overflow-hidden">
                  <view v-if="conversationTotal" class="mb-1 flex items-center justify-between">
                    <text class="app-tertiary text-2.5">
                      最近项目对话
                    </text>
                    <text class="app-primary-text app-pressable shrink-0 text-2.5" @click="goConversations">
                      {{ canViewAllConversations ? `历史对话 ${conversationTotal}` : `历史对话 ${conversationTotal}` }}
                    </text>
                  </view>
                  <view
                    v-for="conversation in conversations"
                    :key="conversation.id"
                    class="project-conversation app-pressable flex items-center gap-3 py-3.5"
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
              </view>
            </wd-tab>
          </wd-tabs>
        </view>
      </template>
    </view>

    <wd-action-sheet
      v-model="moreVisible"
      :actions="moreActions"
      cancel-text="取消"
      :z-index="2000"
      @select="handleMoreSelect"
    />

    <view v-if="project" class="project-detail__dock">
      <view class="project-detail__dock-inner">
        <wd-button type="primary" block @click="openProjectAssistant">
          <view class="flex items-center justify-center gap-2">
            <text class="i-my-icons-conversation text-4" />
            <text>{{ conversationTotal ? '继续最近对话' : '开始项目对话' }}</text>
          </view>
        </wd-button>
        <view class="project-detail__actions mt-2 flex items-center justify-between">
          <text class="app-pressable px-2 py-2 text-2.5" @click="startNewProjectConversation">
            新建对话
          </text>
          <text class="app-pressable px-2 py-2 text-2.5" @click="goConversations">
            历史对话
          </text>
          <text class="app-pressable px-2 py-2 text-2.5" @click="openProjectMemory">
            项目记忆
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.project-detail-page {
  background: var(--app-bg-canvas);
}

.project-detail__body {
  width: 100%;
  max-width: 750px;
  margin: 0 auto;
  padding-bottom: calc(260rpx + env(safe-area-inset-bottom));
}

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

.project-detail__actions {
  color: var(--app-text-secondary);
}
</style>
