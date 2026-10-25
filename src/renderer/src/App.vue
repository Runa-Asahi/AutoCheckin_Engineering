<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { AccountView, AppSettingsView, PlatformInfo, TaskStatus } from '../../shared/types'
import { AI_PROVIDER_PRESETS } from '../../shared/aiProviders'
import mark from './assets/mark.png'

const platforms = ref<PlatformInfo[]>([]), accounts = ref<AccountView[]>([])
const adding = ref(false), chosen = ref<PlatformInfo | null>(null), qrImage = ref(''), qrMessage = ref(''), qrSession = ref(''), qrExpired = ref(false)
const settingsOpen = ref(false), settings = ref<AppSettingsView | null>(null), aiKey = ref(''), explanations = ref<Record<string, string>>({}), explaining = ref<Record<string, boolean>>({})
let pollTimer: number | undefined, unsubscribe: (() => void) | undefined

const platformOf = (id: string) => platforms.value.find((p) => p.id === id)
const statusText: Record<TaskStatus, string> = { success: '✔ 成功', already: '✔ 已完成', failed: '✘ 失败', login_expired: '⚠ 需登录', skipped: '– 跳过' }
const statusClass: Record<TaskStatus, string> = { success: 'ok', already: 'ok', failed: 'bad', login_expired: 'warn', skipped: 'muted' }
const hasFailure = (a: AccountView) => Boolean(a.lastRun?.results.some((r) => r.status === 'failed'))
const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const aiPresets = computed(() => AI_PROVIDER_PRESETS)

async function refresh(): Promise<void> { accounts.value = await window.api.accounts() }
function openAdd(): void { adding.value = true; chosen.value = null; stopQr() }
async function choose(p: PlatformInfo): Promise<void> {
  chosen.value = p; qrExpired.value = false; qrImage.value = ''; qrMessage.value = '正在获取二维码…'
  try {
    const start = await window.api.startQrLogin(p.id)
    qrSession.value = start.sessionId; qrImage.value = start.image; qrMessage.value = p.loginHint
    pollTimer = window.setInterval(poll, 2000)
  } catch (error) { qrMessage.value = `获取二维码失败：${(error as Error).message}`; qrExpired.value = true }
}
async function poll(): Promise<void> {
  if (!qrSession.value) return
  try {
    const r = await window.api.pollQrLogin(qrSession.value)
    qrMessage.value = r.message
    if (r.state === 'success') { stopQr(); adding.value = false; ElMessage.success(r.message); await refresh() }
    else if (r.state === 'expired' || r.state === 'error') { stopQr(); qrExpired.value = true }
  } catch (error) { qrMessage.value = (error as Error).message }
}
function stopQr(): void { if (pollTimer) window.clearInterval(pollTimer); pollTimer = undefined; if (qrSession.value) void window.api.cancelQrLogin(qrSession.value); qrSession.value = '' }
function closeAdd(): void { stopQr(); adding.value = false }

