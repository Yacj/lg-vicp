<script setup lang="ts">
import type { ApiEnvelope, CreateProjectBody } from '@/api/types'
import { projectApi } from '@/api/modules/projects'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'

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

type ProjectCreateForm = Required<Pick<CreateProjectBody, 'name' | 'region' | 'buildingType' | 'description' | 'visibility'>>

const router = useRouter()
const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const { error: showError } = useGlobalToast()
const globalLoading = useGlobalLoading()

const formRef = ref<ProjectFormRef>()
const isSubmitting = ref(false)
const form = reactive<ProjectCreateForm>({
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

async function submit() {
  if (!requireLogin() || isSubmitting.value) {
    return
  }

  const validation = await formRef.value?.validate()
  if (!validation?.valid) {
    return
  }

  isSubmitting.value = true
  globalLoading.loading('正在创建项目...')
  try {
    const payload: CreateProjectBody = {
      name: form.name.trim(),
      region: form.region.trim() || undefined,
      buildingType: form.buildingType.trim() || undefined,
      description: form.description.trim() || undefined,
      visibility: form.visibility,
    }
    const response = await projectApi.create(payload).send() as ApiEnvelope<{ project: { id: string } }>

    const projectId = response.data?.project?.id
    router.replace({
      name: 'project-detail',
      query: projectId ? { id: projectId } : {},
    })
  }
  catch (error) {
    showError(error instanceof Error ? error.message : '创建失败，请重试')
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
      title="新建项目"
      @click-left="goBack"
    />
    <view class="project-create-page box-border px-4 py-4 pb-8">
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

          <!-- <wd-form-item prop="region" title="项目地区">
            <wd-input
              v-model="form.region"
              :compact="false"
              :custom-style="inputStyle"
              clearable
              :maxlength="80"
              placeholder="例如：浙江省 · 杭州市"
            />
          </wd-form-item>

          <wd-form-item prop="buildingType" title="建筑类型" >
            <wd-input
              v-model="form.buildingType"
              :compact="false"
              :custom-style="inputStyle"
              clearable
              :maxlength="80"
              placeholder="例如：居住建筑、公共建筑"
            />
          </wd-form-item> -->

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
      type="primary" block :loading="isSubmitting" @click="submit">
        
        创建项目
      </wd-button>
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

.project-visibility-control {
  margin-top: 8rpx;
  padding: 20rpx 24rpx;
  border: 1px solid var(--app-border-default);
  border-radius: 12rpx;
  background: var(--app-bg-drawer);
}

.project-visibility-control__desc {
  margin-top: 4rpx;
  color: var(--app-text-tertiary);
  font-size: 22rpx;
  line-height: 32rpx;
}

.project-create-note {
  padding: 24rpx;
  border: 1px solid var(--app-border-default);
  border-radius: 12rpx;
  background: var(--app-ai-soft);
}
</style>
