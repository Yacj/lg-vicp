<script setup lang="ts">
import type { ClientSelectableDepartment, ProjectVisibility } from '@/api/types'
import {
  autoSelectDepartmentId,
  canSelectDepartmentVisibility,
  NO_DEPARTMENT_HINT,
} from '@/utils/projectVisibility'

const props = defineProps<{
  departments: ClientSelectableDepartment[]
  departmentsLoading?: boolean
  legacyPublic?: boolean
}>()

const visibility = defineModel<ProjectVisibility | ''>('visibility', { required: true })
const visibleDepartmentId = defineModel<string>('visibleDepartmentId', { required: true })
const includeChildDepartments = defineModel<boolean>('includeChildDepartments', { required: true })

const departmentSheetVisible = ref(false)
const canUseDepartment = computed(() => canSelectDepartmentVisibility(props.departments))
const selectedDepartment = computed(() => props.departments.find(item => item.id === visibleDepartmentId.value))
const departmentLabel = computed(() => selectedDepartment.value?.name || '')
const departmentActions = computed(() => props.departments.map(item => ({
  name: item.pathName || item.name,
})))

const visibilityRadioStyle = [
  '--wot-radio-button-bg: var(--app-bg-surface)',
  '--wot-radio-button-checked-bg: var(--app-action-primary-soft)',
  '--wot-radio-button-border-radius: 8rpx',
  '--wot-radio-button-min-width: 160rpx',
  '--wot-radio-button-padding: 12rpx 28rpx',
  '--wot-radio-label-color: var(--app-text-secondary)',
].join(';')

const visibilityHint = computed(() => {
  if (visibility.value === 'DEPARTMENT') {
    return '指定部门成员可查看'
  }
  return '仅创建者可见'
})

watch(
  () => [visibility.value, props.departments, props.departmentsLoading] as const,
  () => {
    if (visibility.value !== 'DEPARTMENT' || props.departmentsLoading) {
      return
    }
    if (!canUseDepartment.value) {
      return
    }
    visibleDepartmentId.value = autoSelectDepartmentId(props.departments, visibleDepartmentId.value)
  },
  { immediate: true },
)

function openDepartmentSheet() {
  if (props.departments.length <= 1) {
    return
  }
  departmentSheetVisible.value = true
}

function handleDepartmentSelect({ index }: { index: number }) {
  const department = props.departments[index]
  if (department) {
    visibleDepartmentId.value = department.id
  }
}
</script>

<template>
  <view class="project-visibility-fields">
    <view v-if="legacyPublic" class="project-visibility-fields__legacy">
      当前为历史公开项目。新建已不再支持公开，可改为仅自己或部门可见。
    </view>

    <view class="project-visibility-fields__title">
      项目可见范围
    </view>
    <wd-radio-group
      v-model="visibility"
      direction="horizontal"
      type="button"
      :custom-style="visibilityRadioStyle"
    >
      <wd-radio value="PRIVATE">
        仅自己
      </wd-radio>
      <wd-radio value="DEPARTMENT" :disabled="!canUseDepartment">
        部门可见
      </wd-radio>
    </wd-radio-group>
    <view class="project-visibility-fields__desc">
      {{ visibilityHint }}
    </view>
    <view v-if="!canUseDepartment" class="project-visibility-fields__desc">
      {{ NO_DEPARTMENT_HINT }}
    </view>

    <template v-if="visibility === 'DEPARTMENT' && canUseDepartment">
      <view class="project-visibility-fields__title mt-4">
        可见部门
      </view>
      <view
        class="project-visibility-fields__picker"
        :class="{ 'is-disabled': departments.length <= 1 }"
        @click="openDepartmentSheet"
      >
        <text :class="departmentLabel ? 'project-visibility-fields__value' : 'project-visibility-fields__placeholder'">
          {{ departmentsLoading ? '正在加载部门' : (departmentLabel || '请选择') }}
        </text>
        <wd-icon v-if="departments.length > 1" name="arrow-right" size="28rpx" color="var(--app-text-tertiary)" />
      </view>

      <view class="project-visibility-fields__children mt-3">
        <wd-checkbox v-model="includeChildDepartments" shape="square">
          包含下级部门
        </wd-checkbox>
      </view>
    </template>

    <wd-action-sheet
      v-model="departmentSheetVisible"
      :actions="departmentActions"
      cancel-text="取消"
      :z-index="2000"
      @select="handleDepartmentSelect"
    />
  </view>
</template>

<style lang="scss" scoped>
.project-visibility-fields__title {
  margin-bottom: 16rpx;
  color: var(--app-text-primary);
  font-size: 28rpx;
  line-height: 40rpx;
}

.project-visibility-fields__desc {
  margin-top: 8rpx;
  color: var(--app-text-tertiary);
  font-size: 22rpx;
  line-height: 32rpx;
}

.project-visibility-fields__legacy {
  margin-bottom: 20rpx;
  padding: 20rpx;
  border: 1px solid var(--app-border-default);
  border-radius: 12rpx;
  color: var(--app-text-secondary);
  font-size: 24rpx;
  line-height: 36rpx;
  background: var(--app-ai-soft);
}

.project-visibility-fields__picker {
  display: flex;
  min-height: 80rpx;
  align-items: center;
  justify-content: space-between;
  padding: 0 24rpx;
  border-radius: 8rpx;
  background: var(--app-bg-drawer);
}

.project-visibility-fields__value {
  color: var(--app-text-primary);
  font-size: 28rpx;
}

.project-visibility-fields__placeholder {
  color: var(--app-text-tertiary);
  font-size: 28rpx;
}

.project-visibility-fields__children {
  color: var(--app-text-secondary);
}
</style>
