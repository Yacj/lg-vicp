<script setup lang="ts">
import type { ApiEnvelope, ApiPage, CreateProjectBody, ProjectRecord, ProjectVisibility, UpdateProjectBody } from '@/api/types'
import { aiApi } from '@/api/modules/ai'
import { projectApi } from '@/api/modules/projects'
import { reportApi } from '@/api/modules/reports'
import ProjectVisibilityFields from '@/components/project/ProjectVisibilityFields.vue'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { useSelectableDepartments } from '@/composables/useSelectableDepartments'
import { buildProjectVisibilityPayload, isLegacyPublicVisibility, isWriteVisibility } from '@/utils/projectVisibility'

definePage({
  name: 'project-create',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
  },
})

interface ProjectFormRef {
  validate: () => Promise<{ valid: boolean }>
}

interface ProjectForm {
  name: string
  region: string
  buildingType: string
  description: string
  visibility: ProjectVisibility | ''
  visibleDepartmentId: string
  includeChildDepartments: boolean
}

const router = useRouter()
const route = useRoute()
const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const { error: showError, success: showSuccess } = useGlobalToast()
const globalLoading = useGlobalLoading()
const { departments, loading: departmentsLoading, load: loadDepartments } = useSelectableDepartments()

function routeText(value: unknown) {
  if (Array.isArray(value)) {
    return String(value[0] || '')
  }
  return String(value || '')
}

const projectId = computed(() => routeText(route.query.id) || routeText(route.params.id))
const isEditing = computed(() => Boolean(projectId.value))
const pageTitle = computed(() => isEditing.value ? '编辑项目' : '新建项目')

const formRef = ref<ProjectFormRef>()
const isSubmitting = ref(false)
const isLoading = ref(false)
const loadError = ref(false)
const hasBoundAssets = ref(false)
const storedVisibility = ref('')
const originalVisibleDepartmentId = ref('')
const originalIncludeChildDepartments = ref(true)
const form = reactive<ProjectForm>({
  name: '',
  region: '',
  buildingType: '',
  description: '',
  visibility: 'PRIVATE',
  visibleDepartmentId: '',
  includeChildDepartments: true,
})

const isLegacyPublic = computed(() => isLegacyPublicVisibility(storedVisibility.value))
const visibilityChanged = computed(() => {
  if (!isWriteVisibility(form.visibility)) {
    return false
  }
  if (storedVisibility.value !== form.visibility) {
    return true
  }
  if (form.visibility !== 'DEPARTMENT') {
    return false
  }
  return form.visibleDepartmentId !== originalVisibleDepartmentId.value
    || form.includeChildDepartments !== originalIncludeChildDepartments.value
})

const projectFormSchema = {
  validate(model: Record<string, unknown>) {
    return String(model.name || '').trim()
      ? []
      : [{ path: ['name'], message: '请输入项目名称' }]
  },
  isRequired(path: string) {
    return path === 'name'
  },
}

const formStyle = [
  '--wot-cell-bg: transparent',
  '--wot-cell-title-color: var(--app-text-primary)',
  '--wot-cell-label-color: var(--app-text-tertiary)',
  '--wot-cell-padding: 20rpx 0',
].join(';')

const inputStyle = [
  '--wot-input-padding: 0 24rpx',
  '--wot-input-bg: var(--app-bg-drawer)',
  '--wot-input-inner-height: 80rpx',
  '--wot-input-inner-font-size: 28rpx',
  '--wot-input-inner-color: var(--app-text-primary)',
  '--wot-input-inner-placeholder-color: var(--app-text-tertiary)',
  '--wot-input-icon-color: var(--app-text-tertiary)',
].join(';')

const textareaStyle = [
  '--wot-textarea-padding: 20rpx 24rpx',
  '--wot-textarea-bg: var(--app-bg-drawer)',
  '--wot-textarea-inner-min-height: 144rpx',
  '--wot-textarea-inner-font-size: 28rpx',
  '--wot-textarea-inner-line-height: 42rpx',
  '--wot-textarea-inner-color: var(--app-text-primary)',
  '--wot-textarea-inner-placeholder-color: var(--app-text-tertiary)',
].join(';')

