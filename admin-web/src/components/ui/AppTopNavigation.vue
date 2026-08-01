<script setup lang="ts">
import type { DropdownOption } from 'tdesign-vue-next'
import type { SidebarMenuItem } from '@/types/menu'
import { useResizeObserver } from '@vueuse/core'
import { MoreIcon } from 'tdesign-icons-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import { firstNavigablePath } from '@/router/dynamic-routes'

const props = defineProps<{
  menus: SidebarMenuItem[]
  activeId?: string
}>()

const emit = defineEmits<{
  activate: [item: SidebarMenuItem]
  navigate: [path: string]
}>()

const containerRef = ref<HTMLElement | null>(null)
const measureRef = ref<HTMLElement | null>(null)
const visibleCount = ref(props.menus.length)

const visibleMenus = computed(() => props.menus.slice(0, visibleCount.value))
const overflowMenus = computed(() => props.menus.slice(visibleCount.value))
const overflowOptions = computed<DropdownOption[]>(() => overflowMenus.value.map(toDropdownOption))

function toDropdownOption(item: SidebarMenuItem): DropdownOption {
  const children = item.children.map(toDropdownOption)
  return {
    content: item.title,
    value: children.length > 0 ? item.id : firstNavigablePath(item) ?? item.id,
    ...(children.length > 0 ? { children } : {}),
  }
}

function childOptions(item: SidebarMenuItem): DropdownOption[] {
  return item.children.map(toDropdownOption)
}

function handleDropdown(option: DropdownOption): void {
  if (typeof option.value === 'string' && option.value.startsWith('/')) {
    emit('navigate', option.value)
  }
}

function recalculate(): void {
  const container = containerRef.value
  const measure = measureRef.value
  if (!container || !measure) {
    return
  }

  const widths = [...measure.children].map(node => (node as HTMLElement).offsetWidth)
  const available = container.clientWidth
  const total = widths.reduce((sum, width) => sum + width, 0)
  if (available <= 0 || widths.every(width => width <= 0)) {
    visibleCount.value = props.menus.length
    return
  }
  if (total <= available) {
    visibleCount.value = props.menus.length
    return
  }

  const overflowTriggerWidth = 76
  let used = 0
  let count = 0
  for (const width of widths) {
    if (used + width > Math.max(0, available - overflowTriggerWidth)) {
      break
    }
    used += width
    count += 1
  }
  visibleCount.value = count
}

useResizeObserver(containerRef, recalculate)
watch(
  () => props.menus,
  () => void nextTick(recalculate),
  { deep: true, immediate: true },
)
</script>

<template>
  <nav ref="containerRef" class="app-top-nav" aria-label="主导航">
    <template v-for="item in visibleMenus" :key="item.id">
      <t-dropdown
        v-if="item.children.length > 0"
        :options="childOptions(item)"
        placement="bottom-left"
        trigger="hover"
        @click="handleDropdown"
      >
        <t-button
          class="app-top-nav__item"
          :class="{ 'is-active': item.id === activeId }"
          theme="default"
          variant="text"
          @click="emit('activate', item)"
        >
          {{ item.title }}
        </t-button>
      </t-dropdown>
      <t-button
        v-else
        class="app-top-nav__item"
        :class="{ 'is-active': item.id === activeId }"
        theme="default"
        variant="text"
        @click="emit('activate', item)"
      >
        {{ item.title }}
      </t-button>
    </template>

    <t-dropdown
      v-if="overflowMenus.length > 0"
      :options="overflowOptions"
      placement="bottom-right"
      trigger="click"
      @click="handleDropdown"
    >
      <t-button class="app-top-nav__more" theme="default" variant="text">
        <MoreIcon />
        更多
      </t-button>
    </t-dropdown>

    <div ref="measureRef" class="app-top-nav__measure" aria-hidden="true">
      <span v-for="item in menus" :key="item.id" class="app-top-nav__measure-item">
        {{ item.title }}
      </span>
    </div>
  </nav>
</template>

<style scoped>
.app-top-nav {
  position: relative;
  display: flex;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  flex: 1;
  align-items: center;
  gap: var(--td-size-2);
}

.app-top-nav__item,
.app-top-nav__more {
  flex: 0 0 auto;
  white-space: nowrap;
}

.app-top-nav__item.is-active {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
}

.app-top-nav__measure {
  position: fixed;
  z-index: -1;
  top: -9999px;
  left: -9999px;
  display: flex;
  visibility: hidden;
  gap: var(--td-size-2);
  pointer-events: none;
}

.app-top-nav__measure-item {
  display: inline-flex;
  min-width: max-content;
  height: var(--td-comp-size-m);
  align-items: center;
  padding: 0 var(--td-comp-paddingLR-m);
  white-space: nowrap;
}
</style>
