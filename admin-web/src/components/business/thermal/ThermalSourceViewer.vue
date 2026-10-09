<script setup lang="ts">
import { ref, watch } from 'vue'
import { fetchKnowledgePageRecognition } from '@/api/modules/knowledge'
import { businessUserError } from '@/utils/business-error'

/**
 * 来源回溯查看器：统一展示知识库原始页面图片。
 * 权限由调用方决定（后端 GET /pages/:pageId/recognition 要求 DOC_LIST）；
 * 本组件只负责取图与三态（加载 / 有图 / 无图或失败）展示。
 */
const props = withDefaults(defineProps<{
  pageId?: string | null
  title?: string
  /** 摘要行，例如「ATLAS-A · 来源资料第 12 页」 */
  caption?: string
  /** 无图片时的说明 */
  emptyDescription?: string
}>(), {
  pageId: null,
  title: '原始页面',
  caption: '',
  emptyDescription: '该页面暂无可查看的页面图片',
})

const visible = defineModel<boolean>('visible', { required: true })

const loading = ref(false)
const imageUrl = ref<string | null>(null)
const errorMessage = ref<string | null>(null)
/** 竞态保护：关闭或切换页面后丢弃在途响应。 */
let requestToken = 0

async function loadImage(pageId: string): Promise<void> {
  const token = ++requestToken
  loading.value = true
  errorMessage.value = null
  imageUrl.value = null
  try {
    const recognition = await fetchKnowledgePageRecognition(pageId)
    if (token !== requestToken) {
      return
    }
    imageUrl.value = recognition.pageImageUrl
  }
  catch (cause) {
    if (token !== requestToken) {
      return
    }
    errorMessage.value = businessUserError(cause)
  }
  finally {
    if (token === requestToken) {
      loading.value = false
    }
  }
}

watch([visible, () => props.pageId], ([open, pageId]) => {
  if (!open) {
    requestToken += 1
    return
  }
  if (!pageId) {
    imageUrl.value = null
    errorMessage.value = null
    loading.value = false
    return
  }
  void loadImage(pageId)
}, { immediate: true })
</script>

<template>
  <t-dialog
    v-model:visible="visible"
    destroy-on-close
    :footer="false"
    :header="title"
    width="min(1000px, 94vw)"
  >
    <div class="thermal-source">
      <p v-if="caption" class="thermal-source__caption">
        {{ caption }}
      </p>
      <t-loading v-if="loading" loading text="正在加载原始页面" />
      <t-alert v-else-if="errorMessage" theme="error" :message="errorMessage">
        <t-button v-if="pageId" size="small" variant="text" @click="loadImage(pageId)">重试加载</t-button>
      </t-alert>
      <img v-else-if="imageUrl" :src="imageUrl" alt="原始页面">
      <t-empty v-else :description="emptyDescription" />
    </div>
  </t-dialog>
</template>

<style scoped>
.thermal-source {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-3);
}

.thermal-source__caption {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.thermal-source img {
  max-width: 100%;
  max-height: 72vh;
  object-fit: contain;
}
</style>
