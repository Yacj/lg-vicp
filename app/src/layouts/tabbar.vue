<script lang="ts" setup>
import { useKeyboardVisibility } from '@/composables/useKeyboardVisibility'

const router = useRouter()

const route = useRoute()

const { activeTabbar, getTabbarItemValue, setTabbarItemActive, tabbarList } = useTabbar()
const { isKeyboardVisible, viewportHeight } = useKeyboardVisibility()

const layoutStyle = computed(() => ({
  '--app-viewport-height': viewportHeight.value ? `${viewportHeight.value}px` : '100vh',
  '--app-current-tabbar-offset': isKeyboardVisible.value
    ? '0px'
    : 'calc(var(--wot-tabbar-height, 50px) + env(safe-area-inset-bottom))',
}))

function handleTabbarChange({ value }: { value: string }) {
  setTabbarItemActive(value)
  router.pushTab({ name: value })
}

onMounted(() => {
  // #ifdef APP
  uni.hideTabBar()
  // #endif
  nextTick(() => {
    if (route.name && route.name !== activeTabbar.value.name) {
      setTabbarItemActive(route.name)
    }
  })
})
</script>

<script lang="ts">
export default {
  options: {
    addGlobalClass: true,
    virtualHost: true,
    styleIsolation: 'shared',
  },
}
</script>

<template>
  <view class="tabbar-layout" :style="layoutStyle">
    <slot />
    <wd-gap v-if="!isKeyboardVisible" safe-area-bottom height="var(--wot-tabbar-height, 50px)" />
    <wd-tabbar
      v-show="!isKeyboardVisible"
      :model-value="activeTabbar.name"
      bordered
      safe-area-inset-bottom
      fixed
      @change="handleTabbarChange"
    >
      <wd-tabbar-item
        v-for="(item, index) in tabbarList" :key="index" :name="item.name"
        :value="getTabbarItemValue(item.name)" :title="item.title"
      >
        <template #icon="{ active }">
          <image class="tabbar-item__icon" :src="active ? item.iconActive : item.icon" />
        </template>
      </wd-tabbar-item>
    </wd-tabbar>
  </view>
</template>

<style scoped lang="scss">
.tabbar-layout {
  --app-viewport-height: 100vh;
  --app-current-tabbar-offset: calc(var(--wot-tabbar-height, 50px) + env(safe-area-inset-bottom));
  min-height: var(--app-viewport-height);
  background: var(--app-bg-canvas);
}

.tabbar-item__icon {
  width: 56rpx;
  height: 56rpx;
}
</style>