onMounted(() => {
  if (!requireLogin({ showToast: false })) {
    return
  }
  void loadDepartments()
  if (isEditing.value) {
    void loadProject()
  }
})

watch(projectId, (id, prev) => {
  if (id && id !== prev) {
    void loadProject()
  }
})

async function loadProject() {
  if (!projectId.value) {
    return
  }

  isLoading.value = true
  loadError.value = false
  try {
    const response = await projectApi.getDetail(projectId.value).send() as ApiEnvelope<{ project: ProjectRecord }>
    const project = response.data?.project
    if (!project) {
      throw new Error('项目不存在或已删除')
    }
    if (!project.canManage) {
      showError('只有项目创建者或超级管理员可以编辑项目')
      goBack()
      return
    }

    form.name = project.name
    form.region = project.region || ''
    form.buildingType = project.buildingType || ''
    form.description = project.description || ''
    storedVisibility.value = project.visibility
    originalVisibleDepartmentId.value = project.visibleDepartmentId || ''
    originalIncludeChildDepartments.value = project.includeChildDepartments !== false
    form.visibility = isWriteVisibility(project.visibility) ? project.visibility : ''
    form.visibleDepartmentId = project.visibleDepartmentId || ''
    form.includeChildDepartments = project.includeChildDepartments !== false
    hasBoundAssets.value = await loadBoundAssetFlag(project.id)
  }
  catch (error) {
    loadError.value = true
    showError(error instanceof Error ? error.message : '项目加载失败，请重试')
  }
  finally {
    isLoading.value = false
  }
}

async function loadBoundAssetFlag(id: string) {
  try {
    const [conversationResponse, reportResponse] = await Promise.all([
      aiApi.listConversations({
        projectId: id,
        clientApp: 'c_app',
        page: 1,
        pageSize: 1,
      }).send() as Promise<ApiEnvelope<ApiPage<unknown>>>,
      reportApi.listMy({
        projectId: id,
        page: 1,
        pageSize: 1,
      }).send() as Promise<ApiEnvelope<ApiPage<unknown>>>,
    ])
    return Boolean((conversationResponse.data?.total || 0) + (reportResponse.data?.total || 0))
  }
  catch {
    return false
  }
}

function resolveVisibilityPayload(required: boolean) {
  if (!required && !visibilityChanged.value) {
    return { ok: true as const, data: null }
  }
  const payload = buildProjectVisibilityPayload({
    visibility: form.visibility,
    visibleDepartmentId: form.visibleDepartmentId,
    includeChildDepartments: form.includeChildDepartments,
    departments: departments.value,
  })
  if (!payload.ok) {
    showError(payload.error)
    return payload
  }
  return { ok: true as const, data: payload.data }
}

async function submit() {
  if (!requireLogin() || isSubmitting.value) {
    return
  }

  const validation = await formRef.value?.validate()
  if (!validation?.valid) {
    return
  }

  const visibilityPayload = resolveVisibilityPayload(!isEditing.value)
  if (!visibilityPayload.ok) {
    return
  }
  if (!isEditing.value && !visibilityPayload.data) {
    showError('请选择仅自己或部门可见')
    return
  }

  isSubmitting.value = true
  globalLoading.loading(isEditing.value ? '正在保存修改...' : '正在创建项目...')
  try {
    if (isEditing.value) {
      const payload: UpdateProjectBody = {
        name: form.name.trim(),
        region: form.region.trim() || undefined,
        buildingType: form.buildingType.trim() || undefined,
        description: form.description.trim() || undefined,
      }
      await projectApi.update(projectId.value, payload).send()
      if (visibilityPayload.data) {
        await projectApi.updateVisibility(projectId.value, visibilityPayload.data).send()
      }
      showSuccess('保存成功')
      goBack()
      return
    }

    const payload: CreateProjectBody = {
      name: form.name.trim(),
      region: form.region.trim() || undefined,
      buildingType: form.buildingType.trim() || undefined,
      description: form.description.trim() || undefined,
      ...visibilityPayload.data,
    }
    const response = await projectApi.create(payload).send() as ApiEnvelope<{ project: { id: string } }>
    const createdId = response.data?.project?.id
    router.replace({
      name: 'project-detail',
      params: createdId ? { id: createdId } : {},
    })
  }
  catch (error) {
    showError(error instanceof Error ? error.message : isEditing.value ? '保存失败，请重试' : '创建失败，请重试')
  }
  finally {
    isSubmitting.value = false
    globalLoading.close()
  }
}
</script>

