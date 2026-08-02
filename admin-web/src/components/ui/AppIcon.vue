<script setup lang="ts">
import { computed } from 'vue'
import { resolveMenuIconValue } from './menu-icons'

defineOptions({
  inheritAttrs: false,
  name: 'AppIcon',
})

const props = withDefaults(defineProps<{
  name?: string | null
  label?: string
}>(), {
  name: null,
  label: '',
})

const resolved = computed(() => resolveMenuIconValue(props.name))
</script>

<template>
  <img
    v-if="resolved.kind === 'local' && resolved.source"
    v-bind="$attrs"
    :alt="label"
    class="app-icon app-icon--local"
    :src="resolved.source"
  />
  <component
    :is="resolved.component"
    v-else
    v-bind="$attrs"
    :aria-label="label || undefined"
    class="app-icon"
    :aria-hidden="label ? undefined : 'true'"
  />
</template>

<style scoped>
.app-icon--local {
  display: inline-block;
  width: 1em;
  height: 1em;
  object-fit: contain;
  vertical-align: -0.125em;
}
</style>