<script setup lang="ts">
import type { ApiEnvelope, ProjectMemoryItem, ProjectMemoryType, ProjectMemoryView, ProjectRecord } from '@/api/types'
import { projectApi } from '@/api/modules/projects'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'
import {
  CONFIRMED_MEMORY_ORDER,
  MEMORY_TYPE_LABELS,
  memoryStatusLabel,
} from '@/utils/aiAgentUi'

definePage({
  name: 'project-memory',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    enablePullDownRefresh: true,
  },
})

const VIEWS: Array<{ id: ProjectMemoryView, title: string }> = [
  { id: 'active', title: '已确认' },
  { id: 'pending', title: '待确认' },
  { id: 'history', title: '历史' },
]

const route = useRoute()
const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const { openAssistant } = useAssistantNavigation()
const { success: showSuccess, error: showError } = useGlobalToast()
const globalDialog = useGlobalDialog()
const globalLoading = useGlobalLoading()

function routeText(value: unknown) {
  if (Array.isArray(value)) {
    return String(value[0] || '')
  }
  return String(value || '')
}

const projectId = computed(() => routeText(route.query.projectId) || routeText(route.params.projectId) || routeText(route.query.id) || routeText(route.params.id))
const activeTab = ref(0)
const currentView = computed(() => VIEWS[activeTab.value]?.id || 'active')
const project = ref<ProjectRecord | null>(null)
const items = ref<ProjectMemoryItem[]>([])
const status = ref<'idle' | 'loading' | 'success' | 'error'>('loading')
const actingId = ref<string>()

const canManage = computed(() => project.value?.canManage ?? false)

const groupedConfirmed = computed(() => {
  const used = new Set<string>()
  const groups = CONFIRMED_MEMORY_ORDER
    .map((type) => {
      const groupItems = items.value.filter(item => item.memoryType === type)
      groupItems.forEach(item => used.add(item.id))
      return {
        type,
        title: MEMORY_TYPE_LABELS[type],
        items: groupItems,
      }
    })
    .filter(group => group.items.length)
  const rest = items.value.filter(item => !used.has(item.id))
  if (rest.length) {
    groups.push({
      type: 'ASSUMPTION',
      title: MEMORY_TYPE_LABELS.ASSUMPTION,
      items: rest,
    })
  }
  return groups
})

onMounted(() => {
  if (requireLogin({ showToast: false })) {
    void loadPage()
  }
})

watch(projectId, (id, prev) => {
  if (!id || id === prev) {
    return
  }
  void loadPage()
})

watch(currentView, () => {
  if (project.value?.id === projectId.value) {
    void loadMemories()
  }
})

onPullDownRefresh(async () => {
  if (requireLogin({ showToast: false })) {
    await loadPage()
  }
  uni.stopPullDownRefresh()
})

async function loadPage() {
  if (!projectId.value) {
    status.value = 'error'
    return
  }
  status.value = 'loading'
  try {
    const response = await projectApi.getDetail(projectId.value).send() as ApiEnvelope<{ project: ProjectRecord }>
    project.value = response.data.project
    await loadMemories()
  }
  catch {
    status.value = 'error'
  }
}

async function loadMemories() {
  if (!projectId.value) {
    return
  }
  status.value = items.value.length ? status.value : 'loading'
  try {
    const response = await projectApi.listAiMemories(projectId.value, currentView.value).send() as ApiEnvelope<{ items: ProjectMemoryItem[], view: ProjectMemoryView }>
    items.value = response.data.items || []
    status.value = 'success'
  }
  catch {
    status.value = 'error'
  }
}

function memoryTitle(item: ProjectMemoryItem) {
  return item.title?.trim() || MEMORY_TYPE_LABELS[item.memoryType as ProjectMemoryType] || '项目记忆'
}

