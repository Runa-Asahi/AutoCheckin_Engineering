<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { AccountView, AppSettingsView, PlatformInfo, QrStart, TaskResult } from '../../../src/shared/types'
import { AI_PROVIDER_PRESETS } from '../../../src/shared/aiProviders'
import Icon from './MdIcon.vue'
import { brand, hhmm, statusChip, statusTone, STATUS_TEXT, summary } from './model'

type View = { name: 'home' } | { name: 'login'; platform: PlatformInfo } | { name: 'account'; id: string } | { name: 'settings' }

const api = window.api
const platforms = ref<PlatformInfo[]>([])
const accounts = ref<AccountView[]>([])
const settings = ref<AppSettingsView | null>(null)
const stack = ref<View[]>([{ name: 'home' }])
const view = computed(() => stack.value[stack.value.length - 1])
const sheetOpen = ref(false)
const confirmDelete = ref(false)
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined

function go(next: View): void { stack.value.push(next) }
function back(): void { if (view.value.name === 'login') stopLogin(); if (stack.value.length > 1) stack.value.pop() }
function say(text: string): void { toast.value = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => (toast.value = ''), 3200) }
const platformOf = (id: string): PlatformInfo | undefined => platforms.value.find((p) => p.id === id)
const current = computed(() => (view.value.name === 'account' ? accounts.value.find((a) => a.id === (view.value as { id: string }).id) : undefined))

// ---------- 登录 ----------
const login = reactive({ qr: null as QrStart | null, state: 'idle' as 'idle' | 'loading' | 'waiting' | 'scanned' | 'expired' | 'error' | 'web', message: '' })
let pollTimer: ReturnType<typeof setInterval> | undefined
function stopLogin(): void { clearInterval(pollTimer); pollTimer = undefined; if (login.qr) void api.cancelQrLogin(login.qr.sessionId); login.qr = null; login.state = 'idle' }

function pickPlatform(p: PlatformInfo): void { sheetOpen.value = false; go({ name: 'login', platform: p }); if (p.loginKind === 'qr') void startQr(p); else { login.state = 'web'; login.message = '' } }
async function startQr(p: PlatformInfo): Promise<void> {
  stopLogin(); login.state = 'loading'; login.message = ''
  try {
    login.qr = await api.startQrLogin(p.id); login.state = 'waiting'
    pollTimer = setInterval(() => void poll(), 2000)
  } catch (error) { login.state = 'error'; login.message = (error as Error).message }
}
async function poll(): Promise<void> {
  if (!login.qr) return
  const r = await api.pollQrLogin(login.qr.sessionId).catch((error) => ({ state: 'error' as const, message: (error as Error).message, account: undefined }))
  if (r.state === 'success') { finishLogin(r.message); return }
  if (r.state === 'scanned') { login.state = 'scanned'; login.message = r.message }
  if (r.state === 'expired' || r.state === 'error') { clearInterval(pollTimer); login.qr = null; login.state = r.state; login.message = r.message }
}
function finishLogin(message: string): void { stopLogin(); stack.value = [{ name: 'home' }]; say(message); void refresh() }
async function openInApp(): Promise<void> {
  if (!login.qr?.appLink || !api.openApp) return
  const opened = await api.openApp(login.qr.appLink).catch(() => false)
  if (!opened) say(`没有找到${appName.value} App，请用“保存二维码”方式`)
}
async function saveQr(): Promise<void> {
  if (!login.qr || !api.saveImage) return
  const r = await api.saveImage(login.qr.image, `autocheckin-${(view.value as { platform: PlatformInfo }).platform.id}-qr.png`).catch(() => ({ saved: false, reason: '保存失败' }))
  say(r.saved ? `已保存到相册。打开${appName.value} → 扫一扫 → 相册，选这张图` : (r.reason ?? '保存失败'))
}
async function webLogin(p: PlatformInfo): Promise<void> {
  stopLogin(); login.state = 'loading'
  const r = await api.webLogin(p.id).catch((error) => ({ state: 'error' as const, message: (error as Error).message }))
  if (r.state === 'success') finishLogin(r.message); else { login.state = p.loginKind === 'qr' ? 'expired' : 'web'; login.message = r.message }
}
const appName = computed(() => (view.value.name === 'login' ? view.value.platform.appName ?? view.value.platform.name : ''))
const loginStatus = computed(() => ({ loading: '正在准备…', waiting: '等待确认登录', scanned: '已扫码，请在 App 里点“确认登录”', expired: '二维码已过期', error: '出错了', idle: '', web: '' })[login.state])

