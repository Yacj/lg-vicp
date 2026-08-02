<script setup lang="ts">
import { useResponsiveShell } from '@/composables/useResponsiveShell'
import RoleUserPanel from '@/components/business/RoleUserPanel.vue'
import type { RoleUserDrawerInstance } from '@/components/business/RoleUserPanel.vue'

const props = defineProps<{
  users: RoleUserDrawerInstance
}>()

const { isMobile } = useResponsiveShell()

function close(): void {
  props.users.close()
}
</script>

<template>
  <!-- PC：居中 dialog -->
  <t-dialog
    v-if="!isMobile"
    :cancel-btn="{ content: '关闭', disabled: users.assignAction.running.value || users.removeAction.running.value }"
    :close-on-esc-keydown="!users.assignAction.running.value && !users.removeAction.running.value"
    :close-on-overlay-click="false"
    destroy-on-close
    :footer="false"
    :header="`角色用户 · ${users.role.value?.name ?? ''}`"
    :prevent-scroll-through="true"
    :visible="users.visible.value"
    :width="'960px'"
    @close="close"
    @update:visible="users.setVisible"
  >
    <RoleUserPanel :users="users" />
  </t-dialog>

  <!-- 移动端：全屏 drawer -->
  <t-drawer
    v-else
    :cancel-btn="{ content: '关闭', disabled: users.assignAction.running.value || users.removeAction.running.value }"
    :close-on-esc-keydown="!users.assignAction.running.value && !users.removeAction.running.value"
    :close-on-overlay-click="false"
    destroy-on-close
    :header="`角色用户 · ${users.role.value?.name ?? ''}`"
    placement="right"
    :prevent-scroll-through="true"
    :size="'100%'"
    :visible="users.visible.value"
    @close="close"
    @update:visible="users.setVisible"
  >
    <RoleUserPanel :users="users" />
  </t-drawer>
</template>