<template>
  <view class="app-page app-page--immersive">
    <wd-navbar
      placeholder
      safe-area-inset-top
      left-arrow
      :fixed="true"
      :title="pageTitle"
      @click-left="goBack"
    />
    <view class="project-create-page box-border px-4 py-4 pb-8">
      <view v-if="isEditing && isLoading" class="app-panel-flat flex items-center justify-center gap-2 py-16">
        <wd-loading size="32rpx" color="var(--app-action-primary)" />
        <text class="app-tertiary text-3">
          正在载入项目信息
        </text>
      </view>

      <view
        v-else-if="isEditing && loadError"
        class="app-panel-flat flex flex-col items-center justify-center px-6 py-16 text-center"
      >
        <wd-icon name="warning" size="56rpx" color="var(--app-danger)" />
        <text class="mt-3 text-3.5 font-medium">
          项目加载失败
        </text>
        <text class="app-muted mt-1 text-2.5">
          请检查网络后重试
        </text>
        <wd-button size="small" plain custom-class="mt-4!" @click="loadProject">
          重新加载
        </wd-button>
      </view>

      <template v-else>
        <view v-if="isEditing && hasBoundAssets" class="project-create-note mb-3">
          该项目已有对话或报告。修改地区或建筑类型可能影响后续 AI 语境。
        </view>

        <view class="project-create-panel">
          <wd-form
            ref="formRef"
            :model="form"
            :schema="projectFormSchema"
            :custom-style="formStyle"
            error-type="message"
            layout="vertical"
            validate-trigger="blur"
          >
            <wd-form-item prop="name" title="项目名称" required>
              <wd-input
                v-model="form.name"
                :compact="false"
                :custom-style="inputStyle"
                clearable
                :maxlength="120"
                placeholder="例如：滨江花园住宅项目"
              />
            </wd-form-item>

            <wd-form-item prop="region" title="项目地区">
              <wd-input
                v-model="form.region"
                :compact="false"
                :custom-style="inputStyle"
                clearable
                :maxlength="80"
                placeholder="例如：浙江省 · 杭州市"
              />
            </wd-form-item>

            <wd-form-item prop="buildingType" title="建筑类型">
              <wd-input
                v-model="form.buildingType"
                :compact="false"
                :custom-style="inputStyle"
                clearable
                :maxlength="80"
                placeholder="例如：居住建筑、公共建筑"
              />
            </wd-form-item>

            <wd-form-item prop="description" title="项目说明">
              <wd-textarea
                v-model="form.description"
                :compact="false"
                :custom-style="textareaStyle"
                auto-height
                clearable
                :maxlength="2000"
                placeholder="补充项目背景、节能等级或其他备注"
                show-word-limit
              />
            </wd-form-item>

            <wd-form-item prop="visibility">
              <ProjectVisibilityFields
                v-model:visibility="form.visibility"
                v-model:visible-department-id="form.visibleDepartmentId"
                v-model:include-child-departments="form.includeChildDepartments"
                :departments="departments"
                :departments-loading="departmentsLoading"
                :legacy-public="isLegacyPublic"
              />
            </wd-form-item>
          </wd-form>
        </view>

        <wd-button
          custom-class="!mt-5"
          type="primary"
          block
          :loading="isSubmitting"
          @click="submit"
        >
          {{ isEditing ? '保存修改' : '创建项目' }}
        </wd-button>
      </template>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.project-create-page {
  width: 100%;
  max-width: 750px;
  margin: 0 auto;
}

.project-create-panel {
  padding: 12rpx 32rpx;
  border: 1px solid var(--app-border-default);
  border-radius: 12rpx;
  background: var(--app-bg-surface);
}

.project-create-note {
  padding: 24rpx;
  border: 1px solid var(--app-border-default);
  border-radius: 12rpx;
  color: var(--app-text-secondary);
  font-size: 24rpx;
  line-height: 36rpx;
  background: var(--app-ai-soft);
}
</style>
