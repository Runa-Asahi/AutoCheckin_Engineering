import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import '../../src/renderer/src/styles.css'
import App from '../../src/renderer/src/App.vue'
import { createMobileApi } from './api'

void createMobileApi().then((api) => {
  window.api = api
  createApp(App).use(ElementPlus).mount('#app')
}).catch((error) => {
  document.body.textContent = `启动失败：${(error as Error).message}`
})
