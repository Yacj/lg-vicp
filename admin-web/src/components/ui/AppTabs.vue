<script setup lang="ts">
import type { DropdownOption } from 'tdesign-vue-next'
import type { AppTab } from '@/stores/tabs'
import { useResizeObserver } from '@vueuse/core'
import { MoreIcon } from 'tdesign-icons-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'

defineOptions({ name: 'AppTabs' })

const settingsStore = useSettingsStore()
const tabsStore = useTabsStore()
const route = useRoute()
const router = useRouter()

const containerRef = ref<HTMLElement | null>(null)
const measureRef = ref<HTMLElement | null>(null)
const visibleCount = ref(tabsStore.tabs.length)
const draggingPath = ref<string | null>(null)

const tabs = computed(() => tabsStore.tabs)
const visibleTabs = computed(() => tabs.value.slice(0, visibleCount.value))
const overflowTabs = computed(() => tabs.value.slice(visibleCount.value))
const currentTabPath = computed(() => (
  tabs.value.find(tab => tab.fullPath === route.fullPath)?.fullPath
  ?? tabsStore.activePath
))
const currentTab = computed(() => tabs.value.find(tab => tab.fullPath === currentTabPath.value) ?? null)
const overflowOptions = computed<DropdownOption[]>(() => overflowTabs.value.map(tab => ({
  content: tab.title,
  value: tab.fullPath,
})))
const toolbarOptions = computed(() => currentTab.value ? contextOptions(currentTab.value) : [])

function isProtected(tab: AppTab): boolean {
  return tab.affix || tab.pinned || !tab.closable
}

function hasClosableBefore(tab: AppTab): boolean {
  const index = tabs.value.findIndex(item => item.fullPath === tab.fullPath)
  return tabs.value.some((item, itemIndex) => itemIndex < index && !isProtected(item))
}

function hasClosableAfter(tab: AppTab): boolean {
  const index = tabs.value.findIndex(item => item.fullPath === tab.fullPath)
  return tabs.value.some((item, itemIndex) => itemIndex > index && !isProtected(item))
}

function hasClosableOther(tab: AppTab): boolean {
  return tabs.value.some(item => item.fullPath !== tab.fullPath && !isProtected(item))
}

function contextOptions(tab: AppTab): DropdownOption[] {
  return [
    { content: '刷新当前页', value: 'refresh' },
    { content: tab.pinned ? '取消固定' : '固定标签', value: tab.pinned ? 'unpin' : 'pin', disabled: tab.affix },
    { content: '关闭标签', value: 'close', disabled: !tab.closable },
    { content: '关闭左侧', value: 'left', disabled: !hasClosableBefore(tab) },
    { content: '关闭右侧', value: 'right', disabled: !hasClosableAfter(tab) },
    { content: '关闭其他', value: 'others', disabled: !hasClosableOther(tab) },
    { content: '关闭全部', value: 'all', disabled: !tabs.value.some(item => !isProtected(item)) },
  ]
}

function activate(path: string): void {
  tabsStore.activePath = path
  void router.push(path)
}

function navigateResult(path: string, currentPath: string): void {
  if (path !== currentPath) {
    void router.push(path)
  }
}

function applyAction(tab: AppTab, option: DropdownOption): void {
  if (typeof option.value !== 'string') {
    return
  }

  const path = tab.fullPath
  switch (option.value) {
    case 'refresh':
      tabsStore.refresh(path)
      break
    case 'pin':
      tabsStore.pin(path)
      break
    case 'unpin':
      tabsStore.unpin(path)
      break
    case 'close':
      navigateResult(tabsStore.close(path), route.fullPath)
      break
    case 'left':
      navigateResult(tabsStore.closeLeft(path), route.fullPath)
      break
    case 'right':
      navigateResult(tabsStore.closeRight(path), route.fullPath)
      break
    case 'others':
      navigateResult(tabsStore.closeOthers(path), route.fullPath)
      break
    case 'all':
      navigateResult(tabsStore.closeAll(), route.fullPath)
      break
  }
}

