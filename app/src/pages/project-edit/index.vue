<script setup lang="ts">
definePage({
  name: 'project-edit',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
  },
})

const route = useRoute()
const router = useRouter()

function routeText(value: unknown) {
  if (Array.isArray(value)) {
    return String(value[0] || '')
  }
  return String(value || '')
}

onMounted(() => {
  const id = routeText(route.query.id) || routeText(route.params.id)
  router.replace({
    name: 'project-create',
    params: id ? { id } : {},
  })
})
</script>

<template>
  <view class="app-page app-page--immersive min-h-screen" />
</template>
