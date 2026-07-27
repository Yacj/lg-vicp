<script setup lang="ts">
import type { ConfigProviderProps } from '@wot-ui/ui/components/wd-config-provider/types'

const { themeVars, theme } = useManualTheme()

const buttonConfig: ConfigProviderProps['button'] = {
  size: 'large',
  variant: 'base',
  round: true,
}

const tagConfig: ConfigProviderProps['tag'] = {
  size: 'small',
  variant: 'light',
  round: true,
}
</script>

<template>
  <wd-config-provider :theme-vars="themeVars" :theme="theme" :button="buttonConfig" :tag="tagConfig" :custom-class="`page-wraper ${theme}`">
    <ku-root-view />
    <wd-notify />
    <wd-dialog />
    <wd-toast />
    <global-loading />
    <global-toast />
    <global-dialog />
    <!-- #ifdef MP-WEIXIN || APP-PLUS -->
    <privacy-popup />
    <!-- #endif -->
  </wd-config-provider>
</template>
