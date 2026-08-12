<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { MagicStick, Search, Check, Lock, Setting } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { useConfigStore } from '../stores/config'
import type { AIAnalysis, AIGeneration, AdapterInspectionReport } from '../../../shared/types'
import type { AIProvider } from '../../../shared/schemas'
import { AI_PROVIDER_PRESETS, getProviderPreset, normalizeBaseUrl } from '../../../shared/aiProviders'
import { friendlyIpcMessage } from '../utils/apiError'

const router = useRouter(), config = useConfigStore()
const form = reactive({ url: '', provider: 'openai' as AIProvider, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', apiKey: '' })
const analysis = ref<AIAnalysis | null>(null), generation = ref<AIGeneration | null>(null), inspection = ref<AdapterInspectionReport | null>(null), json = ref(''), analyzing = ref(false), generating = ref(false), inspecting = ref(false), saving = ref(false), apiConfigured = ref(false)
const canGenerate = computed(() => Boolean(analysis.value && form.baseUrl && form.model && (form.apiKey.length >= 8 || getProviderPreset(form.provider).apiKeyOptional)))

function providerChanged(): void { const preset = getProviderPreset(form.provider); form.baseUrl = preset.baseUrl; form.model = preset.defaultModel }
async function analyze(): Promise<void> {
  analyzing.value = true; generation.value = null
  try { analysis.value = await window.api.ai.analyze(form.url); ElMessage.success('页面结构分析完成') }
  catch (error) { ElMessage.error(friendlyIpcMessage(error)) } finally { analyzing.value = false }
}
async function generate(): Promise<void> {
  if (!analysis.value) return
  generating.value = true
  try {
    generation.value = await window.api.ai.generate({ url: analysis.value.url, domSummary: analysis.value.domSummary, provider: form.provider, baseUrl: normalizeBaseUrl(form.baseUrl), apiKey: form.apiKey, model: form.model })
    inspection.value = generation.value.inspection; json.value = JSON.stringify(generation.value.adapter, null, 2); generation.value.inspection.valid ? ElMessage.success(generation.value.autoRepaired ? '适配器经 AI 单次修复后通过自检' : '适配器已生成并通过自检') : ElMessage.warning('适配器生成完成，但仍有阻断问题，请查看自检报告')
  } catch (error) { ElMessage.error(friendlyIpcMessage(error)) } finally { generating.value = false }
}
async function save(): Promise<void> {
  saving.value = true
  try { await window.api.ai.saveAdapter(JSON.parse(json.value)); ElMessage.success('适配器已保存，可在创建任务时选择') }
  catch (error) { ElMessage.error(friendlyIpcMessage(error)) } finally { saving.value = false }
}
async function inspectCurrent(): Promise<void> { inspecting.value = true; try { inspection.value = await window.api.ai.inspect(JSON.parse(json.value)); inspection.value.valid ? ElMessage.success('自检通过，可以保存') : ElMessage.warning('自检发现阻断问题，请按报告修改') } catch (error) { ElMessage.error(friendlyIpcMessage(error)) } finally { inspecting.value = false } }
onMounted(async () => {
  const [providerRaw, baseUrl, model, apiKey] = await Promise.all([config.getSetting('ai_provider', 'openai'), config.getSetting('ai_base_url', ''), config.getSetting('ai_model', 'gpt-4.1-mini'), config.getSetting('ai_api_key', '')])
  const provider = AI_PROVIDER_PRESETS.some((item) => item.id === providerRaw) ? providerRaw as AIProvider : 'custom-openai'
  const preset = getProviderPreset(provider)
  Object.assign(form, { provider, baseUrl: normalizeBaseUrl(baseUrl || preset.baseUrl), model: model || preset.defaultModel, apiKey })
  apiConfigured.value = Boolean(apiKey) || Boolean(preset.apiKeyOptional)
})
</script>

<template>
  <div class="page ai-page">
    <header class="page-header"><div><h1>AI 配置向导</h1><p>分析公开页面 DOM，生成符合 v2.0 Schema 的签到适配器。</p></div><el-button :icon="Setting" @click="router.push('/settings')">API 设置</el-button></header>
    <div class="safety panel"><el-icon><Lock/></el-icon><div><strong>隐私与安全边界</strong><p>输入值、令牌属性、脚本和敏感 DOM 会在发送前移除；禁止访问本机或局域网地址，也不会生成验证码或反自动化绕过逻辑。</p></div></div>
    <section class="panel ai-card"><div class="step-label">01 · 分析网站</div><div class="url-row"><el-input v-model="form.url" size="large" placeholder="https://example.com/checkin" :prefix-icon="Search" @keyup.enter="analyze"/><el-button class="primary-button" type="primary" :loading="analyzing" @click="analyze">分析页面</el-button></div><div v-if="analysis" class="analysis-result"><el-icon><Check/></el-icon><div><strong>{{analysis.title||analysis.url}}</strong><span>{{analysis.url}} · 约 {{analysis.estimatedInputTokens.toLocaleString()}} 输入 Token</span></div></div></section>
    <section class="panel ai-card" :class="{disabled:!analysis}">
      <div class="step-title-row"><div class="step-label">02 · 选择模型并生成</div><span v-if="apiConfigured" class="configured">已从设置加载 API Key</span></div>
      <div class="provider-row"><el-select v-model="form.provider" @change="providerChanged"><el-option v-for="item in AI_PROVIDER_PRESETS" :key="item.id" :label="item.label" :value="item.id"/></el-select><el-select v-model="form.model" filterable allow-create default-first-option placeholder="手动输入模型名称"><el-option :label="form.model" :value="form.model"/></el-select><el-input v-model="form.apiKey" type="password" show-password placeholder="sk-..."/><el-button type="primary" :icon="MagicStick" :disabled="!canGenerate" :loading="generating" @click="generate">生成</el-button></div>
      <p class="model-help">可直接手动输入模型名称；Base URL 与模型列表可在“API 设置”中调整。</p>
    </section>
    <section v-if="generation" class="panel ai-card"><div class="result-head"><div><div class="step-label">03 · 自检、审核并保存</div><p>执行静态与语义检查；AI 最多自动修复一次，仍有错误时禁止保存。</p></div><div class="cost">预估费用 <strong>${{generation.estimatedCostUsd.toFixed(6)}}</strong><span>{{generation.inputTokens}} in / {{generation.outputTokens}} out</span></div></div><div v-if="inspection" class="inspection" :class="inspection.valid?'inspection-ok':'inspection-error'"><div class="inspection-head"><strong>{{inspection.valid?'自检通过':'自检未通过'}} · {{inspection.score}} 分</strong><span v-if="generation.autoRepaired">已执行 AI 单次自动修复</span></div><div v-if="inspection.issues.length" class="issue-list"><div v-for="issue in inspection.issues" :key="`${issue.code}-${issue.path}`" :class="['issue',issue.severity]"><b>{{issue.severity==='error'?'错误':issue.severity==='warning'?'警告':'提示'}}</b><div><strong>{{issue.path}} · {{issue.message}}</strong><span>{{issue.suggestion}}</span></div></div></div><span v-else class="inspection-empty">Schema、执行步骤、成功规则、安全边界检查均通过。</span></div><el-input v-model="json" type="textarea" :rows="20" class="json-editor"/><div class="save-row"><el-button :loading="inspecting" @click="inspectCurrent">重新自检</el-button><el-button class="primary-button" type="primary" :disabled="!inspection?.valid" :loading="saving" @click="save">保存适配器</el-button></div></section>
  </div>
</template>

<style scoped>
.ai-page{max-width:980px}.safety{display:flex;gap:13px;align-items:flex-start;padding:16px 18px;background:#f1f7ff;margin-bottom:14px}.safety>.el-icon{width:32px;height:32px;border-radius:9px;background:#dfeaff;color:#4269ca}.safety strong{font-size:11px;color:#365cae}.safety p{font-size:10px;color:#7185aa;line-height:1.6;margin:4px 0 0}.ai-card{padding:23px;margin-bottom:14px}.step-label{font-size:10px;font-weight:750;letter-spacing:.8px;color:#4b70d2;text-transform:uppercase;margin-bottom:15px}.step-title-row{display:flex;justify-content:space-between}.configured{font-size:9px;color:#228865;background:#ddf2e9;padding:4px 7px;border-radius:5px;height:22px}.url-row{display:flex;gap:10px}.analysis-result{display:flex;gap:10px;align-items:center;margin-top:15px;padding:12px;background:#edf8f3;border-radius:10px;color:#278a69}.analysis-result>.el-icon{width:25px;height:25px;border-radius:50%;background:#d7efe6}.analysis-result strong,.analysis-result span{display:block}.analysis-result strong{font-size:11px}.analysis-result span{font-size:9px;margin-top:3px;color:#6e9487}.provider-row{display:grid;grid-template-columns:170px 210px 1fr 100px;gap:9px}.model-help{font-size:10px;color:#8a96a8;margin:8px 0 0}.disabled{opacity:.55;pointer-events:none}.result-head{display:flex;justify-content:space-between}.result-head p{font-size:10px;color:#8e99aa;margin:-7px 0 14px}.cost{text-align:right;font-size:9px;color:#8a95a6}.cost strong,.cost span{display:block}.cost strong{font-size:14px;color:#315dca;margin:3px 0}.json-editor :deep(textarea){font-family:"Cascadia Code",Consolas,monospace;font-size:11px;line-height:1.55;background:#111a2a;color:#c3d2ed;box-shadow:none!important}.save-row{display:flex;justify-content:flex-end;margin-top:15px}@media(max-width:800px){.provider-row{grid-template-columns:1fr 1fr}.provider-row .el-button{width:100%}}
.inspection{margin-bottom:14px;padding:14px;border:1px solid #dfe5ee;border-radius:8px}.inspection-ok{background:#f2faf6;border-color:#cce9db}.inspection-error{background:#fff7f7;border-color:#efd2d4}.inspection-head{display:flex;justify-content:space-between;font-size:11px}.inspection-head span{color:#697991;font-size:10px}.issue-list{display:flex;flex-direction:column;gap:8px;margin-top:11px}.issue{display:flex;gap:9px;align-items:flex-start}.issue>b{flex:none;border-radius:4px;padding:2px 5px;font-size:9px;background:#e9edf4;color:#637087}.issue.error>b{background:#f7dfe1;color:#b84a51}.issue.warning>b{background:#fff0d4;color:#aa7620}.issue strong,.issue span{display:block;font-size:10px}.issue span{margin-top:3px;color:#7f8b9e}.inspection-empty{display:block;margin-top:8px;color:#438267;font-size:10px}.save-row{gap:8px}
</style>
