<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Calendar, Setting, Plus, DataAnalysis, MagicStick, Bell } from '@element-plus/icons-vue'
import { useRoute } from 'vue-router'
import type { AppNotification, BrowserProgress } from '../../shared/types'
const route = useRoute()
const notifications=ref<AppNotification[]>([]),drawer=ref(false),progress=ref<BrowserProgress|null>(null)
const unread=computed(()=>notifications.value.filter(item=>!item.read).length)
let unbindNotification:(()=>void)|undefined,unbindProgress:(()=>void)|undefined
async function openNotifications(){drawer.value=true;notifications.value=await window.api.notification.list()}
async function mark(item:AppNotification){if(!item.read){await window.api.notification.markRead(item.id);item.read=true}}
async function clearAll(){await window.api.notification.clear();notifications.value=[]}
let progressTimer: ReturnType<typeof setTimeout> | undefined
onMounted(async()=>{notifications.value=await window.api.notification.list();unbindNotification=window.api.notification.onNew(item=>notifications.value.unshift(item));unbindProgress=window.api.task.onBrowserProgress(value=>{if(progressTimer) clearTimeout(progressTimer); if(value.phase==='completed'||value.phase==='failed'||value.phase==='ready'){progress.value=value; progressTimer=setTimeout(()=>{progress.value=null}, value.phase==='ready'?800:1200)} else progress.value=value})})
onBeforeUnmount(()=>{if(progressTimer) clearTimeout(progressTimer)})
onBeforeUnmount(()=>{unbindNotification?.();unbindProgress?.()})
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">A</div><div><strong>AutoCheckin</strong><span>LOCAL AUTOMATION</span></div></div>
      <nav>
        <router-link to="/" :class="{ active: route.path === '/' }"><el-icon><Calendar /></el-icon><span>签到任务</span></router-link>
        <router-link to="/tasks/new" :class="{ active: route.path === '/tasks/new' }"><el-icon><Plus /></el-icon><span>添加任务</span></router-link>
        <router-link to="/statistics" :class="{ active: route.path === '/statistics' }"><el-icon><DataAnalysis /></el-icon><span>统计中心</span></router-link>
        <router-link to="/ai-guide" :class="{ active: route.path === '/ai-guide' }"><el-icon><MagicStick /></el-icon><span>AI 向导</span></router-link>
        <router-link to="/settings" :class="{ active: route.path === '/settings' }"><el-icon><Setting /></el-icon><span>设置</span></router-link>
      </nav>
      <div class="privacy-card"><div class="privacy-dot"></div><strong>数据仅保存在本地</strong><p>凭据与 Cookie 均经过 AES-256-GCM 加密。</p></div>
      <div class="version">AutoCheckin · v1.0</div>
    </aside>
    <main class="main-content"><button class="notification-button" @click="openNotifications"><el-badge :value="unread" :hidden="!unread"><el-icon><Bell/></el-icon></el-badge></button><router-view /></main>
    <el-drawer v-model="drawer" title="通知中心" size="360px"><div class="notification-actions"><span>最近 50 条通知</span><el-button text @click="clearAll">清空</el-button></div><div v-if="notifications.length" class="notification-list"><button v-for="item in notifications" :key="item.id" :class="['notification-item',item.level,{unread:!item.read}]" @click="mark(item)"><i></i><div><strong>{{item.title}}</strong><p>{{item.message}}</p><span>{{new Date(item.createdAt).toLocaleString('zh-CN')}}</span></div></button></div><div v-else class="notification-empty">暂无通知</div></el-drawer>
    <div v-if="progress" class="browser-progress"><div><strong>{{progress.message}}</strong><span>{{progress.percent}}%</span></div><el-progress :percentage="progress.percent" :show-text="false"/></div>
  </div>
</template>
