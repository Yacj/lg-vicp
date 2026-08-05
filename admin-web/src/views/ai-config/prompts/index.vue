<script setup lang="ts">
import type { AiPromptVersion, AiScene } from '@/types/ai'
import { useBreakpoints } from '@vueuse/core'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAiPromptManagement, versionActionMessages } from '@/composables/useAiPromptManagement'
import { confirmAndRun } from '@/composables/useAppConfirm'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  AI_PROMPT_VERSION_STATUS_META,
  AI_SCENE_META,
  AI_SCENE_OPTIONS,
  countPromptChars,
  diffPromptVersions,
  extractPromptVariables,
  getAiPromptVersionStatusLabel,
} from '@/utils/ai'
import { formatDate } from '@/utils/day'

const {
  activeVersionId,
  canEditSelected,
  createPrompt,
  deleteDraftVersion,
  deletePromptTemplate,
  disableActiveVersion,
  editorCharCount,
  editorDirty,
  editorText,
  loadPrompts,
  promptError,
  promptStatus,
  publishVersion,
  rollbackVersion,
  saveDraft,
  scenePrompts,
  selectPrompt,
  selectScene,
  selectVersion,
  selectedPrompt,
  selectedPromptId,
  selectedScene,
  selectedVersion,
  selectedVersionId,
  versions,
  versionsError,
  versionsStatus,
} = useAiPromptManagement()
const { canAccess } = usePermissionAccess()
const feedback = useAppFeedback()

const breakpoints = useBreakpoints({ narrow: 1024, small: 768 })
const isNarrow = breakpoints.smaller('narrow')
const isSmall = breakpoints.smaller('small')

const canAddPrompt = computed(() => canAccess({ permissions: ['system:ai:prompt:add'] }))
const canEditPrompt = computed(() => canAccess({ permissions: ['system:ai:prompt:edit'] }))
const canPublishPrompt = computed(() => canAccess({ permissions: ['system:ai:prompt:publish'] }))
const canRemovePrompt = computed(() => canAccess({ permissions: ['system:ai:prompt:remove'] }))

/** 窄屏右栏抽屉（<768px）。 */
const panelOpen = ref(false)

watch(isSmall, (small) => {
  if (!small) {
    panelOpen.value = false
  }
})

onMounted(() => {
  if (promptStatus.value === 'idle') {
    void loadPrompts()
  }
})

/** 编辑器内容与选中版本不一致即视为有未保存修改。 */
watch(editorText, (text) => {
  if (selectedVersion.value && text !== selectedVersion.value.content) {
    editorDirty.value = true
  }
})

const tableStatus = computed<'ready' | 'loading' | 'error'>(() => {
  if (promptStatus.value === 'loading') {
    return 'loading'
  }
  return promptStatus.value === 'error' ? 'error' : 'ready'
})

const errorDescription = computed(() => promptError.value
  ? normalizeFeedbackError(promptError.value).message
  : '请检查网络连接后重试')

const versionsTableStatus = computed<'ready' | 'loading' | 'error'>(() => {
  if (versionsStatus.value === 'loading') {
    return 'loading'
  }
  return versionsStatus.value === 'error' ? 'error' : 'ready'
})

const versionsErrorDescription = computed(() => versionsError.value
  ? normalizeFeedbackError(versionsError.value).message
  : '请检查网络连接后重试')

const activeVersion = computed<AiPromptVersion | null>(() => versions.value
  .find(version => version.id === activeVersionId.value) ?? null)

const selectedVariables = computed(() => extractPromptVariables(editorText.value))

/** 模板可删除：没有任何已发布/已停用版本（后端仅允许删除未发布过的模板）。 */
const canDeletePromptTemplate = computed(() => {
  if (!selectedPrompt.value) {
    return false
  }
  return versions.value.every(version => version.status === 'DRAFT')
})

async function confirmDiscardIfDirty(action: () => Promise<void> | void): Promise<boolean> {
  if (!editorDirty.value) {
    await action()
    return true
  }
  const result = await confirmAndRun({
    content: '当前编辑器中有未保存的草稿修改，切换后将丢失。',
    confirmText: '放弃修改',
    danger: true,
    title: '放弃未保存的修改',
  }, async () => {
    await action()
  })
  return result.confirmed
}

function handleSelectScene(scene: AiScene): void {
  void confirmDiscardIfDirty(async () => {
    selectScene(scene)
  })
}

function handleSelectPrompt(promptId: string): void {
  void confirmDiscardIfDirty(async () => {
    selectPrompt(promptId)
  })
}

function handleSelectVersion(versionId: string): void {
  void confirmDiscardIfDirty(async () => {
    selectVersion(versionId)
  })
}

