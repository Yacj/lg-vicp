<script setup lang="ts">
import type { SessionReport } from '@/utils/aiAgentUi'
import AiReportTaskCard from '@/components/ai/AiReportTaskCard.vue'

defineProps<{
  report: SessionReport
}>()

const emit = defineEmits<{
  open: [report: SessionReport]
}>()
</script>

<template>
  <AiReportTaskCard :report="report" @open="emit('open', $event)" />
</template>
