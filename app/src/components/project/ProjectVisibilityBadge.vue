<script setup lang="ts">
import {
  formatDepartmentVisibilityDetails,
  projectVisibilityLabel,
  projectVisibilityTone,
} from '@/utils/projectVisibility'

const props = defineProps<{
  visibility: string
  departmentName?: string | null
  includeChildDepartments?: boolean | null
}>()

const label = computed(() => projectVisibilityLabel(props.visibility))
const tone = computed(() => projectVisibilityTone(props.visibility))
const details = computed(() => formatDepartmentVisibilityDetails({
  visibility: props.visibility,
  departmentName: props.departmentName,
  includeChildDepartments: props.includeChildDepartments,
}))
</script>

<template>
  <view class="project-visibility-badge min-w-0 flex flex-wrap items-center gap-1">
    <text
      class="project-visibility-badge__tag shrink-0"
      :class="`project-visibility-badge__tag--${tone}`"
    >
      {{ label }}
    </text>
    <text
      v-for="item in details"
      :key="item"
      class="project-visibility-badge__detail"
    >
      {{ item }}
    </text>
  </view>
</template>

<style lang="scss" scoped>
.project-visibility-badge__tag {
  padding: 4rpx 10rpx;
  border: 1px solid transparent;
  border-radius: 6rpx;
  font-size: 20rpx;
  line-height: 28rpx;
}

.project-visibility-badge__tag--private {
  border-color: var(--app-border-default);
  color: var(--app-text-tertiary);
  background: var(--app-bg-drawer);
}

.project-visibility-badge__tag--department,
.project-visibility-badge__tag--legacy-public {
  border-color: var(--app-action-primary-soft);
  color: var(--app-action-primary);
  background: var(--app-action-primary-soft);
}

.project-visibility-badge__detail {
  color: var(--app-text-tertiary);
  font-size: 20rpx;
  line-height: 28rpx;
}
</style>