function handleOverflow(option: DropdownOption): void {
  if (typeof option.value === 'string') {
    activate(option.value)
  }
}

function closeTab(tab: AppTab): void {
  navigateResult(tabsStore.close(tab.fullPath), route.fullPath)
}

function handleAuxClick(event: MouseEvent, tab: AppTab): void {
  if (event.button === 1) {
    event.preventDefault()
    closeTab(tab)
  }
}

function startDragging(event: DragEvent, tab: AppTab): void {
  if (isProtected(tab)) {
    event.preventDefault()
    return
  }
  draggingPath.value = tab.fullPath
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', tab.fullPath)
  }
}

function dropTab(event: DragEvent, target: AppTab): void {
  event.preventDefault()
  const sourcePath = draggingPath.value ?? event.dataTransfer?.getData('text/plain')
  draggingPath.value = null
  if (!sourcePath || sourcePath === target.fullPath || isProtected(target)) {
    return
  }
  const targetIndex = tabs.value.findIndex(tab => tab.fullPath === target.fullPath)
  tabsStore.move(sourcePath, targetIndex)
}

function finishDragging(): void {
  draggingPath.value = null
}

function handleWheel(event: WheelEvent): void {
  const container = containerRef.value
  if (!container || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
    return
  }
  container.scrollLeft += event.deltaY
}

function recalculate(): void {
  const container = containerRef.value
  const measure = measureRef.value
  if (!container || !measure) {
    return
  }

  const widths = [...measure.children].map(node => (node as HTMLElement).offsetWidth)
  const available = container.clientWidth
  if (available <= 0 || widths.every(width => width <= 0)) {
    visibleCount.value = tabs.value.length
    return
  }

  const total = widths.reduce((sum, width) => sum + width, 0)
  const overflowTriggerWidth = total > available ? 72 : 0
  let used = 0
  let count = 0
  for (const width of widths) {
    if (used + width > Math.max(0, available - overflowTriggerWidth)) {
      break
    }
    used += width
    count += 1
  }
  visibleCount.value = Math.max(0, Math.min(count, tabs.value.length))
}

useResizeObserver(containerRef, recalculate)
watch(
  () => tabs.value.map(tab => `${tab.fullPath}:${tab.title}:${tab.pinned}`).join('|'),
  () => void nextTick(recalculate),
  { immediate: true },
)
watch(
  () => settingsStore.settings.tabsStyle,
  () => void nextTick(recalculate),
)
</script>

<template>
  <div
    v-if="settingsStore.settings.showTabs"
    class="app-tabs"
    :class="`is-${settingsStore.settings.tabsStyle}`"
    aria-label="已打开页面"
  >
    <div
      ref="containerRef"
      class="app-tabs__viewport"
      @wheel="handleWheel"
    >
      <div class="app-tabs__list" role="tablist">
        <template v-for="tab in visibleTabs" :key="tab.fullPath">
          <t-dropdown
            :options="contextOptions(tab)"
            placement="bottom-left"
            trigger="context-menu"
            @click="applyAction(tab, $event)"
          >
            <div
              class="app-tabs__tab"
              :class="{
                'is-active': tab.fullPath === route.fullPath,
                'is-dragging': tab.fullPath === draggingPath,
                'is-pinned': tab.pinned || tab.affix,
              }"
              :draggable="!isProtected(tab)"
              role="tab"
              :aria-selected="tab.fullPath === route.fullPath"
              :title="tab.title"
              @auxclick="handleAuxClick($event, tab)"
              @click="activate(tab.fullPath)"
              @dragend="finishDragging"
              @dragover.prevent
              @dragstart="startDragging($event, tab)"
              @drop="dropTab($event, tab)"
            >
              <span class="app-tabs__label">{{ tab.title }}</span>
              <t-button
                v-if="tab.closable"
                aria-label="关闭标签"
                class="app-tabs__close"
                shape="square"
                size="small"
                theme="default"
                variant="text"
                @click.stop="closeTab(tab)"
              >
                ×
              </t-button>
            </div>
          </t-dropdown>
        </template>

        <t-dropdown
          v-if="overflowTabs.length > 0"
          :options="overflowOptions"
          placement="bottom-right"
          trigger="click"
          @click="handleOverflow"
        >
          <t-button aria-label="更多标签" class="app-tabs__more" shape="square" theme="default" variant="text">
            <MoreIcon />
          </t-button>
        </t-dropdown>
      </div>

      <div ref="measureRef" class="app-tabs__measure" aria-hidden="true">
        <span v-for="tab in tabs" :key="tab.fullPath" class="app-tabs__measure-item">
          {{ tab.title }}
        </span>
      </div>
    </div>

    <t-dropdown
      v-if="currentTab"
      :options="toolbarOptions"
      placement="bottom-right"
      trigger="click"
      @click="applyAction(currentTab, $event)"
    >
      <t-button aria-label="标签页操作" class="app-tabs__actions" shape="square" theme="default" variant="text">
        <MoreIcon />
      </t-button>
    </t-dropdown>
  </div>
