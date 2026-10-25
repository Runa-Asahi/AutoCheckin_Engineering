import type { WebLogin } from './platform.js'
import QRCode from 'qrcode'
import { HttpSession } from './http.js'
import { uuid } from './portable.js'
import { PLATFORMS, getPlatform } from './platforms/index.js'
import { isDue, runAccount } from './runner.js'
import type { AccountRecord, Store } from './store.js'
import type { AccountView, AppSettingsView, PlatformInfo, QrPoll, QrStart, RunRecord } from '../../shared/types.js'
import type { AIProviderConfig, UpdateAccountInput } from '../../shared/schemas.js'
import { UnifiedAIClient } from '../ai/client/unifiedAIClient.js'
import { sanitizeLog } from '../security/logSanitizer.js'

interface QrSession { platform: string; key: string; http: HttpSession; createdAt: number }

export interface ServiceHooks {
  onChange?: (accounts: AccountView[]) => void
  notify?: (title: string, body: string) => void
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  ai?: Pick<UnifiedAIClient, 'generate'>
  /** 手机端：所有平台都走网页登录。 */
  mobile?: boolean
}

export class CheckinService {
  private readonly qr = new Map<string, QrSession>()
  private readonly running = new Set<string>()
  private readonly ai: Pick<UnifiedAIClient, 'generate'>
  constructor(private readonly store: Store, private readonly hooks: ServiceHooks = {}) { this.ai = hooks.ai ?? new UnifiedAIClient() }

  /** 该平台在当前设备上使用的网页登录配置（没有则为扫码）。 */
  loginFor(platformId: string): WebLogin | undefined {
    const platform = getPlatform(platformId)
    return this.hooks.mobile ? (platform.mobileLogin ?? platform.webLogin) : platform.webLogin
  }
  platforms(): PlatformInfo[] {
    return PLATFORMS.map((p) => {
      // 手机端优先扫码（配合“在 App 中打开”/“保存到相册”），网页登录作为备选
      const loginKind = this.hooks.mobile ? (p.qrStart ? 'qr' : 'web') : (p.webLogin ? 'web' : 'qr')
      return { id: p.id, name: p.name, loginHint: p.loginHint, tasks: p.tasks, loginKind, appName: p.appName, webFallback: Boolean(this.hooks.mobile && p.qrStart && this.loginFor(p.id)) }
    })
  }
  accounts(): AccountView[] { return this.store.accounts().map((account) => this.view(account)) }

  async startQrLogin(platformId: string): Promise<QrStart> {
    const platform = getPlatform(platformId), http = new HttpSession()
    if (!platform.qrStart) throw new Error(`${platform.name} 不支持扫码登录`)
    const ticket = await platform.qrStart(http)
    const sessionId = uuid()
    this.qr.set(sessionId, { platform: platformId, key: ticket.key, http, createdAt: Date.now() })
    const image = await QRCode.toDataURL(ticket.content, { width: this.hooks.mobile ? 600 : 240, margin: this.hooks.mobile ? 3 : 1 })
    return { sessionId, image, content: ticket.content, appLink: platform.appLink?.(ticket.content) }
  }

  async pollQrLogin(sessionId: string): Promise<QrPoll> {
    const entry = this.qr.get(sessionId)
    if (!entry) return { state: 'expired', message: '二维码已失效，请刷新' }
    const platform = getPlatform(entry.platform)
    if (!platform.qrPoll) return { state: 'error', message: '该平台不支持扫码登录' }
    const state = await platform.qrPoll(entry.http, entry.key)
    if (state.state !== 'success') { if (state.state === 'expired' || state.state === 'error') this.qr.delete(sessionId); return state }
    this.qr.delete(sessionId)
    const profile = await platform.profile(entry.http)
    const record = this.store.upsertAccount({ platform: platform.id, uid: profile.uid, nickname: profile.nickname, cookies: entry.http.cookies, tasks: Object.fromEntries(platform.tasks.map((task) => [task.id, task.defaultOn])) })
    this.changed()
    return { state: 'success', message: `已添加 ${profile.nickname}`, account: this.view(record) }
  }

  cancelQrLogin(sessionId: string): void { this.qr.delete(sessionId) }