/** 保存草稿：先收集变更说明，再提交。 */
const saveNoteDialogVisible = ref(false)
const saveNote = ref('')
const saveSubmitting = ref(false)

function openSaveDraft(): void {
  if (!canEditSelected.value) {
    return
  }
  if (!editorDirty.value) {
    void feedback.message('info', '当前草稿没有需要保存的修改')
    return
  }
  saveNote.value = ''
  saveNoteDialogVisible.value = true
}

async function submitSaveDraft(): Promise<void> {
  if (saveSubmitting.value) {
    return
  }
  saveSubmitting.value = true
  try {
    await saveDraft(saveNote.value)
    saveNoteDialogVisible.value = false
    await feedback.message('success', '草稿已保存')
  }
  catch (error) {
    await feedback.messageError(error)
  }
  finally {
    saveSubmitting.value = false
  }
}

/** 新增提示词模板弹窗。 */
const createVisible = ref(false)
const createSubmitting = ref(false)
const createForm = reactive({
  scene: 'general_chat' as AiScene,
  name: '',
  systemPrompt: '',
  changeNote: '',
})

function openCreateDialog(): void {
  createForm.scene = selectedScene.value
  createForm.name = ''
  createForm.systemPrompt = ''
  createForm.changeNote = ''
  createVisible.value = true
}

async function submitCreate(): Promise<void> {
  if (createSubmitting.value) {
    return
  }
  if (!createForm.name.trim()) {
    await feedback.message('warning', '请输入提示词名称')
    return
  }
  if (createForm.systemPrompt.trim().length < 10) {
    await feedback.message('warning', '系统提示词至少需要 10 个字符')
    return
  }
  createSubmitting.value = true
  try {
    await createPrompt({
      scene: createForm.scene,
      name: createForm.name.trim(),
      systemPrompt: createForm.systemPrompt.trim(),
      changeNote: createForm.changeNote.trim() || undefined,
    })
    createVisible.value = false
    await feedback.message('success', '提示词草稿创建成功，请编辑后发布')
  }
  catch (error) {
    await feedback.messageError(error)
  }
  finally {
    createSubmitting.value = false
  }
}

/** 发布/停用/回滚/删除草稿（确认后执行）。 */
async function runPublish(): Promise<void> {
  const prompt = selectedPrompt.value
  const version = selectedVersion.value
  if (!prompt || !version) {
    return
  }
  await confirmAndRun(versionActionMessages(prompt.name, version).publish, async () => {
    await publishVersion()
    await feedback.message('success', '发布成功，新请求将使用该版本')
  })
}

async function runDisable(): Promise<void> {
  const prompt = selectedPrompt.value
  const version = selectedVersion.value
  if (!prompt || !version) {
    return
  }
  await confirmAndRun(versionActionMessages(prompt.name, version).disable, async () => {
    await disableActiveVersion()
    await feedback.message('success', '已停用，该场景新请求将提示配置不完整')
  })
}

async function runRollback(): Promise<void> {
  const prompt = selectedPrompt.value
  const version = selectedVersion.value
  if (!prompt || !version) {
    return
  }
  await confirmAndRun(versionActionMessages(prompt.name, version).rollback, async () => {
    await rollbackVersion(version)
    await feedback.message('success', '已基于该版本创建新草稿，请编辑或直接发布')
  })
}

async function runDeleteVersion(): Promise<void> {
  const prompt = selectedPrompt.value
  const version = selectedVersion.value
  if (!prompt || !version || version.status !== 'DRAFT') {
    return
  }
  await confirmAndRun(versionActionMessages(prompt.name, version).delete, async () => {
    await deleteDraftVersion(version)
    await feedback.message('success', '草稿版本已删除')
  })
}

async function runDeletePromptTemplate(): Promise<void> {
  const prompt = selectedPrompt.value
  if (!prompt || !canDeletePromptTemplate.value) {
    return
  }
  await confirmAndRun({
    content: `提示词模板「${prompt.name}」从未发布，删除后无法恢复。`,
    confirmText: '删除',
    danger: true,
    title: '删除提示词模板',
  }, async () => {
    await deletePromptTemplate()
    await feedback.message('success', '提示词模板已删除')
  })
}

/** 版本对比：选择两个版本 → diff 抽屉。 */
const compareVisible = ref(false)
const compareFrom = ref('')
const compareTo = ref('')
const diffVisible = ref(false)
const diffVersions = ref<AiPromptVersion[]>([])

