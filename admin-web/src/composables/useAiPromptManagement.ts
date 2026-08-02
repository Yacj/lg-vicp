import type { AiPromptVersion, AiPromptTemplate, AiScene } from '@/types/ai'
import {
  createAiPrompt,
  deleteAiPrompt,
  deleteAiPromptVersion,
  disableAiPrompt,
  fetchAiPrompts,
  fetchAiPromptVersions,
  publishAiPrompt,
  rollbackAiPromptVersion,
  updateAiPromptDraft,
} from '@/api/modules/ai'
import { computed, ref } from 'vue'

export type PromptLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** 提示词草稿创建/保存输入。 */
export interface AiPromptDraftInput {
  scene: AiScene
  name: string
  description?: string
  systemPrompt: string
  changeNote?: string
}

/** 提示词版本动作统一返回（发布/停用/回滚/保存草稿）。 */
export interface AiPromptVersionActionContext {
  promptId: string
  promptName: string
  version: AiPromptVersion
}

/** 三栏工作区数据源：场景 → 模板 → 版本。 */
export function useAiPromptManagement() {
  const prompts = ref<AiPromptTemplate[]>([])
  const promptStatus = ref<PromptLoadStatus>('idle')
  const promptError = ref<unknown>(null)

  const selectedScene = ref<AiScene>('general_chat')
  const selectedPromptId = ref<string | null>(null)

  const versions = ref<AiPromptVersion[]>([])
  const versionsStatus = ref<PromptLoadStatus>('idle')
  const versionsError = ref<unknown>(null)
  const selectedVersionId = ref<string | null>(null)

  /** 编辑器内容：草稿可编辑，已发布/停用版本只读。 */
  const editorText = ref('')
  const editorDirty = ref(false)

  const scenePrompts = computed<AiPromptTemplate[]>(() => prompts.value
    .filter(prompt => prompt.scene === selectedScene.value)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)))

  const selectedPrompt = computed<AiPromptTemplate | null>(() => scenePrompts.value
    .find(prompt => prompt.id === selectedPromptId.value) ?? null)

  const selectedVersion = computed<AiPromptVersion | null>(() => versions.value
    .find(version => version.id === selectedVersionId.value) ?? null)

  /** 当前生效版本 id（模板 activeVersionId，不随选中变化）。 */
  const activeVersionId = computed<string | null>(() => selectedPrompt.value?.activeVersionId ?? null)

  const draftVersion = computed<AiPromptVersion | null>(() => versions.value
    .find(version => version.status === 'DRAFT') ?? null)

  /** 选中版本是否可编辑（仅草稿）。 */
  const canEditSelected = computed(() => selectedVersion.value?.status === 'DRAFT')

  const editorCharCount = computed(() => editorText.value.trim().length)

  async function loadPrompts(): Promise<void> {
    promptStatus.value = 'loading'
    promptError.value = null
    try {
      const result = await fetchAiPrompts()
      prompts.value = result.items
      promptStatus.value = 'ready'
      // 场景/模板选择失效时回退到第一个可用项
      const nextPrompt = scenePrompts.value[0] ?? null
      if (!selectedPrompt.value && nextPrompt) {
        selectedPromptId.value = nextPrompt.id
        await loadVersions(nextPrompt.id)
      }
      else if (selectedPrompt.value) {
        await loadVersions(selectedPrompt.value.id)
      }
      else {
        versions.value = []
        selectedVersionId.value = null
        editorText.value = ''
      }
    }
    catch (cause) {
      promptError.value = cause
      promptStatus.value = 'error'
    }
  }

  async function loadVersions(promptId: string): Promise<void> {
    versionsStatus.value = 'loading'
    versionsError.value = null
    try {
      const result = await fetchAiPromptVersions(promptId)
      versions.value = result.items
      versionsStatus.value = 'ready'
      selectBestVersion()
    }
    catch (cause) {
      versionsError.value = cause
      versionsStatus.value = 'error'
      versions.value = []
      selectedVersionId.value = null
      editorText.value = ''
    }
  }

  /** 版本选择优先级：手动选中 > 当前生效 > 草稿 > 最新版本。 */
  function selectBestVersion(): void {
    const current = versions.value.find(version => version.id === selectedVersionId.value)
    const active = versions.value.find(version => version.id === activeVersionId.value)
    const draft = draftVersion.value
    const next = current ?? active ?? draft ?? versions.value[0] ?? null
    selectVersion(next?.id ?? null)
  }

  /** 切换版本：编辑器内容重置为该版本 content，dirty 清零。 */
  function selectVersion(versionId: string | null): void {
    selectedVersionId.value = versionId
    const version = versions.value.find(item => item.id === versionId)
    editorText.value = version?.content ?? ''
    editorDirty.value = false
  }

  function selectScene(scene: AiScene): void {
    if (scene === selectedScene.value) {
      return
    }
    selectedScene.value = scene
    selectedPromptId.value = scenePrompts.value[0]?.id ?? null
    selectedVersionId.value = null
    if (selectedPromptId.value) {
      void loadVersions(selectedPromptId.value)
    }
    else {
      versions.value = []
      editorText.value = ''
    }
  }

  function selectPrompt(promptId: string): void {
    if (promptId === selectedPromptId.value) {
      return
    }
    selectedPromptId.value = promptId
    selectedVersionId.value = null
    void loadVersions(promptId)
  }

  /** 保存草稿（PATCH /:id/draft；changeNote 由调用方弹窗收集）。 */
  async function saveDraft(changeNote: string): Promise<AiPromptVersion> {
    const prompt = selectedPrompt.value
    const version = selectedVersion.value
    if (!prompt || !version || version.status !== 'DRAFT') {
      throw new Error('仅草稿版本可以保存')
    }
    const result = await updateAiPromptDraft(prompt.id, {
      systemPrompt: editorText.value.trim(),
      changeNote: changeNote.trim() || undefined,
    })
    await loadVersions(prompt.id)
    // 保存后仍选中该草稿，编辑内容与服务器一致
    if (result.draft) {
      selectVersion(result.draft.id)
    }
    return version
  }

  /** 发布草稿（发布后新请求将使用该版本）。 */
  async function publishVersion(): Promise<void> {
    const prompt = selectedPrompt.value
    const version = selectedVersion.value
    if (!prompt || !version) {
      throw new Error('请先选择要发布的版本')
    }
    await publishAiPrompt(prompt.id, version.id)
    await loadVersions(prompt.id)
  }

  /** 停用当前生效提示词（该场景新请求将提示配置不完整）。 */
  async function disableActiveVersion(): Promise<void> {
    const prompt = selectedPrompt.value
    if (!prompt) {
      throw new Error('请先选择提示词模板')
    }
    await disableAiPrompt(prompt.id)
    await loadVersions(prompt.id)
  }

  /** 基于历史版本创建新草稿（回滚），成功后自动选中新草稿。 */
  async function rollbackVersion(version: AiPromptVersion): Promise<void> {
    const prompt = selectedPrompt.value
    if (!prompt) {
      throw new Error('请先选择提示词模板')
    }
    const result = await rollbackAiPromptVersion(prompt.id, version.id)
    await loadVersions(prompt.id)
    if (result.draft) {
      selectVersion(result.draft.id)
    }
  }

  /** 删除草稿版本；若删除的是当前选中，自动选中剩余版本。 */
  async function deleteDraftVersion(version: AiPromptVersion): Promise<void> {
    const prompt = selectedPrompt.value
    if (!prompt) {
      throw new Error('请先选择提示词模板')
    }
    await deleteAiPromptVersion(prompt.id, version.id)
    await loadVersions(prompt.id)
  }

  /** 删除未发布过的提示词模板。 */
  async function deletePromptTemplate(): Promise<void> {
    const prompt = selectedPrompt.value
    if (!prompt) {
      throw new Error('请先选择提示词模板')
    }
    await deleteAiPrompt(prompt.id)
    selectedPromptId.value = null
    await loadPrompts()
  }

  /** 新增提示词模板（含首个草稿），成功后自动选中新模板草稿。 */
  async function createPrompt(input: AiPromptDraftInput): Promise<void> {
    const result = await createAiPrompt(input)
    await loadPrompts()
    const nextPromptId = result.prompt?.id
    if (nextPromptId) {
      selectedScene.value = input.scene
      selectedPromptId.value = nextPromptId
      await loadVersions(nextPromptId)
      const draftId = result.prompt?.draftId
      if (draftId) {
        selectVersion(draftId)
      }
    }
  }

  return {
    activeVersionId,
    canEditSelected,
    createPrompt,
    deleteDraftVersion,
    deletePromptTemplate,
    disableActiveVersion,
    draftVersion,
    editorCharCount,
    editorDirty,
    editorText,
    loadPrompts,
    promptError,
    promptStatus,
    prompts,
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
  }
}

/** 供页面使用的确认文案辅助。 */
export function versionActionMessages(promptName: string, version: AiPromptVersion): {
  publish: { content: string, title: string }
  disable: { content: string, title: string }
  rollback: { content: string, title: string }
  delete: { content: string, title: string }
} {
  return {
    publish: {
      content: `发布「${promptName}」v${version.version} 后，该场景的新请求将使用此版本；草稿状态将变为已发布。`,
      title: '发布提示词版本',
    },
    disable: {
      content: `停用后，该场景的新请求将提示配置不完整，直到重新发布其他版本。`,
      title: '停用当前生效提示词',
    },
    rollback: {
      content: `将基于 v${version.version} 创建一份新草稿（原版本保持不变），编辑后发布即可生效。`,
      title: '基于历史版本创建草稿',
    },
    delete: {
      content: `草稿 v${version.version} 将被永久删除，无法恢复。`,
      title: '删除提示词草稿',
    },
  }
}