import { uuid } from './portable.js'
import type { RunRecord } from '../../shared/types.js'
import type { AIProviderConfig } from '../../shared/schemas.js'

export interface Cipher { encrypt(plain: string): string; decrypt(cipher: string): string }
/** 存储后端：桌面端为本地文件，手机端为 Android Keystore 保护的安全存储。 */
export interface Persistence { read(): string | null; write(text: string): void }

export interface AccountRecord {
  id: string
  platform: string
  uid: string
  nickname: string
  cookies: string // 加密后的 JSON
  enabled: boolean
  time: string
  tasks: Record<string, boolean>
  loginExpired: boolean
  history: RunRecord[]
}

export interface SettingsRecord {
  notifications: boolean
  autoLaunch: boolean
  ai: { enabled: boolean; provider: AIProviderConfig['provider']; baseUrl: string; model: string; apiKey: string /* 加密 */ }
}

interface FileShape { version: 2; accounts: AccountRecord[]; settings: SettingsRecord }

const DEFAULT_SETTINGS: SettingsRecord = { notifications: true, autoLaunch: false, ai: { enabled: false, provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' } }

/** 本地 JSON 存储；Cookie 与 API Key 用系统钥匙串（Electron safeStorage）加密后再写盘。 */
export class Store {
  private data: FileShape
  constructor(private readonly persistence: Persistence, private readonly cipher: Cipher) {
    try {
      const raw = persistence.read()
      if (!raw) throw new Error('empty')
      const parsed = JSON.parse(raw) as FileShape
      this.data = { version: 2, accounts: parsed.accounts ?? [], settings: { ...DEFAULT_SETTINGS, ...parsed.settings, ai: { ...DEFAULT_SETTINGS.ai, ...parsed.settings?.ai } } }
    } catch { this.data = { version: 2, accounts: [], settings: structuredClone(DEFAULT_SETTINGS) } }
  }

  accounts(): AccountRecord[] { return this.data.accounts }
  account(id: string): AccountRecord {
    const found = this.data.accounts.find((item) => item.id === id)
    if (!found) throw new Error('账号不存在')
    return found
  }
  cookies(account: AccountRecord): Record<string, string> {
    try { return JSON.parse(this.cipher.decrypt(account.cookies)) as Record<string, string> } catch { return {} }
  }

  /** 同一平台同一用户再次扫码时更新 Cookie，而不是新增重复账号。 */
  upsertAccount(input: { platform: string; uid: string; nickname: string; cookies: Record<string, string>; tasks: Record<string, boolean> }): AccountRecord {
    const existing = this.data.accounts.find((item) => item.platform === input.platform && item.uid === input.uid)
    const encrypted = this.cipher.encrypt(JSON.stringify(input.cookies))
    if (existing) { Object.assign(existing, { nickname: input.nickname, cookies: encrypted, loginExpired: false }); this.save(); return existing }
    const record: AccountRecord = { id: uuid(), platform: input.platform, uid: input.uid, nickname: input.nickname, cookies: encrypted, enabled: true, time: '08:00', tasks: input.tasks, loginExpired: false, history: [] }
    this.data.accounts.push(record); this.save(); return record
  }

  updateCookies(id: string, cookies: Record<string, string>): void { this.account(id).cookies = this.cipher.encrypt(JSON.stringify(cookies)); this.save() }
  patch(id: string, patch: Partial<Pick<AccountRecord, 'enabled' | 'time' | 'tasks' | 'loginExpired' | 'nickname'>>): AccountRecord {
    const account = this.account(id); Object.assign(account, patch); this.save(); return account
  }
  addRun(id: string, run: RunRecord): void {
    const account = this.account(id); account.history = [run, ...account.history].slice(0, 30); this.save()
  }
  remove(id: string): void { this.data.accounts = this.data.accounts.filter((item) => item.id !== id); this.save() }

  settings(): SettingsRecord { return this.data.settings }
  aiKey(): string { try { return this.data.settings.ai.apiKey ? this.cipher.decrypt(this.data.settings.ai.apiKey) : '' } catch { return '' } }
  saveSettings(patch: Partial<Omit<SettingsRecord, 'ai'>> & { ai?: Partial<SettingsRecord['ai']> }): SettingsRecord {
    const { ai, ...rest } = patch
    Object.assign(this.data.settings, rest)
    if (ai) {
      const { apiKey, ...others } = ai
      Object.assign(this.data.settings.ai, others)
      if (apiKey !== undefined) this.data.settings.ai.apiKey = apiKey ? this.cipher.encrypt(apiKey) : ''
    }
    this.save(); return this.data.settings
  }

  private save(): void { this.persistence.write(JSON.stringify(this.data, null, 2)) }
}
