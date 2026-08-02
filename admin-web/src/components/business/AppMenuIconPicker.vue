<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import {
  canonicalizeMenuIcon,
  filterMenuIcons,
  isKnownMenuIcon,
  MENU_ICON_OPTIONS,
  searchMenuIcons,
  type MenuIconFilter,
} from '@/components/ui/menu-icons'

const props = withDefaults(defineProps<{
  modelValue: string | null
  disabled?: boolean
  placeholder?: string
}>(), {
  disabled: false,
  placeholder: '请选择图标',
})

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
  change: [value: string | null]
}>()

const visible = ref(false)
const keyword = ref('')
const sourceFilter = ref<MenuIconFilter>('all')
const sourceOptions: Array<{ label: string; value: MenuIconFilter }> = [
  { label: '全部', value: 'all' },
  { label: '组件库', value: 'tdesign' },
  { label: '本地', value: 'local' },
]
const options = computed(() => filterMenuIcons(searchMenuIcons(keyword.value), sourceFilter.value))
const selectedValue = computed(() => canonicalizeMenuIcon(props.modelValue))
const selectedOption = computed(() => MENU_ICON_OPTIONS.find(option => option.value === selectedValue.value) ?? null)

function selectIcon(value: string): void {
  emit('update:modelValue', value)
  emit('change', value)
  visible.value = false
}

function clearIcon(): void {
  emit('update:modelValue', null)
  emit('change', null)
  visible.value = false
}
</script>

<template>
  <t-popup
    v-model:visible="visible"
    :disabled="disabled"
    placement="bottom-left"
    trigger="click"
  >
    <t-button
      block
      :disabled="disabled"
      theme="default"
      variant="outline"
    >
      <template #icon>
        <AppIcon :name="modelValue" />
      </template>
      {{ selectedOption?.label ?? (modelValue ? '未知图标（默认兜底）' : placeholder) }}
    </t-button>
    <template #content>
      <div class="app-menu-icon-picker">
        <t-input
          v-model="keyword"
          clearable
          placeholder="搜索图标名称或关键词"
        />
        <t-radio-group
          v-model="sourceFilter"
          aria-label="图标来源"
          class="app-menu-icon-picker__filters"
          :options="sourceOptions"
          size="small"
          theme="button"
          variant="default-filled"
        />
        <div v-if="options.length > 0" aria-label="图标选项" class="app-menu-icon-picker__grid" role="listbox">
          <div
            v-for="option in options"
            :key="option.value"
            :aria-label="`选择图标 ${option.label}`"
            :aria-selected="option.value === selectedValue"
            class="app-menu-icon-picker__option"
            :class="{ 'is-selected': option.value === selectedValue }"
            role="option"
            tabindex="0"
            @click="selectIcon(option.value)"
            @keydown.enter="selectIcon(option.value)"
            @keydown.space.prevent="selectIcon(option.value)"
          >
            <AppIcon :name="option.value" class="app-menu-icon-picker__icon" />
            <span>{{ option.label }}</span>
          </div>
        </div>
        <t-empty v-else description="没有匹配的图标" />
        <t-button
          v-if="modelValue"
          block
          theme="default"
          variant="text"
          @click="clearIcon"
        >
          清除图标
        </t-button>
        <p v-if="modelValue && !isKnownMenuIcon(modelValue)" class="app-menu-icon-picker__warning">
          当前图标不在本地白名单中，运行时将使用默认图标。
        </p>
      </div>
    </template>
  </t-popup>
</template>

<style scoped>
.app-menu-icon-picker {
  display: grid;
  box-sizing: border-box;
  width: min(420px, 82vw);
  min-width: 0;
  gap: var(--td-size-3);
  padding: var(--td-size-3);
}

.app-menu-icon-picker__filters {
  max-width: 100%;
  overflow-x: auto;
}

.app-menu-icon-picker__grid {
  display: grid;
  min-width: 0;
  max-height: min(320px, 48vh);
  gap: var(--td-size-2);
  overflow-y: auto;
  overscroll-behavior: contain;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.app-menu-icon-picker__option {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  align-items: center;
  justify-content: flex-start;
  gap: var(--td-size-2);
  padding: var(--td-size-2);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  color: var(--td-text-color-secondary);
  background: var(--td-bg-color-container);
  font: inherit;
  line-height: var(--td-line-height-body-medium);
  text-align: left;
  cursor: pointer;
}

.app-menu-icon-picker__option:hover,
.app-menu-icon-picker__option.is-selected {
  border-color: var(--td-brand-color);
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
}

.app-menu-icon-picker__option:focus-visible {
  outline: 2px solid var(--td-brand-color);
  outline-offset: 1px;
}

.app-menu-icon-picker__option span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--td-font-size-body-small);
}

.app-menu-icon-picker__icon {
  display: inline-flex;
  flex: 0 0 var(--td-size-6);
  align-items: center;
  justify-content: center;
  width: var(--td-size-6);
  height: var(--td-size-6);
  font-size: var(--td-font-size-title-medium);
}

.app-menu-icon-picker__warning {
  margin: 0;
  color: var(--td-warning-color);
  font-size: var(--td-font-size-body-small);
}

@media (max-width: 420px) {
  .app-menu-icon-picker__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>