<script setup lang="ts">
import { computed } from 'vue'
import RolePermissionPanel from '@/components/business/RolePermissionPanel.vue'
import type { RolePermissionScopeInstance } from '@/components/business/RolePermissionPanel.vue'
import { useResponsiveShell } from '@/composables/useResponsiveShell'

const props = defineProps<{
  scope: RolePermissionScopeInstance
}>()

const { isMobile } = useResponsiveShell()

const roleName = computed(() => props.scope.state.value.role?.name ?? '')

function close(): void {
  if (props.scope.saving.value) {
    return
  }
  props.scope.close()
}
</script>

<template>
  <!-- PC：居中 dialog -->
  <t-dialog
    v-if="!isMobile"
    :close-on-esc-keydown="!scope.saving.value"
    :close-on-overlay-click="false"
    destroy-on-close
    :header="`数据范围 · ${roleName}`"
    :prevent-scroll-through="true"
    :visible="scope.state.value.visible"
    :width="'720px'"
    @close="close"
    @update:visible="scope.setVisible"
  >
    <RolePermissionPanel :scope="scope" />
    <template #footer>
      <div class="role-permission-drawer__footer">
        <t-button :disabled="scope.saving.value" variant="outline" @click="close">
          关闭
        </t-button>
        <t-button
          :disabled="scope.saving.value || !scope.canEditScope.value"
          theme="primary"
          @click="scope.saveScope"
        >
          {{ scope.saving.value ? '保存中…' : '保存数据范围' }}
        </t-button>
      </div>
    </template>
  </t-dialog>

  <!-- 移动端：全屏 drawer -->
  <t-drawer
    v-else
    :close-on-esc-keydown="!scope.saving.value"
    :close-on-overlay-click="false"
    destroy-on-close
    :header="`数据范围 · ${roleName}`"
    placement="right"
    :prevent-scroll-through="true"
    :size="'100%'"
    :visible="scope.state.value.visible"
    @close="close"
    @update:visible="scope.setVisible"
  >
    <RolePermissionPanel :scope="scope" />
    <template #footer>
      <div class="role-permission-drawer__footer">
        <t-button :disabled="scope.saving.value" variant="outline" @click="close">
          关闭
        </t-button>
        <t-button
          :disabled="scope.saving.value || !scope.canEditScope.value"
          theme="primary"
          @click="scope.saveScope"
        >
          {{ scope.saving.value ? '保存中…' : '保存数据范围' }}
        </t-button>
      </div>
    </template>
  </t-drawer>
</template>

<style scoped>
.role-permission-drawer__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--td-size-3);
}
</style>