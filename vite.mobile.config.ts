import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 手机端：同一套界面（src/renderer/src/App.vue）+ 同一套签到核心（src/main/core），在 WebView 里进程内运行
export default defineConfig({
  root: 'mobile',
  base: './',
  plugins: [vue()],
  resolve: { alias: { '@renderer': resolve('src/renderer'), '@shared': resolve('src/shared') } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
})
