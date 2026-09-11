<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { postKnowledgeVersionTestQa } from '@/api/modules/knowledge'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import type { KnowledgeQaSource, KnowledgeQaSseEvent, KnowledgeUserTestSource } from '@/types/knowledge'
import { knowledgePageLabel, knowledgeUserMessage } from '@/utils/knowledge-user'

interface TestMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: KnowledgeUserTestSource[]
}

const props = defineProps<{
  visible: boolean
  versionId: string | null
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  'open-content': [source: KnowledgeUserTestSource]
  'open-original': [source: KnowledgeUserTestSource]
}>()

const query = ref('')
const sending = ref(false)
const messages = ref<TestMessage[]>([])
let abortController: AbortController | null = null

const canSend = computed(() => query.value.trim().length > 0 && !sending.value && Boolean(props.versionId))

function toUserTestSource(item: KnowledgeQaSource | KnowledgeUserTestSource): KnowledgeUserTestSource {
  const debugSource = item as KnowledgeQaSource
  const userSource = item as KnowledgeUserTestSource
  return {
    documentId: debugSource.documentId ?? userSource.documentId ?? '',
    versionId: item.versionId,
    title: item.title,
    tocPath: userSource.tocPath ?? debugSource.sectionPath ?? null,
    sectionTitle: userSource.sectionTitle ?? debugSource.section ?? debugSource.chapter ?? null,
    pageLabel: item.pageLabel ?? null,
    physicalPageNumber: item.physicalPageNumber ?? debugSource.pageNumber ?? debugSource.page ?? null,
    matchedText: item.matchedText ?? debugSource.snippet ?? null,
  }
}

function sourceTitle(source: KnowledgeUserTestSource): string {
  const path = source.tocPath?.filter(Boolean).join(' / ')
  return path || source.sectionTitle || source.title
}

function close(): void {
  abortController?.abort()
  emit('update:visible', false)
}

function clearSession(): void {
  abortController?.abort()
  sending.value = false
  messages.value = []
  query.value = ''
}

async function send(): Promise<void> {
  const text = query.value.trim()
  if (!text || !props.versionId || sending.value) {
    return
  }
  sending.value = true
  query.value = ''
  messages.value = [...messages.value, { role: 'user', content: text }, { role: 'assistant', content: '' }]
  const assistantIndex = messages.value.length - 1
  abortController?.abort()
  const controller = new AbortController()
  abortController = controller
  try {
    await postKnowledgeVersionTestQa(props.versionId, { query: text, reasoningMode: 'OFF', limit: 5 }, {
      signal: controller.signal,
      onEvent: (event: KnowledgeQaSseEvent) => {
        if (event.type === 'delta') {
          const current = messages.value[assistantIndex]
          if (current) {
            current.content += event.data.text
          }
        }
        if (event.type === 'done') {
          const current = messages.value[assistantIndex]
          if (current) {
            current.sources = (event.data.sources ?? []).map(item => toUserTestSource(item))
          }
        }
        if (event.type === 'error') {
          const current = messages.value[assistantIndex]
          if (current) {
            current.content = event.data.message || '测试失败'
          }
        }
      },
    })
  }
  catch (cause) {
    if (!controller.signal.aborted) {
      MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message))
      const current = messages.value[assistantIndex]
      if (current && !current.content) {
        current.content = knowledgeUserMessage(normalizeFeedbackError(cause).message)
      }
    }
  }
  finally {
    if (abortController === controller) {
      sending.value = false
    }
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      abortController?.abort()
      sending.value = false
    }
  },
)
</script>

<template>
  <t-drawer
    :footer="false"
    header="测试知识库"
    :visible="visible"
    size="480px"
    @close="close"
    @update:visible="(value: boolean) => emit('update:visible', value)"
  >
    <div class="knowledge-test">
      <p class="knowledge-test__intro">
        向当前知识库提问，看看章节和内容有没有整理对。
      </p>

      <div class="knowledge-test__thread">
        <article v-for="(message, index) in messages" :key="index" class="knowledge-test__message" :class="`is-${message.role}`">
          <strong>{{ message.role === 'user' ? '你' : '筑小格' }}</strong>
          <p>{{ message.content || (sending && index === messages.length - 1 ? '正在生成…' : '') }}</p>
          <div v-if="message.sources?.length" class="knowledge-test__sources">
            <div v-for="(source, sourceIndex) in message.sources" :key="`${source.documentId}-${sourceIndex}`" class="knowledge-test__source">
              <header>
                引用 {{ sourceIndex + 1 }}
                <span>{{ sourceTitle(source) }}</span>
                <em>{{ knowledgePageLabel(source.pageLabel, source.physicalPageNumber) }}</em>
              </header>
              <blockquote v-if="source.matchedText">
                {{ source.matchedText }}
              </blockquote>
              <div class="knowledge-test__source-actions">
                <t-button size="small" theme="primary" variant="text" @click="emit('open-content', source)">
                  查看解析内容
                </t-button>
                <t-button size="small" theme="default" variant="text" @click="emit('open-original', source)">
                  查看原文
                </t-button>
              </div>
            </div>
          </div>
        </article>
      </div>

      <div class="knowledge-test__composer">
        <t-textarea
          v-model="query"
          :autosize="{ minRows: 3, maxRows: 6 }"
          maxlength="500"
          placeholder="例如：这个图集包含哪些保温系统？"
          @keydown.enter.exact.prevent="send"
        />
        <div class="knowledge-test__composer-actions">
          <t-button theme="default" variant="text" @click="clearSession">
            清空
          </t-button>
          <t-button :disabled="!canSend" :loading="sending" theme="primary" @click="send">
            发送
          </t-button>
        </div>
      </div>
    </div>
  </t-drawer>
</template>

<style scoped>
.knowledge-test {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: var(--td-size-4);
}

.knowledge-test__intro {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-test__thread {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--td-size-4);
  overflow: auto;
}

.knowledge-test__message strong {
  color: var(--td-text-color-primary);
}

.knowledge-test__message p {
  margin: var(--td-size-2) 0 0;
  white-space: pre-wrap;
  color: var(--td-text-color-primary);
  line-height: 1.7;
}

.knowledge-test__message.is-user p {
  color: var(--td-text-color-secondary);
}

.knowledge-test__sources {
  display: grid;
  gap: var(--td-size-3);
  margin-top: var(--td-size-3);
}

.knowledge-test__source {
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
}

.knowledge-test__source header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-size-2);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-test__source header span {
  color: var(--td-text-color-primary);
}

.knowledge-test__source em {
  font-style: normal;
}

.knowledge-test__source blockquote {
  margin: var(--td-size-2) 0 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-test__composer-actions,
.knowledge-test__source-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--td-size-2);
}

.knowledge-test__composer {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-3);
}
</style>
