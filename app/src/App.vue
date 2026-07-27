<script setup lang="ts">
onLaunch(() => {})
</script>

<style lang="scss">
@use '@wot-ui/ui/styles/theme/index.scss' as *;
@use '@/styles/index.scss' as *;

.page-wraper {
  min-height: calc(100vh - var(--window-top));
  box-sizing: border-box;
  background: var(--app-bg-canvas);
}
</style>
