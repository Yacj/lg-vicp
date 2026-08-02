<script setup lang="ts">
import { ref, watch } from 'vue'

/**
 * 报告 HTML 预览对话框：以 iframe 渲染预签名 HTML artifact 地址。
 * 后端无独立预览接口，预览即获取 HTML 文件下载地址后内嵌展示。
 */
const props = defineProps<{
  visible: boolean
  title: string
  url: string
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
}>()

const frameKey = ref(0)

watch(() => props.visible, (visible) => {
  if (visible) {
    frameKey.value += 1
  }
})

function close(): void {
  emit('update:visible', false)
}
</script>

<template>
  <t-dialog
    :cancel-btn="{ content: '关闭' }"
    confirm-btn=""
    :footer="false"
    :header="title"
    :visible="visible"
    width="960px"
    @close="close"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="report-preview-dialog__frame">
      <iframe
        :key="frameKey"
        :src="url"
        class="report-preview-dialog__iframe"
        sandbox="allow-same-origin allow-scripts"
        title="报告预览"
      />
    </div>
  </t-dialog>
</template>

<style scoped>
.report-preview-dialog__frame {
  height: 68vh;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.report-preview-dialog__iframe {
  width: 100%;
  height: 100%;
  border: 0;
  background: var(--td-bg-color-container);
}
</style>