</template>

<style scoped>
.app-tabs {
  display: flex;
  min-width: 0;
  height: var(--vicp-tabs-height);
  align-items: stretch;
  border-bottom: 1px solid var(--td-component-stroke);
  background: var(--td-bg-color-container);
}

.app-tabs__viewport {
  position: relative;
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
}

.app-tabs__list {
  display: flex;
  min-width: max-content;
  height: 100%;
  align-items: stretch;
  gap: 2px;
  padding-inline: var(--td-size-3);
}

.app-tabs__tab {
  display: inline-flex;
  min-width: 0;
  max-width: 220px;
  height: 100%;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--td-size-2);
  padding: 0 var(--td-size-4);
  border-bottom: 2px solid transparent;
  color: var(--td-text-color-secondary);
  cursor: pointer;
  user-select: none;
}

.app-tabs__tab:hover {
  color: var(--td-text-color-primary);
  background: var(--td-bg-color-secondarycontainer);
}

.app-tabs__tab.is-active {
  color: var(--td-brand-color);
  border-bottom-color: var(--td-brand-color);
  background: var(--td-bg-color-container);
}

.app-tabs__tab.is-dragging {
  opacity: 0.45;
}

.app-tabs__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-tabs__close {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  border: 0;
  border-radius: 50%;
  color: inherit;
  cursor: pointer;
  background: transparent;
  line-height: 1;
}

.app-tabs__close:hover {
  color: var(--td-error-color);
  background: var(--td-error-color-1);
}

.app-tabs__more,
.app-tabs__actions {
  flex: 0 0 var(--vicp-tabs-height);
  border-left: 1px solid var(--td-component-stroke);
  border-radius: 0;
}

.app-tabs__measure {
  position: fixed;
  z-index: -1;
  top: -9999px;
  left: -9999px;
  display: flex;
  visibility: hidden;
  gap: 2px;
  pointer-events: none;
}

.app-tabs__measure-item {
  display: inline-flex;
  min-width: max-content;
  height: var(--vicp-tabs-height);
  align-items: center;
  padding: 0 var(--td-size-4);
  white-space: nowrap;
}

.app-tabs.is-card {
  padding-top: 4px;
  background: var(--td-bg-color-secondarycontainer);
}

.app-tabs.is-card .app-tabs__tab,
.app-tabs.is-chrome .app-tabs__tab {
  height: calc(100% - 4px);
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: var(--td-radius-default) var(--td-radius-default) 0 0;
}

.app-tabs.is-card .app-tabs__tab.is-active,
.app-tabs.is-chrome .app-tabs__tab.is-active {
  border-color: var(--td-component-stroke);
  background: var(--td-bg-color-container);
}

.app-tabs.is-chrome {
  padding-top: 5px;
  background: var(--td-bg-color-secondarycontainer);
}

.app-tabs.is-chrome .app-tabs__tab {
  height: calc(100% - 5px);
}

@media (max-width: 640px) {
  .app-tabs__tab {
    max-width: 160px;
    padding-inline: var(--td-size-3);
  }
}
</style>
