<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppErrorState from '@/components/ui/AppErrorState.vue'

defineOptions({ name: 'Forbidden' })

const router = useRouter()
</script>

<template>
  <AppErrorState
    code="403"
    description="当前账号无权访问此页面，请联系管理员确认账号权限。"
    title="没有访问权限"
    variant="page"
    @action="router.push('/')"
  />
</template>
