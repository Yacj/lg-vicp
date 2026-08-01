<script setup lang="ts">
import { RouterView } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()
</script>

<template>
  <t-config-provider :class="`theme-${settingsStore.effectiveTheme}`">
    <RouterView />
  </t-config-provider>
</template>
