import { createApp } from 'vue'
import './ui/theme.css'
import MobileApp from './ui/MobileApp.vue'
import { createMobileApi } from './api'

void createMobileApi().then((api) => {
  window.api = api
  createApp(MobileApp).mount('#app')
}).catch((error) => {
  document.body.textContent = `启动失败：${(error as Error).message}`
})
