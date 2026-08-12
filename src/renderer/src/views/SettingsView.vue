<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Lock, Setting, Download, Bell, Key, Cpu, Refresh } from '@element-plus/icons-vue'
import { useConfigStore } from '../stores/config'
import { AI_PROVIDER_PRESETS, getProviderPreset, needsV1Reminder, normalizeBaseUrl } from '../../../shared/aiProviders'
import type { AIProvider } from '../../../shared/schemas'
import { friendlyIpcMessage } from '../utils/apiError'
import type { DetectedBrowser } from '../../../shared/types'

const config = useConfigStore()
const saving = ref(false), fetchingModels = ref(false), platform = ref(''), version = ref(''), activeSection = ref('general'), apiConfigured = ref(false)
const availableModels = ref<string[]>([]), detectedBrowsers = ref<DetectedBrowser[]>([]), defaultBrowserKey = ref(''), customBrowserPath = ref('')
const browserOptions = computed(() => detectedBrowsers.value.flatMap((browser) => (browser.profiles.length ? browser.profiles : ['Default']).map((profile) => ({ key: `${browser.id}:${profile}`, label: `${browser.name} (${profile} Profile)`, browser, profile }))))
const form = reactive({ autoLaunch: false, timezone: 'Asia/Shanghai', notifications: true, retentionDays: 90, aiProvider: 'openai' as AIProvider, aiBaseUrl: 'https://api.openai.com/v1', aiModel: 'gpt-4.1-mini', aiApiKey: '' })
const showV1Reminder = computed(() => needsV1Reminder(form.aiProvider, form.aiBaseUrl))

