<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fetchMyProjects } from '@/api/modules/projects'
import { createReport } from '@/api/modules/reports'
import { useAppFeedback } from '@/composables/useAppFeedback'
import { useReportTypes } from '@/composables/useReportTypes'
import type { ProjectItem } from '@/types/project'
import type { PublicReportType } from '@/types/report'
import {
  buildCreateReportInput,
  REPORT_PROJECT_REQUIRED_MESSAGE,
} from '@/utils/report'

/**
 * 生成报告：普通业务只选择报告类型；有项目则带上，无项目且 requiresProject 时拦截。
 * 不选择模板、模板版本或变量。
 */
const props = defineProps<{
  visible: boolean
  projectId?: string
  projectName?: string
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  'success': []
}>()

const feedback = useAppFeedback()
const { error: typesError, load: loadTypes, types } = useReportTypes()

const reportType = ref('')
const selectedProjectId = ref('')
const projects = ref<ProjectItem[]>([])
const projectsLoading = ref(false)
const submitting = ref(false)

const scopedProject = computed(() => Boolean(props.projectId))

const selectedType = computed<PublicReportType | undefined>(() =>
  types.value.find(item => item.code === reportType.value))

const requiresProject = computed(() => selectedType.value?.requiresProject === true)

const projectHint = computed(() => {
  if (!requiresProject.value) {
    return ''
  }
  if (props.projectId || selectedProjectId.value) {
    return ''
  }
  return REPORT_PROJECT_REQUIRED_MESSAGE
})

const typeOptions = computed(() => types.value.map(item => ({
  label: item.name,
  value: item.code,
})))

const projectOptions = computed(() => projects.value.map(item => ({
  label: item.name,
  value: item.id,
})))

async function loadProjects(): Promise<void> {
  if (scopedProject.value) {
    return
  }
  projectsLoading.value = true
  try {
    const result = await fetchMyProjects({ page: 1, pageSize: 100 })
    projects.value = result.items
  }
  catch (cause) {
    feedback.messageError(cause)
  }
  finally {
    projectsLoading.value = false
  }
}

watch(() => props.visible, async (visible) => {
  if (!visible) {
    return
  }
  selectedProjectId.value = props.projectId ?? ''
  const catalog = await loadTypes()
  reportType.value = catalog[0]?.code ?? ''
  if (typesError.value) {
    feedback.messageError(typesError.value)
  }
  else if (catalog.length === 0) {
    feedback.message('warning', '暂无可用报告类型')
  }
  await loadProjects()
})

function close(): void {
  emit('update:visible', false)
}

async function submit(): Promise<void> {
  if (submitting.value) {
    return
  }
  const payload = buildCreateReportInput({
    projectId: props.projectId || selectedProjectId.value,
    reportType: reportType.value,
    requiresProject: requiresProject.value,
  })
  if (!payload.ok) {
    await feedback.message('warning', payload.message)
    return
  }
  submitting.value = true
  try {
    const result = await createReport(payload.input)
    feedback.message('success', result.message)
    close()
    emit('success')
  }
  catch (cause) {
    feedback.messageError(cause)
  }
  finally {
    submitting.value = false
  }
}

watch(() => props.projectId, (id) => {
  selectedProjectId.value = id ?? ''
})
</script>

<template>
  <t-dialog
    cancel-btn="取消"
    :confirm-btn="{ content: '生成报告', loading: submitting }"
    header="生成报告"
    :visible="visible"
    width="520px"
    @cancel="close"
    @close="close"
    @confirm="submit"
    @update:visible="emit('update:visible', $event)"
  >
    <t-form label-align="top">
      <t-form-item label="报告类型" required-mark>
        <t-select
          v-model="reportType"
          :options="typeOptions"
          placeholder="请选择报告类型"
        />
        <p v-if="selectedType" class="report-create-dialog__hint">
          {{ selectedType.description }}
        </p>
      </t-form-item>

      <t-form-item v-if="scopedProject" label="项目">
        <t-input :model-value="projectName || '当前项目'" disabled />
      </t-form-item>

      <t-form-item v-else :label="requiresProject ? '项目' : '项目（可选）'">
        <t-select
          v-model="selectedProjectId"
          clearable
          :loading="projectsLoading"
          :options="projectOptions"
          placeholder="选择关联项目"
        />
      </t-form-item>

      <t-alert v-if="projectHint" class="report-create-dialog__alert" theme="warning">
        {{ projectHint }}
      </t-alert>
    </t-form>
  </t-dialog>
</template>

<style scoped>
.report-create-dialog__hint {
  width: 100%;
  margin: var(--td-size-2) 0 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.report-create-dialog__alert {
  margin-top: var(--td-size-2);
}
</style>
