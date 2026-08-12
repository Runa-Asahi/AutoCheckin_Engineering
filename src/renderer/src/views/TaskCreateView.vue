<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, ArrowRight, Check, Lock, Clock, User, Connection } from '@element-plus/icons-vue'
import { useTaskStore } from '../stores/task'
import type { DetectedBrowser } from '../../../shared/types'

const router = useRouter(), store = useTaskStore(), step = ref(0), saving = ref(false), browserLoading = ref(false)
const selectedId = ref(''), browsers = ref<DetectedBrowser[]>([]), selectedBrowserKey = ref('')
const form = reactive({ accountLabel: '', schedule: '0 8 * * *', username: '', password: '', cookies: '', customPath: '', enabled: true, loginType: 'manual' as 'password' | 'cookie' | 'manual' | 'local_browser', profileMode: 'managed' as 'managed' | 'system', browserId: '', channel: 'chrome' as 'chrome' | 'msedge', executablePath: '', userDataDir: '', profileName: 'Default' })
const selected = computed(() => store.adapters.find((adapter) => adapter.id === selectedId.value))
const isLocalBrowser = computed(() => form.loginType === 'local_browser')
const browserOptions = computed(() => browsers.value.flatMap((browser) => (browser.profiles.length ? browser.profiles : ['Default']).map((profile) => ({ key: `${browser.id}:${profile}`, label: `${browser.name} (${profile} Profile)`, browser, profile }))))
const loginHelp = computed(() => form.loginType === 'cookie' ? '从浏览器扩展导出 Cookie JSON，或粘贴 Cookie 请求头。数据会在本地加密。' : form.loginType === 'password' ? '输入网站账户信息，凭据会在写入数据库前加密。' : isLocalBrowser.value ? '推荐使用任务专属浏览器档案：首次登录并签到一次，之后后台静默复用完整状态。' : '手动登录只会在你明确点击登录通知时打开窗口。')

async function loadBrowsers(): Promise<void> { browserLoading.value = true; try { browsers.value = await window.api.system.getDetectedBrowsers() } catch (error) { ElMessage.warning(error instanceof Error ? error.message : String(error)) } finally { browserLoading.value = false } }
function selectBrowser(key: string): void {
  selectedBrowserKey.value = key
  if (key === 'custom') { form.browserId = ''; form.executablePath = ''; form.userDataDir = form.customPath; form.profileName = 'Default'; return }
  const option = browserOptions.value.find((item) => item.key === key); if (!option) return
  form.browserId = option.browser.id; form.channel = option.browser.channel; form.executablePath = option.browser.executablePath; form.userDataDir = option.browser.userDataDir; form.profileName = option.profile
}
function selectAdapter(adapterId: string): void { selectedId.value = adapterId; const adapter = store.adapters.find((item) => item.id === adapterId); form.loginType = adapter?.loginType ?? 'manual' }
watch(selectedId, (id) => { const adapter = store.adapters.find((item) => item.id === id); if (adapter) form.loginType = adapter.loginType })
function next(): void { if (step.value === 0 && !selected.value) { ElMessage.warning('请先选择网站'); return }; step.value = Math.min(3, step.value + 1) }
async function submit(): Promise<void> {
  if (!selected.value) return
  saving.value = true
  try {
    const adapter = selected.value
    const fallbackBrowser = browsers.value[0]
    const config = isLocalBrowser.value ? { local_browser_config: { profileMode: form.profileMode, browserId: form.browserId || fallbackBrowser?.id, userDataDir: form.profileMode === 'system' ? ((form.customPath || form.userDataDir).trim() || undefined) : undefined, executablePath: form.executablePath || fallbackBrowser?.executablePath, channel: form.channel || fallbackBrowser?.channel, profileName: form.profileMode === 'system' ? (form.profileName || 'Default') : 'Default' } } : {}
    const task = await store.createTask({ siteId: adapter.siteId, siteName: adapter.siteName, engineType: adapter.engineType, loginType: form.loginType, schedule: form.schedule, enabled: form.enabled, priority: 0, adapterId: adapter.id, accountLabel: form.accountLabel || undefined, config, credentials: form.loginType === 'password' ? { username: form.username, password: form.password } : undefined, cookies: form.loginType === 'cookie' ? form.cookies : undefined })
    ElMessage.success('任务创建成功'); router.push(`/tasks/${task.id}`)
  } finally { saving.value = false }
}
onMounted(async () => { await store.fetchAdapters(); await loadBrowsers(); try { const raw = await window.api.config.get('local_browser_default'); const saved = raw ? JSON.parse(raw) as { key?: string } : {}; if (saved.key && browserOptions.value.some((option) => option.key === saved.key)) selectBrowser(saved.key) } catch { /* optional preference */ } })
</script>