function versionOptionLabel(version: AiPromptVersion): string {
  const status = AI_PROMPT_VERSION_STATUS_META[version.status]
  const active = version.id === activeVersionId.value ? ' · 当前生效' : ''
  return `v${version.version}（${status}${active}）`
}

function openCompareDialog(): void {
  if (versions.value.length < 2) {
    void feedback.message('info', '至少需要两个版本才能对比')
    return
  }
  compareFrom.value = activeVersion.value?.id
    ?? versions.value.find(version => version.status !== 'DRAFT')?.id
    ?? versions.value[1]?.id ?? versions.value[0]?.id ?? ''
  compareTo.value = selectedVersionId.value ?? versions.value[0]?.id ?? ''
  compareVisible.value = true
}

async function runCompare(): Promise<void> {
  if (compareFrom.value === compareTo.value) {
    await feedback.message('warning', '请选择两个不同的版本进行对比')
    return
  }
  const from = versions.value.find(version => version.id === compareFrom.value)
  const to = versions.value.find(version => version.id === compareTo.value)
  if (!from || !to) {
    return
  }
  diffVersions.value = [from, to]
  compareVisible.value = false
  diffVisible.value = true
}

const diffLines = computed(() => {
  const [from, to] = diffVersions.value
  if (!from || !to) {
    return []
  }
  return diffPromptVersions(from.content, to.content)
})
</script>

