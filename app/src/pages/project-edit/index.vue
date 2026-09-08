<script setup lang="ts">
import type { ApiEnvelope, ProjectRecord, ProjectVisibility, UpdateProjectBody } from '@/api/types'
import { projectApi } from '@/api/modules/projects'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'

definePage({
  name: 'project-edit',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
  },
})

interface ProjectFormRef {
  validate: () => Promise<{ valid: boolean }>
}

type ProjectEditForm = {
  name: string
  region: string
  buildingType: string
  description: string
  visibility: ProjectVisibility
}

const router = useRouter()
const route = useRoute()
const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const { error: showError, success: showSuccess } = useGlobalToast()
const globalLoading = useGlobalLoading()

const projectId = computed(() => String(route.query.id || ''))

const formRef = ref<ProjectFormRef>()
const isSubmitting = ref(false)
const isLoading = ref(true)
const loadError = ref(false)
const originalVisibility = ref<ProjectVisibility>('PRIVATE')
const form = reactive<ProjectEditForm>({
  name: '',
  region: '',
  buildingType: '',
  description: '',
  visibility: 'PRIVATE',
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

const visibilityRadioStyle = [
  '--wot-radio-button-bg: var(--app-bg-surface)',
  '--wot-radio-button-checked-bg: var(--app-action-primary-soft)',
  '--wot-radio-button-border-radius: 8rpx',
  '--wot-radio-button-min-width: 128rpx',
  '--wot-radio-button-padding: 12rpx 28rpx',
  '--wot-radio-label-color: var(--app-text-secondary)',
].join(';')

async function loadProject() {
  if (!projectId.value) {
    showError('缺少项目 ID')
    goBack()
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
    form.visibility = project.visibility
    originalVisibility.value = project.visibility
  }
  catch (error) {
    loadError.value = true
    showError(error instanceof Error ? error.message : '项目加载失败，请重试')
  }
  finally {
    isLoading.value = false
  }
}

async function submit() {
  if (isSubmitting.value) {
    return
  }

  const validation = await formRef.value?.validate()
  if (!validation?.valid) {
    return
  }

  isSubmitting.value = true
  globalLoading.loading('正在保存修改...')
  try {
    // 可见性只能走专用接口，基础信息更新不携带 visibility。
    const payload: UpdateProjectBody = {
      name: form.name.trim(),
      region: form.region.trim() || undefined,
      buildingType: form.buildingType.trim() || undefined,
      description: form.description.trim() || undefined,
    }
    await projectApi.update(projectId.value, payload).send()

    if (form.visibility !== originalVisibility.value) {
      await projectApi.updateVisibility(projectId.value, { visibility: form.visibility }).send()
    }

    showSuccess('保存成功')
    goBack()
  }
  catch (error) {
    showError(error instanceof Error ? error.message : '保存失败，请重试')
  }
  finally {
    isSubmitting.value = false
    globalLoading.close()
  }
}

onMounted(() => {
  if (!requireLogin({ showToast: false })) {
    return
  }
  void loadProject()
})
</script>

<template>
  <view class="app-page app-page--immersive">
    <wd-navbar
      placeholder
      safe-area-inset-top
      left-arrow
      :fixed="true"
      title="编辑项目"
      @click-left="goBack"
    />
    <view class="project-edit-page box-border px-4 py-4 pb-8">
      <view v-if="isLoading" class="app-panel-flat flex items-center justify-center gap-2 py-16">
        <wd-loading size="32rpx" color="var(--app-action-primary)" />
        <text class="app-tertiary text-3">
          正在载入项目信息
        </text>
      </view>

      <view
        v-else-if="loadError"
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
        <view class="project-edit-panel">
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

            <wd-form-item prop="visibility" title="是否可见">
              <view>
                <wd-radio-group
                  v-model="form.visibility"
                  direction="horizontal"
                  type="button"
                  :custom-style="visibilityRadioStyle"
                >
                  <wd-radio value="PRIVATE">
                    私有
                  </wd-radio>
                  <wd-radio value="PUBLIC">
                    公开
                  </wd-radio>
                </wd-radio-group>
                <view class="project-visibility-control__desc">
                  {{ form.visibility === 'PUBLIC' ? '公开后，登录用户可在公开案例中查看' : '仅当前项目创建者可查看与管理' }}
                </view>
              </view>
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
          保存修改
        </wd-button>
      </template>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.project-edit-page {
  width: 100%;
  max-width: 750px;
  margin: 0 auto;
}

.project-edit-panel {
  padding: 12rpx 32rpx;
  border: 1px solid var(--app-border-default);
  border-radius: 12rpx;
  background: var(--app-bg-surface);
}

.project-visibility-control__desc {
  margin-top: 4rpx;
  color: var(--app-text-tertiary);
  font-size: 22rpx;
  line-height: 32rpx;
}
</style>
