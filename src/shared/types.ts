import type { AIProviderConfig, UpdateAccountInput } from './schemas.js'

/** 单个任务的执行结果。只有经过二次确认（verified）才会是 success / already。 */
export type TaskStatus = 'success' | 'already' | 'failed' | 'login_expired' | 'skipped'
export interface TaskResult { taskId: string; label: string; status: TaskStatus; message: string }

export interface PlatformTaskInfo { id: string; label: string; description: string; defaultOn: boolean }
export interface PlatformInfo {
  id: string; name: string; loginHint: string; loginKind: 'qr' | 'web'; tasks: PlatformTaskInfo[]
  /** 官方 App 名称（手机端“在 App 中打开 / 从相册扫码”的文案用） */
  appName?: string
  /** 手机端：扫码之外还可改用官方网页登录 */
  webFallback?: boolean
}

export interface RunRecord { at: string; date: string; trigger: 'manual' | 'schedule'; results: TaskResult[]; attempt: number }

export interface AccountView {
  id: string
  platform: string
  platformName: string
  nickname: string
  uid: string
  enabled: boolean
  time: string
  tasks: Record<string, boolean>
  lastRun: RunRecord | null
  history: RunRecord[]
  loginExpired: boolean
  running: boolean
}

export type QrState = 'waiting' | 'scanned' | 'expired' | 'success' | 'error'
export interface QrStart {
  sessionId: string; image: string
  /** 二维码里的原始链接 */
  content?: string
  /** 用官方 App 直接打开确认页的链接（尽力而为，可能不被 App 支持） */
  appLink?: string
}
export interface QrPoll { state: QrState; message: string; account?: AccountView }

export interface AISettingsView { enabled: boolean; provider: AIProviderConfig['provider']; baseUrl: string; model: string; hasKey: boolean }
export interface AppSettingsView { notifications: boolean; autoLaunch: boolean; ai: AISettingsView; /** false 表示系统钥匙串不可用，已改用本地密钥加密 */ keychainAvailable?: boolean; /** 运行在手机 App 中 */ mobile?: boolean }

export interface AutoCheckinApi {
  platforms(): Promise<PlatformInfo[]>
  accounts(): Promise<AccountView[]>
  startQrLogin(platform: string): Promise<QrStart>
  pollQrLogin(sessionId: string): Promise<QrPoll>
  cancelQrLogin(sessionId: string): Promise<void>
  /** 打开官方登录窗口，登录完成后自动保存账号。 */
  webLogin(platform: string): Promise<QrPoll>
  updateAccount(input: UpdateAccountInput): Promise<AccountView>
  removeAccount(id: string): Promise<void>
  runNow(id: string): Promise<AccountView>
  settings(): Promise<AppSettingsView>
  saveSettings(input: { notifications?: boolean; autoLaunch?: boolean; ai?: Partial<AIProviderConfig> & { enabled?: boolean } }): Promise<AppSettingsView>
  explainFailure(id: string): Promise<string>
  onAccountsChanged(callback: (accounts: AccountView[]) => void): () => void
  openExternal(url: string): Promise<void>
  /** UI language info (desktop: from LC_ALL/LC_MESSAGES/LANG or OS locale). Optional: mobile uses navigator.language. */
  locale?(): Promise<{ system: 'zh' | 'en'; pref: 'zh' | 'en' | 'auto'; lang: 'zh' | 'en' }>
  setLocale?(pref: 'zh' | 'en' | 'auto'): Promise<{ system: 'zh' | 'en'; pref: 'zh' | 'en' | 'auto'; lang: 'zh' | 'en' }>
  /** 仅手机端：用官方 App 打开链接，false 表示没装 */
  openApp?(url: string): Promise<boolean>
  /** 仅手机端：把 data:image/png 保存到相册 */
  saveImage?(dataUrl: string, fileName: string): Promise<{ saved: boolean; reason?: string }>
}