<template>
  <AppPage>
    <div class="ai-prompt-workspace" :class="{ 'ai-prompt-workspace--panel-open': panelOpen }">
      <!-- 窄屏顶部选择条（<1024px） -->
      <div v-if="isNarrow" class="ai-prompt-workspace__narrow-bar">
        <t-select
          :model-value="selectedScene"
          :options="AI_SCENE_OPTIONS"
          @change="(value) => handleSelectScene(value as AiScene)"
        />
        <t-select
          :model-value="selectedPromptId ?? undefined"
          placeholder="选择模板"
          @change="(value) => handleSelectPrompt(String(value))"
        >
          <t-option v-for="prompt in scenePrompts" :key="prompt.id" :label="prompt.name" :value="prompt.id" />
        </t-select>
        <t-select
          :model-value="selectedVersionId ?? undefined"
          placeholder="选择版本"
          @change="(value) => handleSelectVersion(String(value))"
        >
          <t-option
            v-for="version in versions"
            :key="version.id"
            :label="versionOptionLabel(version)"
            :value="version.id"
          />
        </t-select>
        <div class="ai-prompt-workspace__narrow-actions">
          <t-button v-if="canAddPrompt" theme="primary" variant="outline" @click="openCreateDialog">
            新增模板
          </t-button>
          <t-button variant="text" @click="openCompareDialog">
            版本对比
          </t-button>
          <t-button v-if="isSmall" variant="text" @click="panelOpen = !panelOpen">
            详情
          </t-button>
        </div>
      </div>

      <!-- 左栏：场景 → 模板 → 版本 -->
      <aside v-show="!isNarrow" class="ai-prompt-workspace__left">
        <div class="ai-prompt-workspace__left-head">
          <span class="ai-prompt-workspace__section-title">场景</span>
          <t-button v-if="canAddPrompt" theme="primary" block @click="openCreateDialog">
            <template #icon>
              <AddIcon />
            </template>
            新增模板
          </t-button>
        </div>
        <div class="ai-prompt-workspace__scene-list">
          <t-button
            v-for="scene in AI_SCENE_OPTIONS"
            :key="scene.value"
            class="ai-prompt-workspace__scene-item"
            :class="{ 'ai-prompt-workspace__scene-item--active': scene.value === selectedScene }"
            variant="text"
            block
            @click="handleSelectScene(scene.value)"
          >
            <span>{{ scene.label }}</span>
            <span class="ai-prompt-workspace__scene-desc">{{ AI_SCENE_META[scene.value].description }}</span>
          </t-button>
        </div>

        <template v-if="tableStatus === 'error'">
          <p class="ai-prompt-workspace__error-text">
            {{ errorDescription }}
          </p>
        </template>
        <template v-else>
          <p class="ai-prompt-workspace__section-title ai-prompt-workspace__section-title--mt">
            模板
          </p>
          <div v-if="scenePrompts.length" class="ai-prompt-workspace__prompt-list">
            <div
              v-for="prompt in scenePrompts"
              :key="prompt.id"
              class="ai-prompt-workspace__prompt-item"
              :class="{ 'ai-prompt-workspace__prompt-item--active': prompt.id === selectedPromptId }"
              @click="handleSelectPrompt(prompt.id)"
            >
              <div class="ai-prompt-workspace__prompt-head">
                <span class="ai-prompt-workspace__prompt-name">{{ prompt.name }}</span>
                <span
                  v-if="prompt.version"
                  class="ai-prompt-workspace__prompt-version-badge"
                >
                  v{{ prompt.version }}
                </span>
              </div>
            </div>
          </div>
          <AppEmptyState
            v-else-if="tableStatus === 'ready'"
            class="ai-prompt-workspace__empty"
            description="当前场景尚未创建提示词模板"
            size="small"
            title="暂无模板"
          />

          <template v-if="selectedPrompt">
            <p class="ai-prompt-workspace__section-title ai-prompt-workspace__section-title--mt">
              版本
              <span v-if="canRemovePrompt && canDeletePromptTemplate" class="ai-prompt-workspace__delete-prompt" @click.stop="runDeletePromptTemplate">
                删除模板
              </span>
            </p>
            <div v-if="versionsTableStatus === 'error'" class="ai-prompt-workspace__error-text">
              {{ versionsErrorDescription }}
            </div>
            <div v-else-if="versions.length" class="ai-prompt-workspace__version-list">
              <div
                v-for="version in versions"
                :key="version.id"
                class="ai-prompt-workspace__version-item"
                :class="{
                  'ai-prompt-workspace__version-item--active': version.id === selectedVersionId,
                  'ai-prompt-workspace__version-item--active-effect': version.id === activeVersionId,
                }"
                @click="handleSelectVersion(version.id)"
              >
                <div class="ai-prompt-workspace__version-head">
                  <span class="ai-prompt-workspace__version-no">v{{ version.version }}</span>
                  <span
                    class="ai-prompt-workspace__version-status"
                    :class="`ai-prompt-workspace__version-status--${version.status.toLowerCase()}`"
                  >
                    {{ version.id === activeVersionId ? '当前生效' : getAiPromptVersionStatusLabel(version.status) }}
                  </span>
                </div>
                <p v-if="version.changeNote" class="ai-prompt-workspace__version-note">
                  {{ version.changeNote }}
                </p>
                <p class="ai-prompt-workspace__version-meta">
                  {{ version.publishedAt ? `发布于 ${formatDate(new Date(version.publishedAt))}` : `创建于 ${formatDate(new Date(version.createdAt))}` }}
                </p>
              </div>
            </div>
            <AppEmptyState
              v-else-if="versionsTableStatus === 'ready'"
              class="ai-prompt-workspace__empty"
              description="当前模板尚未创建任何版本"
              size="small"
              title="暂无版本"
            />
          </template>
        </template>
      </aside>

      <!-- 中栏：编辑器 -->
      <main class="ai-prompt-workspace__main">
        <template v-if="selectedPrompt && selectedVersion">
          <div class="ai-prompt-workspace__editor-head">
            <div class="ai-prompt-workspace__editor-title">
              <span class="ai-prompt-workspace__editor-name">{{ selectedPrompt.name }}</span>
              <span class="ai-prompt-workspace__editor-version">v{{ selectedVersion.version }}</span>
              <AppStatusTag
                :label="selectedVersion.id === activeVersionId ? '当前生效' : getAiPromptVersionStatusLabel(selectedVersion.status)"
                :status="selectedVersion.id === activeVersionId ? 'success' : selectedVersion.status === 'PUBLISHED' ? 'info' : selectedVersion.status === 'DISABLED' ? 'warning' : 'default'"
              />
            </div>
            <div class="ai-prompt-workspace__editor-actions">
              <t-button variant="text" @click="openCompareDialog">
                版本对比
              </t-button>
              <t-button
                v-if="!canEditSelected && canEditPrompt"
                variant="outline"
                @click="runRollback"
              >
                基于此版本创建草稿
              </t-button>
              <t-button v-if="canEditSelected && canEditPrompt" theme="primary" variant="outline" @click="openSaveDraft">
                保存草稿
              </t-button>
            </div>
          </div>
          <div class="ai-prompt-workspace__editor-body">
            <t-textarea
              v-model="editorText"
              :autosize="{ minRows: 16, maxRows: 40 }"
              :disabled="!canEditSelected"
              class="ai-prompt-workspace__editor-textarea"
              :placeholder="canEditSelected ? '编辑草稿内容，支持 {{变量名}} 占位符' : '当前版本只读，可基于此版本创建草稿后编辑'"
            />
          </div>
          <div class="ai-prompt-workspace__editor-meta">
            <span>字数：{{ editorCharCount }}</span>
            <span class="ai-prompt-workspace__editor-variables">
              变量：
              <template v-if="selectedVariables.length">
                <span
                  v-for="variable in selectedVariables"
                  :key="variable"
                  class="ai-prompt-workspace__variable-tag"
                >
                  {{ `${variable}` }}
                </span>
              </template>
              <span v-else class="ai-prompt-workspace__muted-text">未检测到变量占位符</span>
            </span>
          </div>
        </template>
        <template v-else-if="tableStatus === 'ready'">
          <AppEmptyState
            class="ai-prompt-workspace__empty ai-prompt-workspace__empty--main"
            description="从左侧选择模板与版本开始编辑"
            title="请选择提示词模板"
          >
            <template v-if="canAddPrompt" #action>
              <t-button theme="primary" @click="openCreateDialog">
                <template #icon>
                  <AddIcon />
                </template>
                新增模板
              </t-button>
            </template>
          </AppEmptyState>
        </template>
        <AppEmptyState
          v-else-if="tableStatus === 'error'"
          class="ai-prompt-workspace__empty ai-prompt-workspace__empty--main"
          :description="errorDescription"
          title="加载失败"
        >
          <template #action>
            <t-button theme="primary" variant="outline" @click="loadPrompts">
              重试
            </t-button>
          </template>
        </AppEmptyState>
      </main>

      <!-- 右栏：操作 / 变量 / 版本信息 / 发布状态 -->
      <aside
        v-show="!isNarrow"
        class="ai-prompt-workspace__right"
      >
        <template v-if="selectedPrompt && selectedVersion">
          <div class="ai-prompt-workspace__panel-block">
            <p class="ai-prompt-workspace__section-title">
              操作
            </p>
            <div class="ai-prompt-workspace__panel-actions">
              <t-button v-if="canEditSelected && canEditPrompt" block theme="primary" @click="openSaveDraft">
                保存草稿
              </t-button>
              <t-button v-if="canEditSelected && canPublishPrompt" block theme="success" variant="outline" @click="runPublish">
                发布此版本
              </t-button>
              <t-button v-if="canEditSelected && canEditPrompt" block variant="outline" theme="danger" @click="runDeleteVersion">
                删除此草稿
              </t-button>
              <t-button v-if="!canEditSelected && canEditPrompt" block variant="outline" @click="runRollback">
                基于此版本创建草稿
              </t-button>
              <t-button
                v-if="activeVersion && canPublishPrompt"
                block
                theme="warning"
                variant="outline"
                @click="runDisable"
              >
                停用当前生效版本
              </t-button>
            </div>
          </div>

          <div class="ai-prompt-workspace__panel-block">
            <p class="ai-prompt-workspace__section-title">
              变量
            </p>
            <div class="ai-prompt-workspace__panel-variables">
              <template v-if="selectedVariables.length">
                <span
                  v-for="variable in selectedVariables"
                  :key="variable"
                  class="ai-prompt-workspace__variable-tag"
                >
                  {{ `${variable}` }}
                </span>
              </template>
              <span v-else class="ai-prompt-workspace__muted-text">未检测到变量占位符</span>
            </div>
          </div>

          <div class="ai-prompt-workspace__panel-block">
            <p class="ai-prompt-workspace__section-title">
              版本信息
            </p>
            <t-descriptions :column="1" size="small">
              <t-descriptions-item label="版本号">
                v{{ selectedVersion.version }}
              </t-descriptions-item>
              <t-descriptions-item label="状态">
                {{ getAiPromptVersionStatusLabel(selectedVersion.status) }}
              </t-descriptions-item>
              <t-descriptions-item label="创建人">
                {{ selectedVersion.createdById ?? '-' }}
              </t-descriptions-item>
              <t-descriptions-item label="创建时间">
                {{ formatDate(new Date(selectedVersion.createdAt)) }}
              </t-descriptions-item>
              <t-descriptions-item v-if="selectedVersion.publishedAt" label="发布人">
                {{ selectedVersion.publishedById ?? '-' }}
              </t-descriptions-item>
              <t-descriptions-item v-if="selectedVersion.publishedAt" label="发布时间">
                {{ formatDate(new Date(selectedVersion.publishedAt)) }}
              </t-descriptions-item>
              <t-descriptions-item label="变更说明">
                {{ selectedVersion.changeNote ?? '-' }}
              </t-descriptions-item>
            </t-descriptions>
          </div>

          <div class="ai-prompt-workspace__panel-block">
            <p class="ai-prompt-workspace__section-title">
              发布状态
            </p>
            <template v-if="activeVersion">
              <AppStatusTag label="当前生效" status="success" />
              <span class="ai-prompt-workspace__active-version">
                该场景当前使用 v{{ activeVersion.version }}
              </span>
            </template>
            <span v-else class="ai-prompt-workspace__muted-text">
              暂无生效版本
            </span>
          </div>
        </template>
        <AppEmptyState
          v-else
          class="ai-prompt-workspace__empty"
          description="选择模板与版本后展示操作与信息"
          size="small"
          title="未选择版本"
        />
      </aside>
    </div>

    <!-- 保存草稿（变更说明）弹窗 -->
    <t-dialog
      :cancel-btn="{ content: '取消' }"
      confirm-text="保存草稿"
      header="保存草稿"
      :loading="saveSubmitting"
      :visible="saveNoteDialogVisible"
      width="min(480px, 92vw)"
      @close="saveNoteDialogVisible = false"
      @confirm="submitSaveDraft"
    >
      <t-form label-align="top">
        <t-form-item
          help="选填：简要说明本次修改内容，便于后续版本回溯。"
          label="变更说明"
        >
          <t-textarea
            v-model="saveNote"
            :autosize="{ minRows: 2, maxRows: 6 }"
            maxlength="500"
            placeholder="例如：补充节能率计算口径说明"
          />
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- 新增提示词模板弹窗 -->
    <t-dialog
      :cancel-btn="{ content: '取消' }"
      confirm-text="创建草稿"
      header="新增提示词模板"
      :loading="createSubmitting"
      :visible="createVisible"
      width="min(640px, 92vw)"
      @close="createVisible = false"
      @confirm="submitCreate"
    >
      <t-form label-align="top">
        <t-form-item label="场景">
          <t-select v-model="createForm.scene" :options="AI_SCENE_OPTIONS" />
        </t-form-item>
        <t-form-item label="模板名称" required-mark>
          <t-input
            v-model="createForm.name"
            maxlength="120"
            placeholder="例如：通用对话系统提示词"
          />
        </t-form-item>
        <t-form-item
          help="支持 {{变量名}} 占位符，由会话上下文注入；至少 10 个字符。"
          label="系统提示词"
          required-mark
        >
          <t-textarea
            v-model="createForm.systemPrompt"
            :autosize="{ minRows: 6, maxRows: 16 }"
            placeholder="输入系统提示词内容"
          />
          <div class="ai-prompt-workspace__editor-meta">
            <span>字数：{{ countPromptChars(createForm.systemPrompt) }}</span>
          </div>
        </t-form-item>
        <t-form-item label="变更说明">
          <t-input
            v-model="createForm.changeNote"
            maxlength="500"
            placeholder="选填：说明该模板用途"
          />
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- 版本对比选择弹窗 -->
    <t-dialog
      :cancel-btn="{ content: '取消' }"
      confirm-text="开始对比"
      header="版本对比"
      :visible="compareVisible"
      width="min(520px, 92vw)"
      @close="compareVisible = false"
      @confirm="runCompare"
    >
      <t-form label-align="top">
        <t-form-item label="旧版本">
          <t-select v-model="compareFrom">
            <t-option v-for="version in versions" :key="version.id" :label="versionOptionLabel(version)" :value="version.id" />
          </t-select>
        </t-form-item>
        <t-form-item label="新版本">
          <t-select v-model="compareTo">
            <t-option v-for="version in versions" :key="version.id" :label="versionOptionLabel(version)" :value="version.id" />
          </t-select>
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- 版本差异对比抽屉 -->
    <t-drawer
      :cancel-btn="null"
      confirm-text="关闭"
      :footer="false"
      header="版本差异对比"
      :visible="diffVisible"
      size="min(760px, 94vw)"
      @close="diffVisible = false"
    >
      <template v-if="diffVersions.length === 2">
        <div class="ai-prompt-workspace__diff-head">
          <div class="ai-prompt-workspace__diff-side">
            <span class="ai-prompt-workspace__diff-badge ai-prompt-workspace__diff-badge--old">旧</span>
            v{{ diffVersions[0].version }} · {{ getAiPromptVersionStatusLabel(diffVersions[0].status) }}
          </div>
          <div class="ai-prompt-workspace__diff-side">
            <span class="ai-prompt-workspace__diff-badge ai-prompt-workspace__diff-badge--new">新</span>
            v{{ diffVersions[1].version }} · {{ getAiPromptVersionStatusLabel(diffVersions[1].status) }}
          </div>
        </div>
        <div class="ai-prompt-workspace__diff-lines">
          <template v-for="(line, index) in diffLines" :key="`${line.kind}-${index}`">
            <div
              v-if="line.kind !== 'equal'"
              class="ai-prompt-workspace__diff-line"
              :class="{
                'ai-prompt-workspace__diff-line--added': line.kind === 'added',
                'ai-prompt-workspace__diff-line--removed': line.kind === 'removed',
              }"
            >
              <span class="ai-prompt-workspace__diff-marker">
                {{ line.kind === 'added' ? '+' : '-' }}
              </span>
              <span class="ai-prompt-workspace__diff-number">
                {{ line.newLine ?? line.oldLine }}
              </span>
              <span class="ai-prompt-workspace__diff-text">{{ line.text || ' ' }}</span>
            </div>
          </template>
          <p v-if="diffLines.length === 0" class="ai-prompt-workspace__diff-empty">
            两个版本内容一致。
          </p>
        </div>
      </template>
    </t-drawer>
  </AppPage>