function scrollToSection(id: string): void { activeSection.value = id; document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
function providerChanged(): void {
  const preset = getProviderPreset(form.aiProvider)
  form.aiBaseUrl = preset.baseUrl
  form.aiModel = preset.defaultModel
  availableModels.value = []
}
function normalizeUrl(): void { form.aiBaseUrl = normalizeBaseUrl(form.aiBaseUrl) }
async function fetchModels(): Promise<void> {
  normalizeUrl()
  if (!form.aiBaseUrl || !form.aiModel) { ElMessage.warning('请先填写 Base URL 和模型名称。'); return }
  fetchingModels.value = true
  try {
    const models = await window.api.ai.listModels({ provider: form.aiProvider, baseUrl: form.aiBaseUrl, apiKey: form.aiApiKey, model: form.aiModel })
    availableModels.value = models
    if (!models.length) ElMessage.warning('接口没有返回模型列表，你仍可直接手动输入模型名称。')
    else ElMessage.success(`已获取 ${models.length} 个可用模型`)
  } catch (error) { ElMessage.error(friendlyIpcMessage(error)) } finally { fetchingModels.value = false }
}
function selectDefaultBrowser(key: string): void { const option = browserOptions.value.find((item) => item.key === key); if (option) customBrowserPath.value = option.browser.userDataDir }
async function save(): Promise<void> {
  normalizeUrl()
  if (!form.aiBaseUrl || !form.aiModel.trim()) { ElMessage.warning('请填写 Base URL 和模型名称。'); return }
  saving.value = true
  try {
    await Promise.all([
      config.setSetting('auto_launch', String(form.autoLaunch)), config.setSetting('timezone', form.timezone), config.setSetting('notifications', String(form.notifications)),
      config.setSetting('log_retention_days', String(form.retentionDays), 'advanced'), config.setSetting('ai_provider', form.aiProvider, 'ai'),
      config.setSetting('ai_base_url', form.aiBaseUrl, 'ai'), config.setSetting('ai_model', form.aiModel.trim(), 'ai'),
      config.setSetting('ai_api_key', form.aiApiKey.trim(), 'ai', true),
      config.setSetting('local_browser_default', JSON.stringify({ key: defaultBrowserKey.value, customPath: customBrowserPath.value }), 'browser'),
    ])
    apiConfigured.value = Boolean(form.aiApiKey.trim()) || getProviderPreset(form.aiProvider).apiKeyOptional === true
    ElMessage.success('设置已保存，AI 向导会自动使用这套配置。')
  } catch (error) { ElMessage.error(friendlyIpcMessage(error)) } finally { saving.value = false }
}
async function exportBackup(): Promise<void> {
  const path = await window.api.backup.chooseExportPath(); if (!path) return
  const { value } = await ElMessageBox.prompt('请输入至少 8 位备份密码。该密码不会保存，遗失后无法恢复备份。', '导出加密备份', { inputType: 'password', inputPattern: /.{8,}/, inputErrorMessage: '密码至少 8 位', confirmButtonText: '导出' })
  await window.api.backup.export(path, value); ElMessage.success('加密备份已导出')
}
async function importBackup(): Promise<void> {
  const path = await window.api.backup.chooseImportPath(); if (!path) return
  await ElMessageBox.confirm('导入会替换当前全部任务、凭据、日志和设置，请确认已有可恢复备份。', '导入备份', { type: 'warning', confirmButtonText: '继续导入' })
  const { value } = await ElMessageBox.prompt('输入备份密码', '解密备份', { inputType: 'password', confirmButtonText: '导入' })
  await window.api.backup.import(path, value); ElMessage.success('数据导入完成')
}
onMounted(async () => {
  const [launch, tz, notify, retention, providerRaw, baseUrl, model, key, browserDefault, p, v] = await Promise.all([
    config.getSetting('auto_launch', 'false'), config.getSetting('timezone', 'Asia/Shanghai'), config.getSetting('notifications', 'true'), config.getSetting('log_retention_days', '90'),
    config.getSetting('ai_provider', 'openai'), config.getSetting('ai_base_url', ''), config.getSetting('ai_model', 'gpt-4.1-mini'), config.getSetting('ai_api_key', ''), config.getSetting('local_browser_default', '{}'), window.api.system.getPlatform(), window.api.system.getAppVersion(),
  ])
  const provider = AI_PROVIDER_PRESETS.some((item) => item.id === providerRaw) ? providerRaw as AIProvider : 'custom-openai'
  const preset = getProviderPreset(provider)
  Object.assign(form, { autoLaunch: launch === 'true', timezone: tz, notifications: notify === 'true', retentionDays: Number(retention), aiProvider: provider, aiBaseUrl: normalizeBaseUrl(baseUrl || preset.baseUrl), aiModel: model || preset.defaultModel, aiApiKey: key })
  try { const saved = JSON.parse(browserDefault); defaultBrowserKey.value = String(saved.key ?? ''); customBrowserPath.value = String(saved.customPath ?? '') } catch { /* ignore malformed optional preference */ }
  detectedBrowsers.value = await window.api.system.getDetectedBrowsers()
  apiConfigured.value = Boolean(key) || preset.apiKeyOptional === true; platform.value = p; version.value = v
})
</script>

<template>
  <div class="page settings-page">
    <header class="page-header"><div><h1>设置</h1><p>管理运行行为、安全状态、AI 服务与本地数据。</p></div><el-button class="primary-button" type="primary" :loading="saving" @click="save">保存设置</el-button></header>
    <div class="settings-layout">
      <aside class="settings-nav panel">
        <button :class="{active:activeSection==='general'}" @click="scrollToSection('general')"><el-icon><Setting/></el-icon>通用</button>
        <button :class="{active:activeSection==='ai-api'}" @click="scrollToSection('ai-api')"><el-icon><Key/></el-icon>AI API</button>
        <button :class="{active:activeSection==='browser'}" @click="scrollToSection('browser')"><el-icon><Cpu/></el-icon>浏览器</button>
        <button :class="{active:activeSection==='notify'}" @click="scrollToSection('notify')"><el-icon><Bell/></el-icon>通知</button>
        <button :class="{active:activeSection==='security'}" @click="scrollToSection('security')"><el-icon><Lock/></el-icon>安全</button>
        <button :class="{active:activeSection==='advanced'}" @click="scrollToSection('advanced')"><el-icon><Download/></el-icon>高级</button>
      </aside>
      <div class="settings-content">
        <section id="browser" class="panel setting-section"><div class="section-title"><el-icon><Cpu/></el-icon><div><h3>本地浏览器</h3><p>选择要继承登录状态的原生 Chrome/Edge Profile。</p></div></div><div class="browser-setting"><el-form-item label="默认浏览器 Profile"><el-select v-model="defaultBrowserKey" filterable placeholder="选择浏览器 Profile" @change="selectDefaultBrowser"><el-option v-for="option in browserOptions" :key="option.key" :label="option.label" :value="option.key"/><el-option label="自定义路径" value="custom"/></el-select></el-form-item><el-form-item v-if="defaultBrowserKey==='custom'" label="Custom Path"><el-input v-model="customBrowserPath" placeholder="Chrome/Edge User Data 目录"/></el-form-item><p class="field-help">关闭正在运行的 Chrome/Edge 后，后台任务会使用该 Profile 的 Cookies、LocalStorage 和登录状态。</p></div></section>
        <section id="general" class="panel setting-section"><div class="section-title"><el-icon><Setting/></el-icon><div><h3>通用设置</h3><p>控制启动方式与任务使用的时区。</p></div></div><div class="setting-row"><div><strong>开机自动启动</strong><span>登录系统后在后台启动 AutoCheckin</span></div><el-switch v-model="form.autoLaunch"/></div><div class="setting-row"><div><strong>任务时区</strong><span>Cron 计划按所选时区解释</span></div><el-select v-model="form.timezone" style="width:190px"><el-option label="中国标准时间" value="Asia/Shanghai"/><el-option label="协调世界时" value="UTC"/><el-option label="东京时间" value="Asia/Tokyo"/></el-select></div></section>
        <section id="ai-api" class="panel setting-section">
          <div class="section-title"><el-icon><Key/></el-icon><div><h3>AI API 接入</h3><p>支持官方服务、中转站与本地 Ollama；API Key 仅在本地加密保存。</p></div><span v-if="apiConfigured" class="configured-badge">已配置</span></div>
          <div class="api-grid">
            <el-form-item label="服务商"><el-select v-model="form.aiProvider" @change="providerChanged"><el-option v-for="item in AI_PROVIDER_PRESETS" :key="item.id" :label="item.label" :value="item.id"><span>{{item.label}}</span><small class="option-description">{{item.description}}</small></el-option></el-select></el-form-item>
            <el-form-item label="API Key"><el-input v-model="form.aiApiKey" type="password" show-password placeholder="sk-..."/></el-form-item>
            <el-form-item class="wide-field" label="Base URL"><el-input v-model="form.aiBaseUrl" placeholder="例如: https://api.deepseek.com/v1 或你的中转代理地址" @blur="normalizeUrl"/><p v-if="showV1Reminder" class="field-reminder">建议检查是否需要包含 /v1</p></el-form-item>
            <el-form-item class="wide-field" label="模型"><div class="model-row"><el-select v-model="form.aiModel" filterable allow-create default-first-option placeholder="输入或选择模型名称"><el-option v-for="model in availableModels" :key="model" :label="model" :value="model"/></el-select><el-button :icon="Refresh" :loading="fetchingModels" @click="fetchModels">获取可用模型</el-button></div><p class="field-help">可点击获取列表，或直接手动输入你想使用的模型名称</p></el-form-item>
          </div>
          <div class="api-tip"><el-icon><Cpu/></el-icon><span>OpenAI 兼容协议可接入 DeepSeek 官方、DeepSeek 中转、第三方聚合 API 和 Ollama；Anthropic 与 Gemini 使用各自原生协议。</span></div>
        </section>
        <section id="notify" class="panel setting-section"><div class="section-title"><el-icon><Bell/></el-icon><div><h3>通知</h3><p>任务完成后发送桌面系统通知。</p></div></div><div class="setting-row"><div><strong>系统通知</strong><span>无论成功或失败都及时反馈</span></div><el-switch v-model="form.notifications"/></div></section>
        <section id="security" class="panel setting-section"><div class="section-title"><el-icon><Lock/></el-icon><div><h3>安全状态</h3><p>本地敏感数据保护情况。</p></div></div><div class="security-status"><div class="shield"><el-icon><Lock/></el-icon></div><div><strong>凭据加密已启用</strong><span>AES-256-GCM · 每条数据独立随机 IV · PBKDF2-SHA512 密钥派生</span></div><b>受保护</b></div><div class="setting-row"><div><strong>主密码</strong><span>凭据和 AI API Key 均不会以明文写入数据库。</span></div><el-tag type="success">已启用</el-tag></div></section>
        <section id="advanced" class="panel setting-section"><div class="section-title"><el-icon><Download/></el-icon><div><h3>高级</h3><p>日志保留与数据迁移。</p></div></div><div class="setting-row"><div><strong>日志保留天数</strong><span>定期清理早于该期限的执行记录</span></div><el-input-number v-model="form.retentionDays" :min="7" :max="365"/></div><div class="setting-row"><div><strong>加密数据备份</strong><span>导出或恢复包含任务、凭据、Cookie、执行记录和设置的 .acbackup 文件</span></div><div><el-button @click="importBackup">导入</el-button><el-button type="primary" @click="exportBackup">导出</el-button></div></div></section>
        <p class="build-info">AutoCheckin {{version}} · {{platform}} · Electron + Vue 3</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page{max-width:990px}.settings-layout{display:grid;grid-template-columns:190px 1fr;gap:16px;align-items:start}.settings-nav{padding:10px;position:sticky;top:0}.settings-nav button{width:100%;height:41px;border:0;background:transparent;display:flex;align-items:center;gap:9px;color:#758196;text-align:left;font-size:11px;padding:0 11px;border-radius:8px;cursor:pointer}.settings-nav button:hover,.settings-nav button.active{background:#f1f5fb;color:#365fc8}.settings-content{display:flex;flex-direction:column;gap:13px}.setting-section{padding:21px;scroll-margin-top:20px}.section-title{display:flex;gap:12px;align-items:center;border-bottom:1px solid #edf0f4;padding-bottom:17px}.section-title>.el-icon{width:35px;height:35px;border-radius:9px;background:#edf2ff;color:#456edb;font-size:17px}.section-title h3{font-size:14px;margin:0}.section-title p{font-size:10px;color:#949eae;margin:4px 0 0}.configured-badge{margin-left:auto;color:#218866;background:#d8f0e7;font-size:9px;padding:4px 7px;border-radius:5px}.setting-row{display:flex;justify-content:space-between;align-items:center;padding:17px 2px;border-bottom:1px solid #f0f2f5}.setting-row:last-child{border:0;padding-bottom:2px}.setting-row strong,.setting-row span{display:block}.setting-row strong{font-size:11px}.setting-row span{font-size:10px;color:#969faf;margin-top:4px;max-width:500px;line-height:1.5}.api-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px;margin-top:18px}.api-grid :deep(.el-form-item){margin-bottom:14px}.wide-field{grid-column:1/-1}.wide-field :deep(.el-form-item__content){display:block}.model-row{display:flex;gap:9px}.model-row .el-select{flex:1}.field-help,.field-reminder{font-size:10px;line-height:1.5;margin:5px 0 0}.field-help{color:#8a96a8}.field-reminder{color:#d58a2d}.option-description{float:right;color:#98a1af;margin-left:14px}.api-tip{display:flex;align-items:center;gap:8px;padding:11px 12px;background:#f3f7ff;color:#7589b2;border-radius:9px;font-size:10px}.api-tip .el-icon{color:#4a70d9}.security-status{display:flex;align-items:center;gap:12px;margin-top:17px;background:#eff9f5;border:1px solid #d9f0e7;border-radius:11px;padding:14px}.shield{width:35px;height:35px;border-radius:10px;display:grid;place-items:center;background:#dff3eb;color:#229873}.security-status strong,.security-status span{display:block}.security-status strong{font-size:11px;color:#27785f}.security-status span{font-size:9px;color:#6e9688;margin-top:4px}.security-status b{margin-left:auto;color:#218866;background:#d8f0e7;font-size:9px;padding:4px 7px;border-radius:5px}.build-info{text-align:center;color:#a1a9b6;font-size:9px;margin:4px 0 20px}@media(max-width:760px){.settings-layout{grid-template-columns:1fr}.settings-nav{position:static;display:flex;overflow:auto}.settings-nav button{min-width:90px}.api-grid{grid-template-columns:1fr}.wide-field{grid-column:auto}}
</style>
