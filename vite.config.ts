import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

const bridgePort = process.env.BRIDGE_PORT ?? '8787'
const isCliDevelopmentMode = process.env.CODEX_BROWSER_DEV === '1'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    vue(),
    vueDevTools(),
  ],
  server: {
    hmr: isCliDevelopmentMode ? false : undefined,
    proxy: {
      '/bridge': {
        target: `ws://127.0.0.1:${bridgePort}`,
        ws: true,
      },
      '/api': {
        target: `http://127.0.0.1:${bridgePort}`,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})