</template>

<style scoped>
.ai-prompt-workspace {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr) 250px;
  gap: var(--td-comp-margin-l);
  height: calc(100vh - 200px);
  min-height: 460px;
}

.ai-prompt-workspace__left,
.ai-prompt-workspace__right {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-comp-margin-s);
  overflow-y: auto;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
}

.ai-prompt-workspace__main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  overflow: hidden;
}

.ai-prompt-workspace__section-title {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  font-weight: 600;
}

.ai-prompt-workspace__section-title--mt {
  margin-top: var(--td-comp-margin-l);
}

.ai-prompt-workspace__left-head {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--td-comp-margin-s);
}

.ai-prompt-workspace__scene-list {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-xs);
}

.ai-prompt-workspace__scene-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  height: auto;
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);
  text-align: left;
  border-radius: var(--td-radius-medium);
  transition: background-color 0.2s, border-color 0.2s;
}

.ai-prompt-workspace__scene-item :deep(.t-button__text) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  gap: 2px;
}

.ai-prompt-workspace__scene-item:hover {
  background: var(--td-bg-color-component-hover);
}

.ai-prompt-workspace__scene-item--active {
  background: var(--td-brand-color-light);
  border-color: var(--td-brand-color);
}

.ai-prompt-workspace__scene-item--active .ai-prompt-workspace__scene-desc {
  color: var(--td-brand-color);
}

