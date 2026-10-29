<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { AccountView, AppSettingsView, PlatformInfo, TaskStatus } from '../../shared/types'
import { AI_PROVIDER_PRESETS } from '../../shared/aiProviders'
import mark from './assets/mark.png'
import { langFromLocale, translate, trMessage, trName, type Lang, type LangPref, type MessageKey } from '../../shared/i18n'

const lang = ref<Lang>(langFromLocale(navigator.language) ?? 'en'), langPref = ref<LangPref>('auto'), systemLang = ref<Lang>(lang.value)
const T = (key: MessageKey, vars?: Record<string, string | number>): string => translate(lang.value, key, vars)
const N = (text: string): string => trName(lang.value, text)
const M = (text: string): string => trMessage(lang.value, text)
function applyLang(info: { lang: Lang; pref: LangPref; system: Lang }): void { systemLang.value = info.system; lang.value = info.lang; langPref.value = info.pref; document.documentElement.lang = info.lang === 'zh' ? 'zh-CN' : 'en'; document.title = 'AutoCheckin' }
async function setLang(pref: LangPref): Promise<void> { if (window.api.setLocale) applyLang(await window.api.setLocale(pref)) }

const platforms = ref<PlatformInfo[]>([]), accounts = ref<AccountView[]>([])
const adding = ref(false), chosen = ref<PlatformInfo | null>(null), qrImage = ref(''), qrMessage = ref(''), qrSession = ref(''), qrExpired = ref(false)
const settingsOpen = ref(false), settings = ref<AppSettingsView | null>(null), aiKey = ref(''), explanations = ref<Record<string, string>>({}), explaining = ref<Record<string, boolean>>({})
let pollTimer: number | undefined, unsubscribe: (() => void) | undefined

