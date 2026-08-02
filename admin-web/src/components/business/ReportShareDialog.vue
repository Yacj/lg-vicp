<script setup lang="ts">
import type { DateValue } from 'tdesign-vue-next'
import { computed, ref, watch } from 'vue'
import type { ReportArtifactType, ShareTargetType } from '@/types/report'
import { createShare } from '@/api/modules/reports'
import { useAppFeedback } from '@/composables/useAppFeedback'
import { REPORT_ARTIFACT_LABELS, shareFullUrl } from '@/utils/report'

/**
 * 创建报告分享链接对话框。
 * 分享目标：整份报告（REPORT）或指定文件格式（REPORT_ARTIFACT）。
 * 支持有效期与最大访问次数，均与后端 createShareBodySchema 对齐（均为可选）。
 * 成功创建后展示公开链接并支持复制。
 */
const props = defineProps<{
  visible: boolean
  reportId: string
  artifactTypes: readonly ReportArtifactType[]
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  'success': []
}>()

const feedback = useAppFeedback()

const targetType = ref<ShareTargetType>('REPORT')
const artifactType = ref<ReportArtifactType | ''>('')
const title = ref('')
const expiresAt = ref<DateValue | undefined>(undefined)
const maxViews = ref<number | undefined>(undefined)
const submitting = ref(false)
const createdUrl = ref('')

const artifactOptions = computed(() => props.artifactTypes.map(type => ({
  label: REPORT_ARTIFACT_LABELS[type],
  value: type,
})))

function resetForm(): void {
  targetType.value = 'REPORT'
  artifactType.value = ''
  title.value = ''
  expiresAt.value = undefined
  maxViews.value = undefined
  createdUrl.value = ''
}

watch(() => props.visible, (visible) => {
  if (visible) {
    resetForm()
  }
})

function close(): void {
  emit('update:visible', false)
}

async function submit(): Promise<void> {
  if (submitting.value) {
    return
  }
  if (targetType.value === 'REPORT_ARTIFACT' && !artifactType.value) {
    await feedback.message('warning', '请选择要分享的文件格式')
    return
  }
  submitting.value = true
  try {
    const result = await createShare({
      targetType: targetType.value,
      reportId: props.reportId,
      artifactType: targetType.value === 'REPORT_ARTIFACT'
        ? (artifactType.value as ReportArtifactType)
        : undefined,
      title: title.value.trim() || undefined,
      expiresAt: expiresAt.value instanceof Date
        ? expiresAt.value.toISOString()
        : typeof expiresAt.value === 'string'
          ? expiresAt.value
          : undefined,
      maxViews: maxViews.value,
    })
    createdUrl.value = shareFullUrl(result.url)
    feedback.message('success', result.message)
    emit('success')
  }
  catch (cause) {
    feedback.messageError(cause)
  }
  finally {
    submitting.value = false
  }
}

async function copyUrl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(createdUrl.value)
    await feedback.message('success', '分享链接已复制')
  }
  catch {
    await feedback.message('warning', '复制失败，请手动选择复制')
  }
}
</script>

<template>
  <t-dialog
    :cancel-btn="{ content: '关闭' }"
    :confirm-btn="createdUrl ? { content: '完成' } : { content: '创建分享', loading: submitting }"
    header="创建分享链接"
    :visible="visible"
    width="520px"
    @cancel="close"
    @close="close"
    @confirm="createdUrl ? close() : submit()"
    @update:visible="emit('update:visible', $event)"
  >
    <template v-if="!createdUrl">
      <t-form label-align="top">
        <t-form-item label="分享目标">
          <t-radio-group v-model="targetType">
            <t-radio-button value="REPORT">整份报告</t-radio-button>
            <t-radio-button value="REPORT_ARTIFACT">指定文件</t-radio-button>
          </t-radio-group>
        </t-form-item>
        <t-form-item v-if="targetType === 'REPORT_ARTIFACT'" label="文件格式">
          <t-select v-model="artifactType" :options="artifactOptions" placeholder="请选择文件格式" />
        </t-form-item>
        <t-form-item label="分享标题">
          <t-input
            v-model="title"
            maxlength="160"
            placeholder="选填，默认按分享目标生成"
          />
        </t-form-item>
        <t-form-item label="有效期">
          <t-date-picker
            v-model="expiresAt"
            :disable-date="(date) => new Date(date).getTime() <= Date.now()"
            placeholder="选填，不设置则长期有效"
            value-type="Date"
          />
        </t-form-item>        <t-form-item label="最大访问次数">
          <t-input-number
            v-model="maxViews"
            :max="1000000"
            :min="1"
            placeholder="选填，不设置则不限制"
          />
        </t-form-item>
      </t-form>
      <p class="report-share-dialog__note">
        分享链接公开可访问；禁用或删除分享后链接立即失效。
      </p>
    </template>

    <template v-else>
      <div class="report-share-dialog__result">
        <t-alert theme="success" title="分享链接已创建" />
        <div class="report-share-dialog__url-row">
          <t-input :model-value="createdUrl" readonly />
          <t-button theme="primary" variant="outline" @click="copyUrl">复制</t-button>
        </div>
      </div>
    </template>
  </t-dialog>
</template>

<style scoped>
.report-share-dialog__note {
  margin: var(--td-size-2) 0 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.report-share-dialog__result {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-3);
}

.report-share-dialog__url-row {
  display: flex;
  align-items: center;
  gap: var(--td-size-2);
}
</style>