.ai-prompt-workspace__scene-desc {
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

.ai-prompt-workspace__prompt-list,
.ai-prompt-workspace__version-list {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-xs);
}

.ai-prompt-workspace__prompt-item {
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s;
}

.ai-prompt-workspace__prompt-item:hover {
  border-color: var(--td-brand-color);
}

.ai-prompt-workspace__prompt-item--active {
  background: var(--td-brand-color-light);
  border-color: var(--td-brand-color);
}

.ai-prompt-workspace__prompt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-s);
}

.ai-prompt-workspace__prompt-name {
  overflow: hidden;
  font-size: var(--td-font-size-body-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-prompt-workspace__prompt-version-badge {
  flex-shrink: 0;
  padding: 0 var(--td-comp-paddingLR-s);
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: var(--td-radius-small);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
}

.ai-prompt-workspace__delete-prompt {
  margin-left: var(--td-comp-margin-s);
  color: var(--td-error-color);
  font-weight: 400;
  cursor: pointer;
}

.ai-prompt-workspace__version-item {
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s;
}

.ai-prompt-workspace__version-item:hover {
  border-color: var(--td-brand-color);
}

.ai-prompt-workspace__version-item--active {
  border-color: var(--td-brand-color);
}

.ai-prompt-workspace__version-item--active-effect {
  background: var(--td-brand-color-light);
}

.ai-prompt-workspace__version-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-s);
}