// ---------- 账号 ----------
async function refresh(): Promise<void> { accounts.value = await api.accounts() }
async function runNow(a: AccountView): Promise<void> { try { await api.runNow(a.id) } catch (error) { say((error as Error).message) } }
async function patch(a: AccountView, input: { enabled?: boolean; time?: string; tasks?: Record<string, boolean> }): Promise<void> { await api.updateAccount({ id: a.id, ...input }) }
async function remove(a: AccountView): Promise<void> { confirmDelete.value = false; await api.removeAccount(a.id); stack.value = [{ name: 'home' }]; say(`已移除 ${a.nickname}`) }
function relogin(a: AccountView): void { const p = platformOf(a.platform); if (p) pickPlatform(p) }
const explain = ref(''); const explaining = ref(false)
async function askAi(a: AccountView): Promise<void> { explaining.value = true; explain.value = ''; try { explain.value = await api.explainFailure(a.id) } catch (error) { say((error as Error).message) } finally { explaining.value = false } }
function resultFor(a: AccountView, taskId: string): TaskResult | undefined { return a.lastRun?.results.find((r) => r.taskId === taskId) }

// ---------- 设置 ----------
const aiKey = ref('')
async function saveSettings(patchInput: Parameters<typeof api.saveSettings>[0]): Promise<void> { settings.value = await api.saveSettings(patchInput) }
async function saveAi(): Promise<void> {
  const s = settings.value; if (!s) return
  await saveSettings({ ai: { enabled: s.ai.enabled, provider: s.ai.provider, baseUrl: s.ai.baseUrl, model: s.ai.model, ...(aiKey.value ? { apiKey: aiKey.value } : {}) } }); aiKey.value = ''; say('已保存')
}
function pickProvider(id: string): void { const p = AI_PROVIDER_PRESETS.find((x) => x.id === id); if (p && settings.value) { settings.value.ai.provider = p.id; settings.value.ai.baseUrl = p.baseUrl || settings.value.ai.baseUrl; settings.value.ai.model = p.defaultModel } }

let off: (() => void) | undefined
const onVisible = (): void => { if (document.visibilityState === 'visible' && login.qr) void poll() }
onMounted(async () => {
  ;[platforms.value, accounts.value, settings.value] = await Promise.all([api.platforms(), api.accounts(), api.settings()])
  off = api.onAccountsChanged((list) => (accounts.value = list))
  document.addEventListener('visibilitychange', onVisible) // 从官方 App 确认后切回来，立刻查一次
})
onBeforeUnmount(() => { off?.(); stopLogin(); document.removeEventListener('visibilitychange', onVisible) })
</script>

