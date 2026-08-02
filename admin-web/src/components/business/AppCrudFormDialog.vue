<script setup lang="ts">
import type { FormInstanceFunctions, FormRules } from 'tdesign-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import type { CrudDrawerMode } from '@/types/crud'

const props = withDefaults(defineProps<{
  visible: boolean
  mode: CrudDrawerMode
  formData: Record<string, unknown>
  rules?: FormRules
  title?: string
  description?: string
  labelWidth?: string | number
  width?: string | number
  columns?: 1 | 2
  submitting?: boolean
  readonly?: boolean
  confirmText?: string
  cancelText?: string
}>(), {
  rules: undefined,
  title: '',
  description: '',
  labelWidth: 104,
  width: 'min(640px, 92vw)',
  columns: 1,
  submitting: false,
  readonly: false,
  confirmText: '保存',
  cancelText: '取消',
})

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  'submit': []
  'cancel': []
}>()

const formRef = ref<FormInstanceFunctions | null>(null)
const resolvedTitle = computed(() => props.title || ({
  create: '新增',
  edit: '编辑',
  view: '查看',
})[props.mode])
const isReadonly = computed(() => props.mode === 'view' || props.readonly)
const confirmButton = computed(() => props.mode === 'view'
  ? null
  : {
      content: props.confirmText,
      disabled: props.submitting,
      loading: props.submitting,
      theme: 'primary' as const,
    })
const cancelButton = computed(() => ({
  content: props.mode === 'view' ? '关闭' : props.cancelText,
  disabled: props.submitting,
}))

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) {
      return
    }
    await nextTick()
    formRef.value?.clearValidate()
  },
)

function close(): void {
  if (props.submitting) {
    return
  }
  emit('update:visible', false)
  emit('cancel')
}

async function submit(): Promise<void> {
  if (props.submitting || isReadonly.value) {
    return
  }
  const result = await formRef.value?.validate()
  if (result === true) {
    emit('submit')
  }
}

defineExpose({
  clearValidate: () => formRef.value?.clearValidate(),
  validate: () => formRef.value?.validate(),
})
</script>

<template>
  <t-dialog
    :cancel-btn="cancelButton"
    :close-on-esc-keydown="!submitting"
    :close-on-overlay-click="false"
    :confirm-btn="confirmButton"
    destroy-on-close
    :header="resolvedTitle"
    :prevent-scroll-through="true"
    :visible="visible"
    :width="width"
    @close="close"
    @confirm="submit"
  >
    <p v-if="description" class="app-crud-form-dialog__description">
      {{ description }}
    </p>
    <t-form
      ref="formRef"
      class="app-crud-form-dialog__form"
      :class="{ 'is-two-column': columns === 2 }"
      :data="formData"
      :disabled="submitting"
      label-align="top"
      layout="vertical"
      prevent-submit-default
      :readonly="isReadonly"
      :rules="rules"
      scroll-to-first-error="smooth"
      @submit="submit"
    >
      <slot :data="formData" :mode="mode" :readonly="isReadonly" />
    </t-form>
  </t-dialog>
</template>

<style scoped>
.app-crud-form-dialog__description {
  margin: 0 0 var(--td-size-5);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-small);
}

.app-crud-form-dialog__form {
  display: grid;
  min-width: 0;
  gap: var(--td-size-4);
}

.app-crud-form-dialog__form.is-two-column {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.app-crud-form-dialog__form :deep(.t-form__item) {
  margin: 0;
}

/* 错误消息为 absolute 定位不占布局空间，错误态表单项需预留占位并保持与下一行的间距 */
.app-crud-form-dialog__form :deep(.t-form__item.t-is-error) {
  margin-bottom: calc(var(--td-line-height-body-small) + var(--td-size-3));
}

.app-crud-form-dialog__form :deep(.t-form__item.t-is-error .t-input__extra) {
  bottom: calc(-1 * var(--td-line-height-body-small) - var(--td-size-1));
}

@media (max-width: 720px) {
  .app-crud-form-dialog__form.is-two-column {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>