.ai-prompt-workspace__version-no {
  font-family: var(--td-font-family-mono);
  font-weight: 600;
}

.ai-prompt-workspace__version-status {
  flex-shrink: 0;
  padding: 0 var(--td-comp-paddingLR-s);
  border-radius: var(--td-radius-small);
  font-size: var(--td-font-size-body-small);
}

.ai-prompt-workspace__version-status--draft {
  color: var(--td-warning-color);
  background: var(--td-warning-color-light);
}

.ai-prompt-workspace__version-status--published {
  color: var(--td-success-color);
  background: var(--td-success-color-light);
}

.ai-prompt-workspace__version-status--disabled {
  color: var(--td-text-color-disabled);
  background: var(--td-bg-color-component);
}

.ai-prompt-workspace__version-note {
  margin: var(--td-comp-margin-xs) 0 0;
  overflow: hidden;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-prompt-workspace__version-meta {
  margin: 2px 0 0;
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

.ai-prompt-workspace__editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-s);
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  border-bottom: 1px solid var(--td-component-border);
}

.ai-prompt-workspace__editor-title {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  min-width: 0;
}

.ai-prompt-workspace__editor-name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-prompt-workspace__editor-version {
  color: var(--td-brand-color);
  font-family: var(--td-font-family-mono);
}