<template>
  <div class="page create-page">
    <header class="page-header"><div><el-button text :icon="ArrowLeft" @click="router.push('/')">返回任务列表</el-button><h1>添加签到任务</h1><p>跟随向导完成网站、登录状态与执行计划配置。</p></div></header>
    <div class="wizard-layout"><aside class="stepper panel"><div v-for="(label,index) in ['选择网站','配置登录','执行计划','确认创建']" :key="label" class="step-item" :class="{active:step===index,done:step>index}"><div class="step-index"><el-icon v-if="step>index"><Check/></el-icon><span v-else>{{index+1}}</span></div><strong>{{label}}</strong></div></aside>
      <section class="panel wizard-card">
        <div v-if="step===0"><h2>选择网站</h2><p class="intro">选择内置或 AI 生成的 v2.0 适配器。</p><div class="adapter-grid"><button v-for="adapter in store.adapters" :key="adapter.id" class="adapter-card" :class="{selected:selectedId===adapter.id}" @click="selectedId=adapter.id"><div class="adapter-logo">{{adapter.siteName.slice(0,1)}}</div><div><strong>{{adapter.siteName}}</strong><span>{{adapter.siteUrl}}</span></div><em>{{adapter.engineType}}</em><div class="select-dot"><el-icon v-if="selectedId===adapter.id"><Check/></el-icon></div></button></div><button class="coming" @click="router.push('/ai-guide')"><Connection/><div><strong>自定义网站 / AI 引导</strong><span>输入公开 URL，安全分析 DOM 并生成可审核适配器。</span></div><b>打开</b></button></div>
        <div v-else-if="step===1"><h2>配置登录</h2><p class="intro">{{loginHelp}}</p><div class="security-note"><el-icon><Lock/></el-icon><div><strong>端到端本地保护</strong><span>登录数据不会上传，敏感值采用独立随机 IV 加密。</span></div></div><el-form label-position="top" class="form-area">
          <el-form-item label="登录方式"><el-select v-model="form.loginType"><el-option label="手动登录（点击通知时打开）" value="manual"/><el-option label="浏览器持久登录（推荐）" value="local_browser"/><el-option label="Cookie" value="cookie"/><el-option label="账号密码" value="password"/></el-select></el-form-item>
          <template v-if="form.loginType==='cookie'"><el-form-item label="Cookie 数据"><el-input v-model="form.cookies" type="textarea" :rows="8" placeholder="A=1; B=2，或浏览器导出的 JSON 数组"/></el-form-item></template>
          <template v-else-if="form.loginType==='password'"><el-form-item label="用户名"><el-input v-model="form.username"/></el-form-item><el-form-item label="密码"><el-input v-model="form.password" type="password" show-password/></el-form-item></template>
          <template v-else-if="isLocalBrowser"><el-form-item label="登录状态保存方式"><el-radio-group v-model="form.profileMode"><el-radio-button value="managed">任务专用档案（推荐）</el-radio-button><el-radio-button value="system">日常浏览器 Profile</el-radio-button></el-radio-group></el-form-item><div v-if="form.profileMode==='managed'" class="managed-note"><strong>不会影响你平时的 Chrome</strong><span>创建后在任务详情点击“引导登录并完成首次签到”。登录状态会长期保留，也不会遇到日常 Chrome 的 Profile 锁。</span></div><template v-else><el-form-item label="浏览器与 Profile"><el-select v-model="selectedBrowserKey" filterable :loading="browserLoading" placeholder="选择本机浏览器 Profile" @change="selectBrowser"><el-option v-for="option in browserOptions" :key="option.key" :label="option.label" :value="option.key"/><el-option label="自定义路径" value="custom"/></el-select></el-form-item><el-form-item v-if="selectedBrowserKey==='custom'" label="Custom Path"><el-input v-model="form.customPath" placeholder="粘贴 Chrome/Edge User Data 目录" @blur="form.userDataDir=form.customPath"/></el-form-item><p class="field-help">复用日常 Profile 时，执行前仍需完全关闭对应浏览器。</p></template></template>
          <el-form-item label="账户备注（可选）"><el-input v-model="form.accountLabel" :prefix-icon="User" placeholder="例如：主账号 / 备用账号"/></el-form-item>
        </el-form></div>
        <div v-else-if="step===2"><h2>执行计划</h2><p class="intro">计划使用标准 Cron 表达式，默认每天上午 08:00 执行。</p><div class="schedule-hero"><el-icon><Clock/></el-icon><div><strong>每天自动签到</strong><span>应用在运行期间按本地时区触发</span></div><el-switch v-model="form.enabled"/></div><el-form label-position="top" class="form-area"><el-form-item label="Cron 表达式"><el-input v-model="form.schedule" size="large"/></el-form-item></el-form></div>
        <div v-else><h2>确认任务</h2><p class="intro">核对以下信息，创建后可随时在任务列表中修改。</p><div class="review-card"><strong>{{selected?.siteName}}</strong><span>{{selected?.siteUrl}}</span><dl><div><dt>执行引擎</dt><dd>{{selected?.engineType.toUpperCase()}}</dd></div><div><dt>登录方式</dt><dd>{{form.loginType}}</dd></div><div v-if="isLocalBrowser"><dt>浏览器档案</dt><dd>{{form.profileMode==='managed' ? 'AutoCheckin 任务专用档案' : `${form.channel} / ${form.profileName}`}}</dd></div><div><dt>计划</dt><dd>{{form.schedule}}</dd></div></dl></div></div>
        <footer class="wizard-footer"><el-button v-if="step>0" @click="step--">上一步</el-button><span/><el-button v-if="step<3" class="primary-button" type="primary" :icon="ArrowRight" @click="next">继续</el-button><el-button v-else class="primary-button" type="primary" :icon="Check" :loading="saving" @click="submit">创建任务</el-button></footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.create-page{max-width:1050px}.wizard-layout{display:grid;grid-template-columns:210px 1fr;gap:18px;align-items:start}.stepper{padding:18px}.step-item{display:flex;gap:10px;align-items:center;padding:13px 4px;font-size:12px}.step-index{width:28px;height:28px;border-radius:9px;background:#f0f3f7;color:#8995a7;display:grid;place-items:center}.step-item.active .step-index{background:#3d6be9;color:#fff}.step-item.done .step-index{background:#e8f7f1;color:#1e9b72}.wizard-card{min-height:570px;padding:30px 34px 0;display:flex;flex-direction:column}.wizard-card>div{flex:1}.wizard-card h2{font-size:20px;margin:0}.intro{font-size:12px;color:#8590a2;margin:8px 0 25px}.adapter-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.adapter-card{position:relative;min-height:87px;border:1px solid #e0e5ee;background:#fff;border-radius:12px;display:flex;align-items:center;text-align:left;gap:12px;padding:14px;cursor:pointer;color:#19243a}.adapter-card.selected{border:1.5px solid #4c76e8;background:#f8faff}.adapter-logo{width:43px;height:43px;border-radius:11px;display:grid;place-items:center;background:#e9efff;color:#3965d4;font-weight:800}.adapter-card strong,.adapter-card span{display:block}.adapter-card span{font-size:10px;color:#929cad;margin-top:4px}.adapter-card em{position:absolute;right:13px;top:12px;font-size:9px;color:#78869c}.select-dot{position:absolute;right:13px;bottom:12px;width:18px;height:18px;border:1px solid #dce2eb;border-radius:50%;display:grid;place-items:center}.selected .select-dot{background:#4774e9;color:#fff}.coming{display:flex;align-items:center;gap:13px;margin-top:14px;padding:15px;width:100%;border:1px dashed #d9e0eb;border-radius:12px;background:#fff;color:#8a95a6;text-align:left}.coming strong,.coming span{display:block}.coming span{font-size:10px;margin-top:4px}.coming b{margin-left:auto}.security-note,.schedule-hero{display:flex;align-items:center;gap:13px;background:#f3f7ff;border:1px solid #e2eaff;border-radius:12px;padding:14px 16px;color:#3c65cc}.security-note strong,.security-note span,.schedule-hero strong,.schedule-hero span{display:block}.security-note span,.schedule-hero span{font-size:10px;color:#768bb8;margin-top:3px}.form-area{margin-top:22px;max-width:600px}.field-help{font-size:10px;color:#8a96a8;margin-top:-7px}.review-card{border:1px solid #e2e7ef;border-radius:13px;padding:18px}.review-card>strong,.review-card>span{display:block}.review-card>span{font-size:10px;color:#929cad;margin-top:5px}.review-card dl{margin-top:18px}.review-card dl div{display:flex;padding:10px 0;border-bottom:1px solid #eef1f5}.review-card dt{width:130px;color:#8994a5;font-size:11px}.review-card dd{margin:0;font-size:11px;font-weight:600}.wizard-footer{height:72px;margin:25px -34px 0;padding:0 34px;border-top:1px solid #edf0f4;display:flex;align-items:center}.wizard-footer span{flex:1}@media(max-width:760px){.wizard-layout{grid-template-columns:1fr}.adapter-grid{grid-template-columns:1fr}}
.managed-note{margin:-4px 0 16px;padding:13px 15px;border:1px solid #dfe8ff;border-radius:10px;background:#f4f7ff}.managed-note strong,.managed-note span{display:block}.managed-note span{margin-top:5px;color:#657795;font-size:11px;line-height:1.6}
</style>