  /** 网页登录完成后调用：只保留声明的登录 Cookie，校验登录有效后保存账号。 */
  async completeWebLogin(platformId: string, captured: Record<string, string>): Promise<QrPoll> {
    const platform = getPlatform(platformId)
    const login = this.loginFor(platformId)
    if (!login) return { state: 'error', message: '该平台不支持网页登录' }
    const missing = login.requiredCookies.filter((name) => !captured[name])
    if (missing.length) return { state: 'error', message: '没有检测到登录完成，请在窗口里完成登录' }
    const http = new HttpSession(captured)
    try {
      const profile = await platform.profile(http)
      const record = this.store.upsertAccount({ platform: platform.id, uid: profile.uid, nickname: profile.nickname, cookies: http.cookies, tasks: Object.fromEntries(platform.tasks.map((task) => [task.id, task.defaultOn])) })
      this.changed()
      return { state: 'success', message: `已添加 ${profile.nickname}`, account: this.view(record) }
    } catch (error) { return { state: 'error', message: `登录校验失败：${(error as Error).message}` } }
  }

  update(input: UpdateAccountInput): AccountView {
    const { id, ...patch } = input
    const account = this.store.patch(id, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)))
    this.changed(); return this.view(account)
  }
  remove(id: string): void { this.store.remove(id); this.changed() }

  async runNow(id: string, trigger: RunRecord['trigger'] = 'manual'): Promise<AccountView> {
    if (this.running.has(id)) return this.view(this.store.account(id))
    this.running.add(id); this.changed()
    try {
      const record = await runAccount(id, trigger, { store: this.store, now: this.hooks.now, sleep: this.hooks.sleep })
      this.notifyRun(this.store.account(id), record)
    } finally { this.running.delete(id); this.changed() }
    return this.view(this.store.account(id))
  }

  /** 每分钟调用一次。 */
  async tick(): Promise<void> {
    const now = (this.hooks.now ?? (() => new Date()))()
    for (const account of this.store.accounts()) {
      if (!this.running.has(account.id) && isDue(account, now)) await this.runNow(account.id, 'schedule')
    }
  }

  settings(): AppSettingsView {
    const s = this.store.settings()
    return { notifications: s.notifications, autoLaunch: s.autoLaunch, ai: { enabled: s.ai.enabled, provider: s.ai.provider, baseUrl: s.ai.baseUrl, model: s.ai.model, hasKey: Boolean(s.ai.apiKey) } }
  }
  saveSettings(input: { notifications?: boolean; autoLaunch?: boolean; ai?: Partial<AIProviderConfig> & { enabled?: boolean } }): AppSettingsView {
    this.store.saveSettings(input); return this.settings()
  }

  /** 用 AI 把失败原因翻译成大白话。只发送脱敏后的结果文本，不发送 Cookie。 */
  async explainFailure(id: string): Promise<string> {
    const s = this.store.settings()
    if (!s.ai.enabled) throw new Error('请先在“高级设置”里开启 AI 解释并填写 API Key')
    const account = this.store.account(id), last = account.history[0]
    if (!last) throw new Error('这个账号还没有运行记录')
    const platform = getPlatform(account.platform)
    const prompt = `你是签到助手的客服。用户不懂技术。下面是“${platform.name}”自动签到的最近一次结果（已脱敏）。请用不超过 5 句简体中文大白话说明：哪些没成功、最可能的原因、用户现在该做什么（例如重新扫码、稍后重试、在 App 里手动操作一次、等待软件更新）。不要编造未出现的信息，不要输出代码或 JSON。\n结果：${sanitizeLog(last.results)}`
    return (await this.ai.generate({ provider: s.ai.provider, baseUrl: s.ai.baseUrl, model: s.ai.model, apiKey: this.store.aiKey() }, prompt)).trim()
  }

  private notifyRun(account: AccountRecord, record: RunRecord): void {
    if (!this.store.settings().notifications || !this.hooks.notify) return
    const platform = getPlatform(account.platform)
    const bad = record.results.filter((item) => item.status === 'failed' || item.status === 'login_expired')
    const title = bad.length ? `${platform.name}（${account.nickname}）有 ${bad.length} 项没完成` : `${platform.name}（${account.nickname}）签到完成`
    this.hooks.notify(title, record.results.map((item) => `${item.label}：${item.message}`).join('\n'))
  }

  private view(account: AccountRecord): AccountView {
    const platform = getPlatform(account.platform)
    return {
      id: account.id, platform: account.platform, platformName: platform.name, nickname: account.nickname, uid: account.uid,
      enabled: account.enabled, time: account.time, loginExpired: account.loginExpired, running: this.running.has(account.id),
      tasks: Object.fromEntries(platform.tasks.map((task) => [task.id, account.tasks[task.id] ?? task.defaultOn])),
      lastRun: account.history[0] ?? null, history: account.history.slice(0, 10),
    }
  }
  private changed(): void { this.hooks.onChange?.(this.accounts()) }
}
