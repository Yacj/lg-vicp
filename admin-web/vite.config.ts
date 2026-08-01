import path from 'node:path'
import process from 'node:process'

import { TDesignResolver } from '@tdesign-vue-next/auto-import-resolver'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import Unocss from 'unocss/vite'
import autoImport from 'unplugin-auto-import/vite'
import components from 'unplugin-vue-components/vite'
import { defineConfig, loadEnv } from 'vite'
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons'
import vueDevTools from 'vite-plugin-vue-devtools'
import { parseEnv } from './src/utils/env'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd())
  parseEnv(env)
  return {
    plugins: [
      vue(),
      vueJsx(),
      env.VITE_OPEN_DEVTOOLS === 'true' ? vueDevTools() : null,
      autoImport({
        imports: [
          'vue',
          'vue-router',
          'pinia',
          '@vueuse/core',
        ],
        resolvers: [TDesignResolver({
          library: 'vue-next',
        })],
        dts: 'src/types/auto-imports.d.ts',
        dirs: [
          './src/hooks/**',
          './src/composables/**',
        ],
      }),
      components({
        dirs: [
          'src/components',
        ],
        resolvers: [TDesignResolver({
          library: 'vue-next',
        })],
        include: [/\.vue$/, /\.vue\?vue/, /\.jsx$/],
        dts: 'src/types/components.d.ts',
      }),
      createSvgIconsPlugin({
        iconDirs: [path.resolve(process.cwd(), 'src/assets/icons')],
        symbolId: 'icon-[dir]-[name]',
      }),
      Unocss(),
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      open: env.VITE_DEV_SERVER_OPEN === 'true',
      host: '0.0.0.0',
      proxy: {
        '/proxy': {
          target: env.VITE_APP_API_BASEURL,
          changeOrigin: command === 'serve' && env.VITE_OPEN_PROXY === 'true',
          rewrite: (path: string) => path.replace(/\/proxy/, ''),
        },
      },
    },
    build: {
      outDir: mode === 'production' ? 'dist' : `dist-${mode}`,
      sourcemap: env.VITE_BUILD_SOURCEMAP === 'true',
    },
  }
})