<template>
  <div class="app">
    <!-- 顶栏 -->
    <header class="topbar">
      <button v-if="view.name !== 'home'" class="icon-btn" aria-label="返回" @click="back"><Icon name="back" /></button>
      <h1 class="title">{{ view.name === 'home' ? 'AutoCheckin' : view.name === 'settings' ? '设置' : view.name === 'login' ? `添加${view.platform.name}` : current?.platformName ?? '' }}</h1>
      <button v-if="view.name === 'home'" class="icon-btn" aria-label="设置" @click="go({ name: 'settings' })"><Icon name="settings" /></button>
    </header>

    <main class="content">
      <!-- 首页 -->
      <template v-if="view.name === 'home'">
        <section v-if="!accounts.length" class="empty">
          <div class="empty-art"><Icon name="done" :size="56" /></div>
          <h2>每天自动签到</h2>
          <p>添加账号后，每天到点自动完成签到，并确认真的成功了才告诉你。</p>
          <div class="empty-brands"><span v-for="p in platforms" :key="p.id" class="avatar sm" :style="{ background: brand(p.id).color }">{{ brand(p.id).glyph }}</span></div>
          <button class="btn filled lg" @click="sheetOpen = true"><Icon name="add" />添加第一个账号</button>
        </section>
        <ul v-else class="list">
          <li v-for="a in accounts" :key="a.id" class="card account" @click="go({ name: 'account', id: a.id })">
            <div class="row">
              <span class="avatar" :style="{ background: brand(a.platform).color }">{{ brand(a.platform).glyph }}</span>
              <div class="grow">
                <div class="name">{{ a.nickname }}</div>
                <div class="sub">{{ a.platformName }}</div>
              </div>
              <span class="chip" :class="statusChip(a).tone">{{ statusChip(a).text }}</span>
            </div>
            <p class="summary">{{ summary(a.lastRun) }}</p>
            <div class="card-actions" @click.stop>
              <button v-if="a.loginExpired" class="btn tonal" @click="relogin(a)"><Icon name="login" :size="18" />重新登录</button>
              <button v-else class="btn tonal" :disabled="a.running" @click="runNow(a)"><Icon name="play" :size="18" />{{ a.running ? '签到中…' : '立即签到' }}</button>
            </div>
          </li>
        </ul>
      </template>

      <!-- 登录 -->
      <template v-else-if="view.name === 'login'">
        <section v-if="view.platform.loginKind === 'qr' && login.state !== 'web'" class="login">
          <div class="qr-card card">
            <div class="qr-frame" :class="{ dim: login.state === 'expired' || login.state === 'error' }">
              <img v-if="login.qr" :src="login.qr.image" alt="登录二维码" />
              <div v-else class="qr-placeholder"><span class="spinner" v-if="login.state === 'loading'"></span></div>
              <button v-if="login.state === 'expired' || login.state === 'error'" class="btn filled overlay" @click="startQr(view.platform)"><Icon name="refresh" :size="18" />刷新二维码</button>
            </div>
            <div class="status-line" :class="login.state"><span v-if="login.state === 'waiting' || login.state === 'scanned'" class="dot"></span>{{ loginStatus }}</div>
            <p v-if="login.message && login.state !== 'waiting'" class="hint center">{{ login.message }}</p>
          </div>
          <ol class="steps">
            <li><b>方式一</b>：点下面按钮，跳到{{ appName }} App，在弹出的页面点“确认登录”，再回到这里。</li>
            <li><b>方式二</b>：保存二维码 → 打开{{ appName }} App 的“扫一扫” → 选相册里的这张图。</li>
          </ol>
          <div class="stack">
            <button class="btn filled lg" :disabled="!login.qr?.appLink" @click="openInApp"><Icon name="open" />在{{ appName }} App 中确认</button>
            <button class="btn outlined lg" :disabled="!login.qr" @click="saveQr"><Icon name="download" />保存二维码到相册</button>
            <button v-if="view.platform.webFallback" class="btn text" @click="webLogin(view.platform)">改用账号密码登录（官方网页）</button>
          </div>
        </section>
        <section v-else class="login">
          <div class="card web-card">
            <span class="avatar lg" :style="{ background: brand(view.platform.id).color }">{{ brand(view.platform.id).glyph }}</span>
            <h2>登录{{ view.platform.name }}</h2>
            <p class="hint">将打开{{ view.platform.name }}官方登录页。正常登录后会自动返回，登录页只能访问官方网站，结束后立即清空。</p>
            <p v-if="login.message" class="hint error-text">{{ login.message }}</p>
          </div>
          <div class="stack">
            <button class="btn filled lg" :disabled="login.state === 'loading'" @click="webLogin(view.platform)"><Icon name="login" />{{ login.state === 'loading' ? '等待登录完成…' : '打开官方登录页' }}</button>
          </div>
        </section>
        <p class="footnote"><Icon name="shield" :size="16" />登录信息加密保存在本机，不会上传到任何服务器。</p>
      </template>

      <!-- 账号详情 / 结果 -->
      <template v-else-if="view.name === 'account' && current">
        <section class="hero card">
          <span class="avatar lg" :style="{ background: brand(current.platform).color }">{{ brand(current.platform).glyph }}</span>
          <div class="grow">
            <div class="name lg">{{ current.nickname }}</div>
            <span class="chip" :class="statusChip(current).tone">{{ statusChip(current).text }}</span>
          </div>
        </section>
        <div class="stack">
          <button v-if="current.loginExpired" class="btn filled lg" @click="relogin(current)"><Icon name="login" />重新登录</button>
          <button v-else class="btn filled lg" :disabled="current.running" @click="runNow(current)"><Icon name="play" />{{ current.running ? '签到中…' : '立即签到' }}</button>
        </div>

        <h3 class="section">今日任务<span v-if="current.lastRun" class="section-meta">上次 {{ current.lastRun.date.slice(5) }} {{ hhmm(current.lastRun.at) }}</span></h3>
        <ul class="card rows">
          <li v-for="t in platformOf(current.platform)?.tasks ?? []" :key="t.id" class="task-row">
            <span class="status-icon" :class="resultFor(current, t.id) ? statusTone(resultFor(current, t.id)!.status) : 'neutral'">
              <Icon :name="!resultFor(current, t.id) ? 'schedule' : statusTone(resultFor(current, t.id)!.status) === 'success' ? 'done' : statusTone(resultFor(current, t.id)!.status) === 'error' ? 'error' : 'skip'" :size="22" />
            </span>
            <div class="grow">
              <div class="name">{{ t.label }}</div>
              <div class="sub" v-if="resultFor(current, t.id)">{{ STATUS_TEXT[resultFor(current, t.id)!.status] }} · {{ resultFor(current, t.id)!.message }}</div>
              <div class="sub" v-else>{{ t.description }}</div>
            </div>
            <label class="switch" :aria-label="`启用${t.label}`"><input type="checkbox" :checked="current.tasks[t.id]" @change="patch(current, { tasks: { ...current.tasks, [t.id]: ($event.target as HTMLInputElement).checked } })" /><span></span></label>
          </li>
        </ul>

        <template v-if="settings?.ai.enabled && current.lastRun?.results.some((r) => r.status === 'failed')">
          <button class="btn tonal block" :disabled="explaining" @click="askAi(current)"><Icon name="sparkle" :size="18" />{{ explaining ? '正在分析…' : '用大白话解释失败原因' }}</button>
          <p v-if="explain" class="card explain">{{ explain }}</p>
        </template>

        <h3 class="section">定时</h3>
        <ul class="card rows">
          <li class="task-row">
            <div class="grow"><div class="name">每天自动签到</div><div class="sub">到点提醒，打开 App 即自动完成</div></div>
            <label class="switch" aria-label="每天自动签到"><input type="checkbox" :checked="current.enabled" @change="patch(current, { enabled: ($event.target as HTMLInputElement).checked })" /><span></span></label>
          </li>
          <li class="task-row">
            <div class="grow"><div class="name">签到时间</div></div>
            <input class="time" type="time" :value="current.time" @change="patch(current, { time: ($event.target as HTMLInputElement).value })" />
          </li>
        </ul>

        <template v-if="current.history.length > 1">
          <h3 class="section">最近记录</h3>
          <ul class="card rows">
            <li v-for="h in current.history.slice(0, 7)" :key="h.at" class="task-row compact">
              <div class="grow"><div class="name">{{ h.date.slice(5) }} {{ hhmm(h.at) }}<span class="sub inline">{{ h.trigger === 'manual' ? '手动' : '定时' }}</span></div></div>
              <span class="chip" :class="h.results.some((r) => r.status === 'failed' || r.status === 'login_expired') ? 'warning' : 'success'">{{ h.results.filter((r) => r.status === 'success' || r.status === 'already').length }}/{{ h.results.length }}</span>
            </li>
          </ul>
        </template>

        <button class="btn text danger block" @click="confirmDelete = true"><Icon name="delete" :size="18" />移除这个账号</button>
      </template>

      <!-- 设置 -->
      <template v-else-if="view.name === 'settings' && settings">
        <ul class="card rows">
          <li class="task-row">
            <div class="grow"><div class="name">签到结果通知</div><div class="sub">每次签到后发一条通知</div></div>
            <label class="switch" aria-label="签到结果通知"><input type="checkbox" :checked="settings.notifications" @change="saveSettings({ notifications: ($event.target as HTMLInputElement).checked })" /><span></span></label>
          </li>
          <li class="task-row">
            <div class="grow"><div class="name">AI 解释失败原因</div><div class="sub">可选。只发送脱敏后的结果文字</div></div>
            <label class="switch" aria-label="AI 解释"><input type="checkbox" v-model="settings.ai.enabled" @change="saveAi" /><span></span></label>
          </li>
        </ul>
        <div v-if="settings.ai.enabled" class="card form">
          <label class="field"><span>服务商</span>
            <select :value="settings.ai.provider" @change="pickProvider(($event.target as HTMLSelectElement).value)"><option v-for="p in AI_PROVIDER_PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option></select>
          </label>
          <label class="field"><span>API Key</span><input v-model="aiKey" type="password" autocomplete="off" :placeholder="settings.ai.hasKey ? '已保存（留空则不修改）' : '粘贴你的 API Key'" /></label>
          <details><summary>更多</summary>
            <label class="field"><span>接口地址</span><input v-model="settings.ai.baseUrl" /></label>
            <label class="field"><span>模型</span><input v-model="settings.ai.model" /></label>
          </details>
          <button class="btn filled block" @click="saveAi">保存</button>
        </div>
        <h3 class="section">关于</h3>
        <div class="card about">
          <p><Icon name="shield" :size="18" />所有数据只存在这台手机上，用系统密钥加密；只连接各平台官方网站，没有任何统计或自家服务器。</p>
          <p v-if="settings.mobile"><Icon name="schedule" :size="18" />安卓不允许 App 在后台随意联网：到点会提醒你，点提醒或打开 App 就会自动签到。</p>
        </div>
      </template>
    </main>

    <!-- 悬浮按钮 -->
    <button v-if="view.name === 'home' && accounts.length" class="fab" @click="sheetOpen = true"><Icon name="add" />添加账号</button>

    <!-- 底部面板：选平台 -->
    <transition name="fade"><div v-if="sheetOpen" class="scrim" @click="sheetOpen = false"></div></transition>
    <transition name="sheet">
      <section v-if="sheetOpen" class="sheet" role="dialog" aria-label="选择平台">
        <div class="handle"></div>
        <h2>添加哪个平台的账号？</h2>
        <ul class="rows">
          <li v-for="p in platforms" :key="p.id" class="task-row tap" @click="pickPlatform(p)">
            <span class="avatar" :style="{ background: brand(p.id).color }">{{ brand(p.id).glyph }}</span>
            <div class="grow"><div class="name">{{ p.name }}</div><div class="sub">{{ p.loginKind === 'qr' ? `用${p.appName ?? p.name} App 确认登录` : '官方网页登录' }} · {{ p.tasks.map((t) => t.label).join('、') }}</div></div>
            <Icon name="chevron" />
          </li>
        </ul>
      </section>
    </transition>

    <!-- 确认删除 -->
    <transition name="fade"><div v-if="confirmDelete" class="scrim" @click="confirmDelete = false"></div></transition>
    <div v-if="confirmDelete && current" class="dialog" role="alertdialog">
      <h2>移除 {{ current.nickname }}？</h2>
      <p>本机保存的登录信息会被删除。之后可以随时重新添加。</p>
      <div class="dialog-actions"><button class="btn text" @click="confirmDelete = false">取消</button><button class="btn text danger" @click="remove(current)">移除</button></div>
    </div>

    <transition name="fade"><div v-if="toast" class="snackbar" role="status">{{ toast }}</div></transition>
  </div>
</template>