.ai-prompt-workspace__editor-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--td-comp-margin-s);
}

.ai-prompt-workspace__editor-body {
  flex: 1;
  min-height: 0;
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  overflow-y: auto;
}

.ai-prompt-workspace__editor-textarea :deep(textarea) {
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-medium);
}

.ai-prompt-workspace__editor-meta {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-l);
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-l);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  border-top: 1px solid var(--td-component-border);
}

.ai-prompt-workspace__editor-variables {
  display: inline-flex;
  align-items: center;
  gap: var(--td-comp-margin-xs);
  flex-wrap: wrap;
}

.ai-prompt-workspace__variable-tag {
  padding: 0 var(--td-comp-paddingLR-s);
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: var(--td-radius-small);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
}

.ai-prompt-workspace__muted-text {
  color: var(--td-text-color-placeholder);
}

.ai-prompt-workspace__panel-block {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-s);
  padding-bottom: var(--td-comp-paddingTB-l);
  border-bottom: 1px solid var(--td-component-border);
}

.ai-prompt-workspace__panel-block:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.ai-prompt-workspace__panel-actions {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-s);
}

.ai-prompt-workspace__panel-variables {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-xs);
}

.ai-prompt-workspace__active-version {
  margin-left: var(--td-comp-margin-s);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-prompt-workspace__empty {
  margin: var(--td-comp-margin-l) 0;
}

.ai-prompt-workspace__empty--main {
  margin: auto;
}

.ai-prompt-workspace__error-text {
  margin: var(--td-comp-margin-s) 0;
  color: var(--td-error-color);
  font-size: var(--td-font-size-body-small);
}

.ai-prompt-workspace__narrow-bar {
  display: flex;
  grid-column: 1 / -1;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-s);
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-s);
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
}

.ai-prompt-workspace__narrow-bar .t-select {
  min-width: 160px;
  flex: 1;
}

.ai-prompt-workspace__narrow-actions {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-xs);
}

.ai-prompt-workspace__diff-head {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-l);
}

.ai-prompt-workspace__diff-side {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-xs);
  font-weight: 500;
}

.ai-prompt-workspace__diff-badge {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: var(--td-radius-small);
  font-size: var(--td-font-size-body-small);
}

.ai-prompt-workspace__diff-badge--old {
  color: var(--td-error-color);
  background: var(--td-error-color-light);
}

.ai-prompt-workspace__diff-badge--new {
  color: var(--td-success-color);
  background: var(--td-success-color-light);
}

.ai-prompt-workspace__diff-lines {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  overflow: hidden;
}

.ai-prompt-workspace__diff-line {
  display: grid;
  grid-template-columns: 24px 40px minmax(0, 1fr);
  gap: var(--td-comp-margin-s);
  padding: var(--td-comp-paddingTB-xs) var(--td-comp-paddingLR-m);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-small);
}

.ai-prompt-workspace__diff-line--added {
  background: var(--td-success-color-light);
}

.ai-prompt-workspace__diff-line--removed {
  background: var(--td-error-color-light);
}

.ai-prompt-workspace__diff-marker {
  text-align: center;
  font-weight: 700;
}

.ai-prompt-workspace__diff-line--added .ai-prompt-workspace__diff-marker {
  color: var(--td-success-color);
}

.ai-prompt-workspace__diff-line--removed .ai-prompt-workspace__diff-marker {
  color: var(--td-error-color);
}

.ai-prompt-workspace__diff-number {
  color: var(--td-text-color-placeholder);
  text-align: right;
}

.ai-prompt-workspace__diff-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-prompt-workspace__diff-empty {
  margin: 0;
  padding: var(--td-comp-paddingTB-xxl) var(--td-comp-paddingLR-xxl);
  color: var(--td-text-color-secondary);
  text-align: center;
}

@media (max-width: 1023px) {
  .ai-prompt-workspace {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
    min-height: 0;
  }

  .ai-prompt-workspace__left {
    display: none;
  }

  .ai-prompt-workspace__main {
    min-height: 420px;
  }
}

@media (max-width: 767px) {
  .ai-prompt-workspace__right {
    position: fixed;
    z-index: 999;
    inset: 0 0 0 auto;
    width: min(320px, 86vw);
    border-radius: var(--td-radius-medium) 0 0 var(--td-radius-medium);
    box-shadow: var(--td-shadow-3);
    transform: translateX(100%);
    transition: transform 0.24s ease;
  }

  .ai-prompt-workspace--panel-open .ai-prompt-workspace__right {
    transform: translateX(0);
  }
}
</style>