async function confirmMemory(item: ProjectMemoryItem) {
  if (!canManage.value || actingId.value) {
    return
  }
  actingId.value = item.id
  try {
    await projectApi.confirmAiMemory(projectId.value, item.id).send()
    showSuccess('已确认')
    await loadMemories()
  }
  catch (error) {
    showError(error instanceof Error ? error.message : '确认失败')
  }
  finally {
    actingId.value = undefined
  }
}

function correctMemory(item: ProjectMemoryItem) {
  if (!canManage.value || actingId.value) {
    return
  }
  globalDialog.prompt({
    title: '纠正项目记忆',
    inputValue: item.content,
    inputProps: {
      maxlength: 400,
      clearable: true,
      placeholder: '请输入正确内容',
    },
    inputValidate(value) {
      return Boolean(String(value).trim()) || '内容不能为空'
    },
    confirmButtonText: '保存',
    cancelButtonText: '取消',
    success(result) {
      const content = String(result.value || '').trim()
      if (content) {
        void saveCorrection(item, content)
      }
    },
  })
}

async function saveCorrection(item: ProjectMemoryItem, content: string) {
  actingId.value = item.id
  globalLoading.loading('正在保存')
  try {
    await projectApi.updateAiMemory(projectId.value, item.id, { content }).send()
    if (item.status === 'PENDING') {
      await projectApi.confirmAiMemory(projectId.value, item.id).send()
    }
    showSuccess('已更新')
    await loadMemories()
  }
  catch (error) {
    showError(error instanceof Error ? error.message : '更新失败')
  }
  finally {
    actingId.value = undefined
    globalLoading.close()
  }
}

function rejectMemory(item: ProjectMemoryItem) {
  if (!canManage.value || actingId.value) {
    return
  }
  globalDialog.confirm({
    title: item.status === 'ACTIVE' ? '作废这条记忆' : '拒绝这条记忆',
    msg: '作废后不会再作为项目条件使用，可在历史中查看。',
    confirmButtonText: item.status === 'ACTIVE' ? '作废' : '拒绝',
    cancelButtonText: '取消',
    success: () => {
      void performReject(item)
    },
  })
}

async function performReject(item: ProjectMemoryItem) {
  actingId.value = item.id
  try {
    await projectApi.rejectAiMemory(projectId.value, item.id).send()
    showSuccess(item.status === 'ACTIVE' ? '已作废' : '已拒绝')
    await loadMemories()
  }
  catch (error) {
    showError(error instanceof Error ? error.message : '操作失败')
  }
  finally {
    actingId.value = undefined
  }
}

function openSourceConversation(item: ProjectMemoryItem) {
  if (!item.sourceConversationId) {
    showError('这条记忆没有可查看的来源对话')
    return
  }
  openAssistant({
    conversationId: item.sourceConversationId,
    projectName: project.value?.name,
  })
}
</script>

