import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
// 界面演示/截图用，输出到 out/mobile-demo（不进入 APK）
export default defineConfig({ root: 'mobile/demo', base: './', plugins: [vue()], build: { outDir: '../../out/mobile-demo', emptyOutDir: true } })