async function toggleTask(a: AccountView, taskId: string, value: boolean): Promise<void> { await window.api.updateAccount({ id: a.id, tasks: { ...a.tasks, [taskId]: value } }) }
async function setTime(a: AccountView, value: string | null): Promise<void> { if (value) await window.api.updateAccount({ id: a.id, time: value }) }
async function setEnabled(a: AccountView, value: boolean): Promise<void> { await window.api.updateAccount({ id: a.id, enabled: value }) }
async function run(a: AccountView): Promise<void> { delete explanations.value[a.id]; await window.api.runNow(a.id) }
async function relogin(a: AccountView): Promise<void> { adding.value = true; const p = platformOf(a.platform); if (p) await choose(p) }
async function remove(a: AccountView): Promise<void> {
  await ElMessageBox.confirm(`确定移除 ${a.platformName}「${a.nickname}」吗？本机保存的登录信息会一起删除。`, '移除账号', { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' })
  await window.api.removeAccount(a.id)
}
async function explain(a: AccountView): Promise<void> {
  explaining.value[a.id] = true
  try { explanations.value[a.id] = await window.api.explainFailure(a.id) } catch (error) { ElMessage.warning((error as Error).message) } finally { explaining.value[a.id] = false }
}

async function openSettings(): Promise<void> { settings.value = await window.api.settings(); aiKey.value = ''; settingsOpen.value = true }
async function saveSettings(): Promise<void> {
  if (!settings.value) return
  const s = settings.value
  settings.value = await window.api.saveSettings({ notifications: s.notifications, autoLaunch: s.autoLaunch, ai: { enabled: s.ai.enabled, provider: s.ai.provider, baseUrl: s.ai.baseUrl, model: s.ai.model, ...(aiKey.value ? { apiKey: aiKey.value } : {}) } })
  aiKey.value = ''; ElMessage.success('已保存')
}
function pickPreset(id: string): void { const p = AI_PROVIDER_PRESETS.find((x) => x.id === id); if (p && settings.value) { settings.value.ai.baseUrl = p.baseUrl || settings.value.ai.baseUrl; settings.value.ai.model = p.defaultModel } }

onMounted(async () => { platforms.value = await window.api.platforms(); await refresh(); unsubscribe = window.api.onAccountsChanged((list) => { accounts.value = list }) })
onBeforeUnmount(() => { stopQr(); unsubscribe?.() })
</script>

<template>
  <div class="page">
    <header class="top">
      <img :src="mark" alt="" />
      <h1>AutoCheckin 自动签到</h1>
      <el-button @click="openSettings">设置</el-button>
      <el-button type="primary" @click="openAdd">＋ 添加账号</el-button>
    </header>

    <section v-if="!accounts.length" class="empty">
      <h2>还没有账号</h2>
      <p>点“添加账号”，用手机 App 扫一下二维码就好，不需要复制任何东西。</p>
      <el-button type="primary" size="large" @click="openAdd">＋ 扫码添加账号</el-button>
    </section>

    <article v-for="a in accounts" :key="a.id" class="card">
      <div class="card-head">
        <div class="badge" :class="a.platform">{{ a.platformName.slice(0, 1) }}</div>
        <div class="who"><strong>{{ a.nickname }}</strong><span>{{ a.platformName }}</span></div>
        <el-switch :model-value="a.enabled" active-text="自动签到" @update:model-value="(v: string | number | boolean) => setEnabled(a, Boolean(v))" />
        <el-button type="primary" :loading="a.running" @click="run(a)">{{ a.running ? '正在签到…' : '立即签到' }}</el-button>
        <el-button text type="danger" @click="remove(a)">移除</el-button>
      </div>

      <div v-if="a.loginExpired" class="expired"><span>登录已过期，需要重新扫码一次。</span><el-button size="small" type="warning" @click="relogin(a)">重新扫码</el-button></div>

      <div class="row">
        <label v-for="t in platformOf(a.platform)?.tasks ?? []" :key="t.id" class="task">
          <el-checkbox :model-value="a.tasks[t.id]" @update:model-value="(v: string | number | boolean) => toggleTask(a, t.id, Boolean(v))" />
          <span>{{ t.label }}<small>{{ t.description }}</small></span>
        </label>
      </div>
      <div class="schedule">每天 <el-time-select :model-value="a.time" start="00:00" step="00:30" end="23:30" style="width: 110px" :clearable="false" @update:model-value="(v: string) => setTime(a, v)" /> 自动执行（电脑开着、软件在托盘里时生效）</div>

      <div v-if="a.lastRun" class="results">
        <div class="muted" style="font-size: 13px; margin-bottom: 6px">最近一次：{{ when(a.lastRun.at) }}（{{ a.lastRun.trigger === 'manual' ? '手动' : '自动' }}）</div>
        <div v-for="r in a.lastRun.results" :key="r.taskId" class="result">
          <span class="dot" :class="statusClass[r.status]">{{ statusText[r.status] }}</span>
          <span><b>{{ r.label }}</b>：{{ r.message }}</span>
        </div>
        <div v-if="!a.lastRun.results.length" class="muted">没有勾选任何任务。</div>
        <el-button v-if="hasFailure(a)" link type="primary" :loading="explaining[a.id]" @click="explain(a)">用 AI 帮我看看为什么失败</el-button>
        <div v-if="explanations[a.id]" class="explain">{{ explanations[a.id] }}</div>
      </div>
    </article>

    <el-dialog v-model="adding" title="添加账号" width="460px" @close="closeAdd">
      <div v-if="!chosen" class="platforms">
        <button v-for="p in platforms" :key="p.id" @click="choose(p)"><div class="badge" :class="p.id">{{ p.name.slice(0, 1) }}</div>{{ p.name }}</button>
      </div>
      <div v-else class="qr">
        <img v-if="qrImage && !qrExpired" :src="qrImage" alt="登录二维码" />
        <p>{{ qrMessage }}</p>
        <el-button v-if="qrExpired" type="primary" @click="choose(chosen)">刷新二维码</el-button>
        <el-button text @click="stopQr(); chosen = null">换一个平台</el-button>
      </div>
    </el-dialog>

    <el-drawer v-model="settingsOpen" title="设置" size="420px">
      <template v-if="settings">
        <el-form label-position="top">
          <el-form-item><el-checkbox v-model="settings.notifications">签到完成后弹出系统通知</el-checkbox></el-form-item>
          <el-form-item><el-checkbox v-model="settings.autoLaunch">开机自动启动（在托盘里静默运行）</el-checkbox></el-form-item>
          <el-collapse>
            <el-collapse-item title="高级：AI 解释失败原因（可选）" name="ai">
              <p class="muted" style="font-size: 13px">开启后，签到失败时可以让 AI 用大白话解释原因。只会发送脱敏后的结果文字，不会发送登录信息。</p>
              <el-form-item><el-checkbox v-model="settings.ai.enabled">开启 AI 解释</el-checkbox></el-form-item>
              <el-form-item label="服务商"><el-select v-model="settings.ai.provider" @change="pickPreset"><el-option v-for="p in aiPresets" :key="p.id" :label="p.label" :value="p.id" /></el-select></el-form-item>
              <el-form-item label="接口地址"><el-input v-model="settings.ai.baseUrl" /></el-form-item>
              <el-form-item label="模型"><el-input v-model="settings.ai.model" /></el-form-item>
              <el-form-item :label="settings.ai.hasKey ? 'API Key（已保存，留空不修改）' : 'API Key'"><el-input v-model="aiKey" type="password" show-password /></el-form-item>
            </el-collapse-item>
          </el-collapse>
          <el-button type="primary" style="margin-top: 16px" @click="saveSettings">保存</el-button>
        </el-form>
      </template>
    </el-drawer>
  </div>
</template>