const platformOf = (id: string) => platforms.value.find((p) => p.id === id)
const statusText = (s: TaskStatus): string => T(`status_${s}` as MessageKey)
const statusClass: Record<TaskStatus, string> = { success: 'ok', already: 'ok', failed: 'bad', login_expired: 'warn', skipped: 'muted' }
const hasFailure = (a: AccountView) => Boolean(a.lastRun?.results.some((r) => r.status === 'failed'))
const when = (iso: string) => new Date(iso).toLocaleString(lang.value === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const aiPresets = computed(() => AI_PROVIDER_PRESETS)

async function refresh(): Promise<void> { accounts.value = await window.api.accounts() }
function openAdd(): void { adding.value = true; chosen.value = null; stopQr() }
async function choose(p: PlatformInfo): Promise<void> {
  chosen.value = p; qrExpired.value = false; qrImage.value = ''
  if (p.loginKind === 'web') {
    qrMessage.value = lang.value === 'zh' ? T('webOpened', { platform: p.name, hint: p.loginHint.replace(/^在打开的.*?窗口里/, '请') }) : T('webOpened', { platform: N(p.name), hint: N(p.loginHint) })
    try {
      const r = await window.api.webLogin(p.id)
      qrMessage.value = M(r.message)
      if (r.state === 'success') { adding.value = false; ElMessage.success(M(r.message)); await refresh() }
      else qrExpired.value = true
    } catch (error) { qrMessage.value = T('loginFailed', { error: M((error as Error).message) }); qrExpired.value = true }
    return
  }
  qrMessage.value = T('fetchingQr')
  try {
    const start = await window.api.startQrLogin(p.id)
    qrSession.value = start.sessionId; qrImage.value = start.image; qrMessage.value = N(p.loginHint)
    pollTimer = window.setInterval(poll, 2000)
  } catch (error) { qrMessage.value = T('qrFailed', { error: M((error as Error).message) }); qrExpired.value = true }
}
async function poll(): Promise<void> {
  if (!qrSession.value) return
  try {
    const r = await window.api.pollQrLogin(qrSession.value)
    qrMessage.value = M(r.message)
    if (r.state === 'success') { stopQr(); adding.value = false; ElMessage.success(M(r.message)); await refresh() }
    else if (r.state === 'expired' || r.state === 'error') { stopQr(); qrExpired.value = true }
  } catch (error) { qrMessage.value = M((error as Error).message) }
}
function stopQr(): void { if (pollTimer) window.clearInterval(pollTimer); pollTimer = undefined; if (qrSession.value) void window.api.cancelQrLogin(qrSession.value); qrSession.value = '' }
function closeAdd(): void { stopQr(); adding.value = false }

async function toggleTask(a: AccountView, taskId: string, value: boolean): Promise<void> { await window.api.updateAccount({ id: a.id, tasks: { ...a.tasks, [taskId]: value } }) }
async function setTime(a: AccountView, value: string | null): Promise<void> { if (value) await window.api.updateAccount({ id: a.id, time: value }) }
async function setEnabled(a: AccountView, value: boolean): Promise<void> { await window.api.updateAccount({ id: a.id, enabled: value }) }
async function run(a: AccountView): Promise<void> { delete explanations.value[a.id]; await window.api.runNow(a.id) }
async function relogin(a: AccountView): Promise<void> { adding.value = true; const p = platformOf(a.platform); if (p) await choose(p) }
async function remove(a: AccountView): Promise<void> {
  await ElMessageBox.confirm(T('removeConfirm', { platform: N(a.platformName), name: a.nickname }), T('removeTitle'), { type: 'warning', confirmButtonText: T('remove'), cancelButtonText: T('cancel') })
  await window.api.removeAccount(a.id)
}
async function explain(a: AccountView): Promise<void> {
  explaining.value[a.id] = true
  try { explanations.value[a.id] = await window.api.explainFailure(a.id) } catch (error) { ElMessage.warning(M((error as Error).message)) } finally { explaining.value[a.id] = false }
}

async function openSettings(): Promise<void> { settings.value = await window.api.settings(); aiKey.value = ''; settingsOpen.value = true }
async function saveSettings(): Promise<void> {
  if (!settings.value) return
  const s = settings.value
  settings.value = await window.api.saveSettings({ notifications: s.notifications, autoLaunch: s.autoLaunch, ai: { enabled: s.ai.enabled, provider: s.ai.provider, baseUrl: s.ai.baseUrl, model: s.ai.model, ...(aiKey.value ? { apiKey: aiKey.value } : {}) } })
  aiKey.value = ''; ElMessage.success(T('saved'))
}
function pickPreset(id: string): void { const p = AI_PROVIDER_PRESETS.find((x) => x.id === id); if (p && settings.value) { settings.value.ai.baseUrl = p.baseUrl || settings.value.ai.baseUrl; settings.value.ai.model = p.defaultModel } }

onMounted(async () => { if (window.api.locale) applyLang(await window.api.locale()); platforms.value = await window.api.platforms(); await refresh(); unsubscribe = window.api.onAccountsChanged((list) => { accounts.value = list }) })
onBeforeUnmount(() => { stopQr(); unsubscribe?.() })
</script>

<template>
  <div class="page">
    <header class="top">
      <img :src="mark" alt="" />
      <h1>{{ T('appTitle') }}</h1>
      <el-button @click="openSettings">{{ T('settings') }}</el-button>
      <el-button type="primary" @click="openAdd">{{ T('addAccount') }}</el-button>
    </header>

    <section v-if="!accounts.length" class="empty">
      <h2>{{ T('emptyTitle') }}</h2>
      <p>{{ T('emptyBody') }}</p>
      <el-button type="primary" size="large" @click="openAdd">{{ T('emptyCta') }}</el-button>
    </section>

    <article v-for="a in accounts" :key="a.id" class="card">
      <div class="card-head">
        <div class="badge" :class="a.platform">{{ a.platformName.slice(0, 1) }}</div>
        <div class="who"><strong>{{ a.nickname }}</strong><span>{{ N(a.platformName) }}</span></div>
        <el-switch :model-value="a.enabled" :active-text="T('autoCheckin')" @update:model-value="(v: string | number | boolean) => setEnabled(a, Boolean(v))" />
        <el-button type="primary" :loading="a.running" @click="run(a)">{{ a.running ? T('running') : T('runNow') }}</el-button>
        <el-button text type="danger" @click="remove(a)">{{ T('remove') }}</el-button>
      </div>

      <div v-if="a.loginExpired" class="expired"><span>{{ T('expired') }}</span><el-button size="small" type="warning" @click="relogin(a)">{{ T('rescan') }}</el-button></div>

      <div class="row">
        <label v-for="t in platformOf(a.platform)?.tasks ?? []" :key="t.id" class="task">
          <el-checkbox :model-value="a.tasks[t.id]" @update:model-value="(v: string | number | boolean) => toggleTask(a, t.id, Boolean(v))" />
          <span>{{ N(t.label) }}<small>{{ N(t.description) }}</small></span>
        </label>
      </div>
      <div class="schedule">{{ T('everyDay') }} <el-time-select :model-value="a.time" start="00:00" step="00:30" end="23:30" style="width: 110px" :clearable="false" @update:model-value="(v: string) => setTime(a, v)" /> {{ T('scheduleHint') }}</div>

      <div v-if="a.lastRun" class="results">
        <div class="muted" style="font-size: 13px; margin-bottom: 6px">{{ T('lastRun') }}{{ when(a.lastRun.at) }} ({{ a.lastRun.trigger === 'manual' ? T('manual') : T('auto') }})</div>
        <div v-for="r in a.lastRun.results" :key="r.taskId" class="result">
          <span class="dot" :class="statusClass[r.status]">{{ statusText(r.status) }}</span>
          <span><b>{{ N(r.label) }}</b>{{ lang === 'zh' ? '：' : ': ' }}{{ M(r.message) }}</span>
        </div>
        <div v-if="!a.lastRun.results.length" class="muted">{{ T('noTasks') }}</div>
        <el-button v-if="hasFailure(a)" link type="primary" :loading="explaining[a.id]" @click="explain(a)">{{ T('explainAi') }}</el-button>
        <div v-if="explanations[a.id]" class="explain">{{ explanations[a.id] }}</div>
      </div>
    </article>

    <el-dialog v-model="adding" :title="T('addAccount').replace(/^[＋+] /, '')" width="460px" @close="closeAdd">
      <div v-if="!chosen" class="platforms">
        <button v-for="p in platforms" :key="p.id" @click="choose(p)"><div class="badge" :class="p.id">{{ p.name.slice(0, 1) }}</div>{{ N(p.name) }}</button>
      </div>
      <div v-else class="qr">
        <img v-if="qrImage && !qrExpired" :src="qrImage" :alt="T('qrAlt')" />
        <p>{{ qrMessage }}</p>
        <el-button v-if="qrExpired" type="primary" @click="choose(chosen)">{{ chosen.loginKind === 'web' ? T('reopenWindow') : T('refreshQr') }}</el-button>
        <el-button text @click="stopQr(); chosen = null">{{ T('otherPlatform') }}</el-button>
      </div>
    </el-dialog>

    <el-drawer v-model="settingsOpen" :title="T('settings')" size="420px">
      <template v-if="settings">
        <el-alert v-if="settings.keychainAvailable === false" type="warning" :closable="false" show-icon style="margin-bottom: 12px" :title="T('keychainTitle')" :description="T('keychainBody')" />
        <el-form label-position="top">
          <el-form-item><el-checkbox v-model="settings.notifications">{{ T('notifyAfter') }}</el-checkbox></el-form-item>
          <el-alert v-if="settings.mobile" type="info" :closable="false" show-icon style="margin-bottom: 12px" :title="T('mobileTitle')" :description="T('mobileBody')" />
          <el-form-item v-if="!settings.mobile"><el-checkbox v-model="settings.autoLaunch">{{ T('autoLaunch') }}</el-checkbox></el-form-item>
          <el-form-item v-if="!settings.mobile" :label="T('language')"><el-select :model-value="langPref" @update:model-value="(v: LangPref) => setLang(v)"><el-option :label="`${T('langAuto')} (${systemLang === 'zh' ? '中文' : 'English'})`" value="auto" /><el-option label="中文" value="zh" /><el-option label="English" value="en" /></el-select></el-form-item>
          <el-collapse>
            <el-collapse-item :title="T('aiSection')" name="ai">
              <p class="muted" style="font-size: 13px">{{ T('aiIntro') }}</p>
              <el-form-item><el-checkbox v-model="settings.ai.enabled">{{ T('aiEnable') }}</el-checkbox></el-form-item>
              <el-form-item :label="T('provider')"><el-select v-model="settings.ai.provider" @change="pickPreset"><el-option v-for="p in aiPresets" :key="p.id" :label="p.label" :value="p.id" /></el-select></el-form-item>
              <el-form-item :label="T('baseUrl')"><el-input v-model="settings.ai.baseUrl" /></el-form-item>
              <el-form-item :label="T('model')"><el-input v-model="settings.ai.model" /></el-form-item>
              <el-form-item :label="settings.ai.hasKey ? T('apiKeySaved') : 'API Key'"><el-input v-model="aiKey" type="password" show-password /></el-form-item>
            </el-collapse-item>
          </el-collapse>
          <el-button type="primary" style="margin-top: 16px" @click="saveSettings">{{ T('save') }}</el-button>
        </el-form>
      </template>
    </el-drawer>
  </div>
</template>