<template>
  <view class="app-page app-page--immersive min-h-screen">
    <wd-navbar
      custom-class="app-navbar"
      safe-area-inset-top
      left-arrow
      placeholder
      fixed
      title="项目记忆"
      @click-left="goBack"
    />

    <view class="memory-page app-enter box-border px-4 pb-8 pt-3">
      <view class="app-muted mb-3 text-2.5 leading-4.5">
        项目记忆是跨对话共享的已确认事实和方案决定，与原始聊天记录不同。
      </view>

      <wd-tabs v-model="activeTab">
        <wd-tab v-for="view in VIEWS" :key="view.id" :title="view.title">
          <view />
        </wd-tab>
      </wd-tabs>

      <view v-if="status === 'loading'" class="flex flex-col items-center justify-center py-16">
        <wd-loading size="44rpx" color="var(--app-action-primary)" />
        <text class="app-muted mt-3 text-3">
          正在加载项目记忆
        </text>
      </view>

      <view v-else-if="status === 'error'" class="py-10 text-center">
        <wd-icon name="warning" size="56rpx" color="var(--app-danger)" />
        <view class="mt-3 text-3.5 font-medium">
          记忆加载失败
        </view>
        <wd-button size="small" custom-class="mt-4!" @click="loadPage">
          重新加载
        </wd-button>
      </view>

      <view v-else-if="!items.length" class="app-panel-flat mt-4 rounded-3 px-4 py-12 text-center">
        <view class="text-3.5 font-semibold">
          {{ currentView === 'active' ? '还没有已确认的项目记忆' : currentView === 'pending' ? '没有待确认的记忆' : '暂无历史记录' }}
        </view>
        <view class="app-muted mt-2 text-2.5 leading-5">
          {{ currentView === 'active' ? '在项目对话中确认条件或方案后，会显示在这里。' : currentView === 'pending' ? '筑小格提取到需要你确认的内容时，会出现在这里。' : '被更新或作废的记忆会保留在这里。' }}
        </view>
      </view>

      <template v-else-if="currentView === 'active'">
        <view v-for="group in groupedConfirmed" :key="group.type" class="mt-4">
          <view class="app-tertiary mb-2 text-2.5">
            {{ group.title }}
          </view>
          <view
            v-for="item in group.items"
            :key="item.id"
            class="memory-card app-panel-flat mb-2 rounded-3 px-3.5 py-3"
          >
            <view class="text-3.5 font-semibold">
              {{ memoryTitle(item) }}
            </view>
            <view class="mt-1.5 text-3 leading-5.5">
              {{ item.content }}
            </view>
            <view v-if="canManage" class="mt-3 flex flex-wrap gap-2">
              <wd-button size="small" plain @click="correctMemory(item)">
                纠正
              </wd-button>
              <wd-button size="small" plain @click="rejectMemory(item)">
                作废
              </wd-button>
              <wd-button v-if="item.sourceConversationId" size="small" plain @click="openSourceConversation(item)">
                查看来源对话
              </wd-button>
            </view>
            <view
              v-else-if="item.sourceConversationId"
              class="app-primary-text mt-2 text-2.5"
              @click="openSourceConversation(item)"
            >
              查看来源对话
            </view>
          </view>
        </view>
      </template>

      <template v-else>
        <view
          v-for="item in items"
          :key="item.id"
          class="memory-card app-panel-flat mt-3 rounded-3 px-3.5 py-3"
        >
          <view class="flex items-center justify-between gap-2">
            <text class="min-w-0 flex-1 truncate text-3.5 font-semibold">
              {{ memoryTitle(item) }}
            </text>
            <text class="memory-card__status shrink-0 text-2.5">
              {{ memoryStatusLabel(item.status) }}
            </text>
          </view>
          <view class="app-tertiary mt-1 text-2.5">
            {{ MEMORY_TYPE_LABELS[item.memoryType] }}
          </view>
          <view class="mt-1.5 text-3 leading-5.5">
            {{ item.content }}
          </view>
          <view v-if="currentView === 'pending' && canManage" class="mt-3 flex flex-wrap gap-2">
            <wd-button size="small" :disabled="actingId === item.id" @click="confirmMemory(item)">
              确认
            </wd-button>
            <wd-button size="small" plain :disabled="actingId === item.id" @click="correctMemory(item)">
              纠正
            </wd-button>
            <wd-button size="small" plain :disabled="actingId === item.id" @click="rejectMemory(item)">
              拒绝
            </wd-button>
            <wd-button v-if="item.sourceConversationId" size="small" plain @click="openSourceConversation(item)">
              查看来源对话
            </wd-button>
          </view>
          <view
            v-else-if="item.sourceConversationId"
            class="app-primary-text mt-2 text-2.5"
            @click="openSourceConversation(item)"
          >
            查看来源对话
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.memory-page {
  width: 100%;
  max-width: 750px;
  margin: 0 auto;
  padding-bottom: calc(48rpx + env(safe-area-inset-bottom));
}

.memory-card {
  background: var(--app-bg-surface);
}

.memory-card__status {
  color: var(--app-text-tertiary);
}
</style>
