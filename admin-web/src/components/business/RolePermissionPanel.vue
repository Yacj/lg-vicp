<script setup lang="ts">
import { computed } from 'vue'
import AppPermissionSelector from '@/components/business/AppPermissionSelector.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import type { useRolePermissionScope } from '@/composables/useRolePermissionScope'
import { dataScopeDescription } from '@/composables/useRolePermissionScope'
import type { SystemDataScope } from '@/types/system-management'
import { DATA_SCOPE_OPTIONS, getDataScopeLabel, toDepartmentPermissionOptions } from '@/utils/system-role'

export type RolePermissionScopeInstance = ReturnType<typeof useRolePermissionScope>

const props = defineProps<{
  scope: RolePermissionScopeInstance
}>()

const roleCode = computed(() => props.scope.state.value.role?.code ?? '')

const departmentOptions = computed(() =>
  toDepartmentPermissionOptions(props.scope.state.value.departmentTree ?? []))

const departmentErrorDescription = computed(() =>
  props.scope.departmentError.value ? normalizeFeedbackError(props.scope.departmentError.value).message : '')

function onDataScopeChange(value: unknown): void {
  props.scope.setDataScope(String(value) as SystemDataScope)
}
</script>

<template>
  <div class="role-permission-panel">
    <section class="role-permission-panel__summary">
      <div class="role-permission-panel__summary-item">
        <span class="role-permission-panel__summary-label">角色编码</span>
        <code>{{ roleCode }}</code>
      </div>
      <div class="role-permission-panel__summary-item">
        <span class="role-permission-panel__summary-label">当前数据范围</span>
        <span>{{ getDataScopeLabel(scope.state.value.dataScope) }}</span>
      </div>
    </section>

    <section class="role-permission-panel__section">
      <header class="role-permission-panel__section-header">
        <h3>数据范围</h3>
        <span class="role-permission-panel__hint">保存数据范围请点击弹窗底部按钮</span>
      </header>

      <t-alert
        v-if="!scope.canEditScope.value"
        class="role-permission-panel__notice"
        theme="warning"
        title="当前账号没有配置数据范围的权限（system:role:data-scope），仅可查看。"
      />

      <t-select
        :disabled="scope.saving.value || !scope.canEditScope.value"
        :model-value="scope.state.value.dataScope"
        :options="DATA_SCOPE_OPTIONS"
        @change="onDataScopeChange"
      />
      <p class="role-permission-panel__scope-description">
        {{ dataScopeDescription(scope.state.value.dataScope) }}
      </p>

      <div v-if="scope.customDepartmentVisible.value" class="role-permission-panel__departments">
        <div class="role-permission-panel__department-header">
          <span class="role-permission-panel__count">
            已选 {{ scope.selectedDepartmentCount.value }} 个部门
          </span>
        </div>
        <t-alert
          v-if="scope.departmentStatus.value === 'unavailable'"
          class="role-permission-panel__notice"
          theme="warning"
          title="当前账号没有查看部门的权限，无法选择部门。"
        />
        <t-alert
          v-else-if="scope.departmentStatus.value === 'error'"
          class="role-permission-panel__notice"
          theme="error"
          title="部门树加载失败。"
        >
          {{ departmentErrorDescription }}
        </t-alert>
        <AppPermissionSelector
          :model-value="scope.state.value.departmentIds"
          :disabled="scope.saving.value || !scope.canEditScope.value"
          :loading="scope.departmentStatus.value === 'loading'"
          :options="departmentOptions"
          search-placeholder="按部门名称或编码搜索"
          select-all-text="全选"
          @update:model-value="scope.setDepartmentIds"
          max-height="100%"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.role-permission-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-5);
}

.role-permission-panel__summary {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: var(--td-size-4);
  padding: var(--td-size-3) var(--td-size-4);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.role-permission-panel__summary-item {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-2);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
}

.role-permission-panel__summary-label {
  color: var(--td-text-color-secondary);
}

.role-permission-panel__summary-item code {
  padding: 0 var(--td-size-1);
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: var(--td-radius-small);
}

.role-permission-panel__section {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-3);
}

.role-permission-panel__section-header {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-3);
}

.role-permission-panel__section-header h3 {
  flex: 0 0 auto;
  margin: 0;
  font-size: var(--td-font-size-title-medium);
  font-weight: 600;
}

.role-permission-panel__hint {
  flex: 1 1 auto;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.role-permission-panel__count {
  flex: 1 1 auto;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.role-permission-panel__notice {
  width: 100%;
}

.role-permission-panel__scope-description {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.role-permission-panel__departments {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-3);
}

.role-permission-panel__department-header {
  display: flex;
  min-width: 0;
  align-items: center;
}
</style>