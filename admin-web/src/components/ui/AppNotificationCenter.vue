<script setup lang="ts">
import type { NotificationType } from '@/types/notification'
import { NotificationIcon } from 'tdesign-icons-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useNotifications } from '@/composables/useNotifications'
import { notificationTypeMeta, notificationTypes } from '@/types/notification'
import { formatDate } from '@/utils/day'

/**
 * Header 消息通知中心：铃铛 + 未读角标 + 弹出面板。
 * 一期类型：AI 新反馈 / 标准待审核 / 知识解析失败 / 报告生成失败；
 * 轮询读取未读数（60s），点击条目跳转对应业务页面并单条已读。
 */

defineOptions({ name: 'AppNotificationCenter' })

const router = useRouter()
const {
  unreadCount,
  items,
  total,
  page,
  pageSize,
  listLoading,
  listError,
  typeFilter,
  unreadOnly,
  startPolling,
  stopPolling,
  loadPage,
  markRead,
  markAllRead,
  changePage,
  applyFilter,
} = useNotifications()

const visible = defineModel<boolean>('visible', { default: false })
const actionError = ref('')

onMounted(() => {
  startPolling()
})

onUnmounted(() => {
  stopPolling()
})

function onVisibleChange(value: boolean): void {
  if (value) {
    void loadPage(1)
  }
}

const filterOptions = computed(() => [
  { label: '全部', value: '' },
  ...notificationTypes.map(type => ({ label: notificationTypeMeta[type].label, value: type })),
])

function onFilterChange(value: unknown): void {
  applyFilter(String(value || '') as NotificationType | '', unreadOnly.value)
}

function onUnreadOnlyChange(value: unknown): void {
  applyFilter(typeFilter.value, value === true)
}

async function openItem(id: string, type: NotificationType, readAt: string | null): Promise<void> {
  if (!readAt) {
    try {
      await markRead(id)
    }
    catch {
      // 已读标记失败不阻塞跳转
    }
  }
  visible.value = false
  void router.push(notificationTypeMeta[type].route)
}

async function markAll(): Promise<void> {
  try {
    await markAllRead()
    actionError.value = ''
  }
  catch (cause) {
    actionError.value = normalizeFeedbackError(cause).message
  }
}

const errorText = computed(() =>
  actionError.value
  || (listError.value ? normalizeFeedbackError(listError.value).message : ''))
</script>

<template>
  <t-popup
    v-model="visible"
    placement="bottom-right"
    trigger="click"
    show-arrow
    @visible-change="onVisibleChange"
  >
    <t-badge :count="unreadCount" :offset="[2, 2]" size="small">
      <t-button
        aria-label="通知"
        shape="square"
        theme="default"
        variant="text"
        @click="visible = !visible"
      >
        <NotificationIcon />
      </t-button>
    </t-badge>

    <template #content>
      <div class="app-notify">
        <header class="app-notify__head">
          <strong>消息通知</strong>
          <t-button :disabled="unreadCount === 0" size="small" theme="default" variant="text" @click="markAll">
            全部已读
          </t-button>
        </header>

        <div class="app-notify__filters">
          <t-select
            :value="typeFilter"
            :options="filterOptions"
            size="small"
            style="width: 132px"
            @change="onFilterChange"
          />
          <t-checkbox :checked="unreadOnly" size="small" @change="onUnreadOnlyChange">
            仅未读
          </t-checkbox>
        </div>

        <t-alert v-if="errorText" theme="error" :message="errorText" size="small" />

        <div v-if="listLoading && items.length === 0" class="app-notify__state">
          <t-loading size="small" text="加载中..." />
        </div>
        <p v-else-if="items.length === 0" class="app-notify__empty">
          暂无通知
        </p>
        <ul v-else class="app-notify__list">
          <li
            v-for="item in items"
            :key="item.id"
            class="app-notify__item"
            role="button"
            tabindex="0"
            @click="openItem(item.id, item.type, item.readAt)"
            @keydown.enter="openItem(item.id, item.type, item.readAt)"
          >
            <span class="app-notify__dot" :class="{ 'is-unread': !item.readAt }" aria-hidden="true" />
            <div class="app-notify__body">
              <div class="app-notify__item-head">
                <t-tag size="small" variant="light" :theme="!item.readAt ? 'primary' : 'default'">
                  {{ notificationTypeMeta[item.type]?.label ?? item.type }}
                </t-tag>
                <span class="app-notify__time">{{ formatDate(new Date(item.createdAt), 'MM-DD HH:mm') }}</span>
              </div>
              <span class="app-notify__title" :class="{ 'is-unread': !item.readAt }">{{ item.title }}</span>
              <span v-if="item.content" class="app-notify__content">{{ item.content }}</span>
            </div>
          </li>
        </ul>

        <t-pagination
          v-if="total > pageSize"
          class="app-notify__pager"
          size="small"
          :current="page"
          :page-size="pageSize"
          :show-page-number="false"
          :show-jumper="false"
          :total="total"
          @current-change="changePage"
        />
      </div>
    </template>
  </t-popup>
</template>

<style scoped>
.app-notify {
  display: flex;
  width: 340px;
  max-width: 84vw;
  flex-direction: column;
  gap: var(--td-size-2);
}

.app-notify__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.app-notify__head strong {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
}

.app-notify__filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-2);
}

.app-notify__list {
  display: flex;
  max-height: 380px;
  margin: 0;
  padding: 0;
  flex-direction: column;
  list-style: none;
  overflow-y: auto;
}

.app-notify__item {
  display: flex;
  align-items: flex-start;
  gap: var(--td-size-2);
  padding: var(--td-size-3) var(--td-size-2);
  border-radius: var(--td-radius-small);
  cursor: pointer;
}

.app-notify__item:hover {
  background: var(--td-bg-color-container-hover);
}

.app-notify__dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  margin-top: var(--td-size-3);
  border-radius: var(--td-radius-circle);
  background: var(--td-gray-color-4);
}

.app-notify__dot.is-unread {
  background: var(--td-brand-color);
}

.app-notify__body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.app-notify__item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-2);
}

.app-notify__time {
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
  white-space: nowrap;
}

.app-notify__title {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  line-height: 1.5;
}

.app-notify__title.is-unread {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}

.app-notify__content {
  overflow: hidden;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-notify__empty {
  margin: 0;
  padding: var(--td-size-8) 0;
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
  text-align: center;
}

.app-notify__state {
  display: grid;
  padding: var(--td-size-8) 0;
  place-content: center;
}

.app-notify__pager {
  justify-content: center;
}
</style>
