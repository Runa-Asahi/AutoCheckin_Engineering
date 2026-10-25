import type { AIProviderConfig, UpdateAccountInput } from './schemas.js'

/** 单个任务的执行结果。只有经过二次确认（verified）才会是 success / already。 */
export type TaskStatus = 'success' | 'already' | 'failed' | 'login_expired' | 'skipped'
export interface TaskResult { taskId: string; label: string; status: TaskStatus; message: string }

export interface PlatformTaskInfo { id: string; label: string; description: string; defaultOn: boolean }
export interface PlatformInfo { id: string; name: string; loginHint: string; tasks: PlatformTaskInfo[] }

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
export interface QrStart { sessionId: string; image: string }
export interface QrPoll { state: QrState; message: string; account?: AccountView }

export interface AISettingsView { enabled: boolean; provider: AIProviderConfig['provider']; baseUrl: string; model: string; hasKey: boolean }
export interface AppSettingsView { notifications: boolean; autoLaunch: boolean; ai: AISettingsView }

export interface AutoCheckinApi {
  platforms(): Promise<PlatformInfo[]>
  accounts(): Promise<AccountView[]>
  startQrLogin(platform: string): Promise<QrStart>
  pollQrLogin(sessionId: string): Promise<QrPoll>
  cancelQrLogin(sessionId: string): Promise<void>
  updateAccount(input: UpdateAccountInput): Promise<AccountView>
  removeAccount(id: string): Promise<void>
  runNow(id: string): Promise<AccountView>
  settings(): Promise<AppSettingsView>
  saveSettings(input: { notifications?: boolean; autoLaunch?: boolean; ai?: Partial<AIProviderConfig> & { enabled?: boolean } }): Promise<AppSettingsView>
  explainFailure(id: string): Promise<string>
  onAccountsChanged(callback: (accounts: AccountView[]) => void): () => void
  openExternal(url: string): Promise<void>
}
