<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppErrorState from '@/components/ui/AppErrorState.vue'

defineOptions({ name: 'NotFound' })

const router = useRouter()
</script>

<template>
  <AppErrorState
    code="404"
    description="请求的地址不存在，或页面已被移动或删除。"
    title="页面不存在"
    variant="page"
    @action="router.push('/')"
  />
</template>
