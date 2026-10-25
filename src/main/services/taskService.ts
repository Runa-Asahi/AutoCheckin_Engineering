import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../database/index.js'
import type { CredentialEncryptor } from '../security/crypto.js'
import type { AdapterRegistry } from '../adapters/adapterRegistry.js'
import type { CreateTaskInput, TaskListQuery, UpdateTaskInput } from '../../shared/schemas.js'
import type { BrowserProgress, ExecutionLog, ExecutionResult, ScheduleSnapshot, Task } from '../../shared/types.js'
import { computeConsecutiveDays } from '../../shared/localTime.js'
import { HttpEngine } from '../engine/httpEngine.js'
import { NativeEngine } from '../engine/nativeEngine.js'
import type { CheckinOutcome } from '../../shared/types.js'
import { sanitizeLog } from '../security/logSanitizer.js'
import { BrowserEngine, type BrowserCookie } from '../browser/browserEngine.js'
import { buildVariables } from '../engine/variableTemplate.js'
import { classifyOutcome } from './outcomeClassifier.js'
import type { ExecuteOptions } from './taskScheduler.js'
import type { SuccessEvidence } from './schedulePolicy.js'

export class TaskService {
  private readonly httpEngine = new HttpEngine()
  private readonly nativeEngine = new NativeEngine()
  private readonly browserEngine: BrowserEngine
  private readonly inflight = new Map<string, Promise<ExecutionResult>>()
  constructor(private db: AppDatabase, private crypto: CredentialEncryptor, private adapters: AdapterRegistry, userDataDir: string, private readonly onBrowserProgress: (progress: BrowserProgress) => void = () => undefined, private readonly getTimezone: () => string = () => 'Asia/Shanghai', private readonly now: () => Date = () => new Date()) {
    this.browserEngine = new BrowserEngine(userDataDir, onBrowserProgress)
  }

  create(input: CreateTaskInput): Task {
    const id = randomUUID(), now = new Date().toISOString()
    this.db.sqlite.transaction(() => {
      this.db.sqlite.prepare(`INSERT INTO tasks (id,site_id,site_name,engine_type,login_type,schedule,enabled,priority,config_json,adapter_id,account_label,created_at,updated_at,last_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`).run(
        id, input.siteId, input.siteName, input.engineType, input.loginType, input.schedule, input.enabled ? 1 : 0, input.priority, JSON.stringify(input.config), input.adapterId, input.accountLabel ?? null, now, now,
      )
      for (const [key, value] of Object.entries(input.credentials ?? {})) this.saveCredential(id, 'password', key, value, now)
      for (const cookie of parseCookies(input.cookies ?? '', this.adapters.get(input.adapterId).cookie_domains[0] ?? input.siteId)) this.saveCookie(id, cookie, now)
    })()
    return this.hydrate(this.getTask(id))
  }

  list(query: TaskListQuery): Task[] {
    const where: string[] = [], params: unknown[] = []
    if (query.status !== 'all') { where.push(`last_status = ?`); params.push(query.status) }
    if (query.search) { where.push(`site_name LIKE ?`); params.push(`%${query.search}%`) }
    const orderColumn = ['last_run_at', 'consecutive_days', 'created_at'].includes(query.sortBy) ? query.sortBy : 'created_at'
    const direction = query.sortOrder === 'asc' ? 'ASC' : 'DESC'
    return (this.db.sqlite.prepare(`SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${orderColumn} ${direction}`).all(...params) as Task[]).map((task) => this.hydrate(task))
  }

  get(id: string): { task: Task; logs: ExecutionLog[] } {
    return { task: this.hydrate(this.getTask(id)), logs: this.db.sqlite.prepare('SELECT * FROM execution_logs WHERE task_id = ? ORDER BY executed_at DESC LIMIT 20').all(id) as ExecutionLog[] }
  }

  update(id: string, input: UpdateTaskInput): Task {
    const fieldMap: Record<string, string> = { siteId: 'site_id', siteName: 'site_name', engineType: 'engine_type', loginType: 'login_type', schedule: 'schedule', enabled: 'enabled', priority: 'priority', adapterId: 'adapter_id', accountLabel: 'account_label', config: 'config_json' }
    const entries = Object.entries(input).filter(([, value]) => value !== undefined)
    if (entries.length) {
      const sets = entries.map(([key]) => `${fieldMap[key]} = ?`)
      const values = entries.map(([key, value]) => key === 'enabled' ? (value ? 1 : 0) : key === 'config' ? JSON.stringify(value) : value)
      this.db.sqlite.prepare(`UPDATE tasks SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, new Date().toISOString(), id)
    }
    return this.hydrate(this.getTask(id))
  }

  delete(id: string): void { this.getTask(id); this.db.sqlite.prepare('DELETE FROM tasks WHERE id = ?').run(id) }
  cleanupLogs(retentionDays: number): void { this.db.sqlite.prepare('DELETE FROM execution_logs WHERE executed_at < ?').run(new Date(Date.now() - Math.max(7, retentionDays) * 86_400_000).toISOString()) }

  async execute(id: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    const existing = this.inflight.get(id)
    if (existing) {
      if (options.skipIfBusy) return { success: false, status: 'pending', message: '任务正在执行，已跳过重复触发', durationMs: 0, engineUsed: 'scheduler', outcome: 'skipped' }
      return existing
    }
    const run = this.executeExclusive(id, options).finally(() => { if (this.inflight.get(id) === run) this.inflight.delete(id) })
    this.inflight.set(id, run)
    return run
  }

  recentSuccesses(id: string, sinceIso: string): SuccessEvidence[] {
    return this.db.sqlite.prepare(`SELECT executed_at, cycle_key FROM execution_logs WHERE task_id=? AND status='success' AND executed_at>=? ORDER BY executed_at DESC`).all(id, sinceIso) as SuccessEvidence[]
  }

  markFinalFailure(id: string): void {
    const now = this.now().toISOString()
    this.db.sqlite.prepare(`UPDATE tasks SET last_status='failed', consecutive_days=0, updated_at=? WHERE id=?`).run(now, id)
  }

  markPending(id: string): void {
    this.db.sqlite.prepare(`UPDATE tasks SET last_status='pending', updated_at=? WHERE id=?`).run(this.now().toISOString(), id)
  }

  recordSkip(id: string, reason: string, cycleKey: string | null): void {
    const now = this.now().toISOString()
    this.db.sqlite.prepare(`INSERT INTO execution_logs (id,task_id,run_id,status,engine_used,duration_ms,error_message,retry_count,executed_at,cycle_key) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), id, randomUUID(), 'pending', 'scheduler', 0, reason, 0, now, cycleKey)
  }

  private async executeExclusive(id: string, options: ExecuteOptions): Promise<ExecutionResult> {
    const task = this.getTask(id), adapter = this.adapters.get(task.adapter_id), runId = randomUUID(), started = Date.now()
    this.db.sqlite.prepare(`UPDATE tasks SET last_status='running' WHERE id=?`).run(id)
    let retryCount = 0
    try {
      const variables = buildVariables(this.loadCredentials(id))
      const config = JSON.parse(task.config_json || '{}') as { maxRetries?: number }
      const maxRetries = Math.max(0, Math.min(3, Number(config.maxRetries ?? 0)))
      let output: { success: boolean; message: string; requestSummary?: string; responseSummary: string; screenshotPath?: string | null; engineUsed: string; cookies?: BrowserCookie[]; outcome?: CheckinOutcome } | undefined
      let lastError: unknown
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        retryCount = attempt
        try {
          output = await this.executeWithEngine(task, adapter, variables)
          lastError = undefined
          const outcome = classifyOutcome({ success: output.success, outcome: output.outcome, message: output.message, responseSummary: output.responseSummary, failureRules: adapter.failure_rules })
          if (outcome === 'success' || outcome === 'authentication_required' || outcome === 'manual_action_required' || outcome === 'permanent_failure' || attempt === maxRetries) break
        } catch (error) {
          lastError = error
          const message = error instanceof Error ? error.message : String(error)
          const outcome = classifyOutcome({ success: false, message })
          if (outcome === 'authentication_required' || outcome === 'manual_action_required' || outcome === 'permanent_failure' || attempt === maxRetries) throw error
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
      }
      if (!output) throw lastError ?? new Error('执行引擎没有返回结果')
      if (output.cookies?.length) this.replaceCookies(id, output.cookies)
      const outcome = classifyOutcome({ success: output.success, outcome: output.outcome, message: output.message, responseSummary: output.responseSummary, failureRules: adapter.failure_rules })
      const success = outcome === 'success'
      const status = success ? 'success' : 'failed'
      const durationMs = Date.now() - started
      const now = this.now().toISOString()
      const taskStatus = success ? 'success' : 'pending'
      const nextDays = success ? this.nextConsecutiveDays(task, now) : task.consecutive_days
      this.db.sqlite.transaction(() => {
        this.db.sqlite.prepare(`INSERT INTO execution_logs (id,task_id,run_id,status,engine_used,duration_ms,request_summary,response_summary,error_message,screenshot_path,retry_count,executed_at,cycle_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), id, runId, status, output.engineUsed, durationMs, output.requestSummary ?? null, output.responseSummary, success ? null : output.message, output.screenshotPath ?? null, retryCount, now, options.cycleKey ?? null)
        this.db.sqlite.prepare(`UPDATE tasks SET last_run_at=?, last_status=?, consecutive_days=?, updated_at=? WHERE id=?`).run(now, taskStatus, nextDays, now, id)
      })()
      this.onBrowserProgress({ phase: success ? 'completed' : 'failed', percent: 100, message: output.message, taskId: id, outcome })
      return { success, status: taskStatus, message: output.message, durationMs, engineUsed: output.engineUsed, outcome, responseSummary: output.responseSummary }
    } catch (error) {
      const durationMs = Date.now() - started, now = this.now().toISOString(), message = error instanceof Error ? error.message : String(error)
      const outcome = classifyOutcome({ success: false, message, failureRules: adapter.failure_rules })
      this.db.sqlite.transaction(() => {
        this.db.sqlite.prepare(`INSERT INTO execution_logs (id,task_id,run_id,status,engine_used,duration_ms,error_message,retry_count,executed_at,cycle_key) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), id, runId, 'failed', task.engine_type, durationMs, sanitizeLog(message), retryCount, now, options.cycleKey ?? null)
        this.db.sqlite.prepare(`UPDATE tasks SET last_run_at=?, last_status='pending', updated_at=? WHERE id=?`).run(now, now, id)
      })()
      this.onBrowserProgress({ phase: 'failed', percent: 100, message, taskId: id, outcome })
      return { success: false, status: 'pending', message, durationMs, engineUsed: task.engine_type, outcome }
    }
  }

  async promptManualLogin(id: string): Promise<{ count: number }> {
    const task = this.getTask(id), adapter = this.adapters.get(task.adapter_id)
    const cookies = await this.browserEngine.promptManualLoginForTask(adapter, task)
    this.replaceCookies(id, cookies)
    return { count: cookies.length }
  }

  private async executeWithEngine(task: Task, adapter: ReturnType<AdapterRegistry['get']>, variables: Record<string, string>): Promise<{ success: boolean; message: string; requestSummary?: string; responseSummary: string; screenshotPath?: string | null; engineUsed: string; cookies?: BrowserCookie[]; outcome?: CheckinOutcome }> {
    if (task.engine_type === 'native' || adapter.engine_type === 'native') {
      const config = JSON.parse(task.config_json || '{}') as { plugin_options?: Record<string, unknown> }
      const output = await this.nativeEngine.execute(adapter, this.loadCookies(task.id), config.plugin_options ?? {})
      return { ...output, engineUsed: 'native' }
    }
    if (task.engine_type === 'http' || task.engine_type === 'api') {
      const output = await this.httpEngine.execute({ adapter, variables, cookieHeader: this.loadCookies(task.id) })
      return { ...output, engineUsed: task.engine_type, cookies: parseSetCookies(output.setCookies, adapter.cookie_domains[0] ?? new URL(adapter.site_url).hostname) }
    }
    if (task.engine_type === 'browser') {
      if (adapter.site_id === 'luogu' && adapter.request) {
        try {
          const http = await this.httpEngine.execute({ adapter, variables, cookieHeader: this.loadCookies(task.id) })
          if (http.success) return { ...http, engineUsed: 'http', cookies: parseSetCookies(http.setCookies, 'luogu.com.cn') }
        } catch { /* 受站点风控影响时回退到浏览器流程 */ }
      }
      const output = await this.browserEngine.execute(adapter, task, this.loadBrowserCookies(task.id), variables)
      return { ...output, engineUsed: 'browser' }
    }
    if (task.engine_type === 'hybrid') {
      if (adapter.request) {
        try {
          const http = await this.httpEngine.execute({ adapter, variables, cookieHeader: this.loadCookies(task.id) })
          if (http.success) return { ...http, engineUsed: 'http', cookies: parseSetCookies(http.setCookies, adapter.cookie_domains[0] ?? new URL(adapter.site_url).hostname) }
        } catch { /* 按文档回退到浏览器 */ }
      }
      const browser = await this.browserEngine.execute(adapter, task, this.loadBrowserCookies(task.id), variables)
      return { ...browser, engineUsed: 'browser' }
    }
    throw new Error(`不支持的执行引擎：${task.engine_type}`)
  }

  private getTask(id: string): Task {
    const task = this.db.sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined
    if (!task) throw new Error('任务不存在')
    return task
  }
  private saveCredential(taskId: string, type: string, key: string, value: string, now: string): void {
    const encrypted = this.crypto.encrypt(value)
    this.db.sqlite.prepare('INSERT INTO credentials (id,task_id,cred_type,cred_key,cred_value_enc,cred_iv,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), taskId, type, key, encrypted.ciphertext, encrypted.iv, now, now)
  }
  private saveCookie(taskId: string, cookie: ParsedCookie, now: string): void {
    const encrypted = this.crypto.encrypt(cookie.value)
    this.db.sqlite.prepare('INSERT INTO site_cookies (id,task_id,domain,path,name,value_enc,value_iv,expires_at,secure,httponly,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), taskId, cookie.domain, cookie.path, cookie.name, encrypted.ciphertext, encrypted.iv, cookie.expiresAt, cookie.secure ? 1 : 0, cookie.httpOnly ? 1 : 0, now)
  }
  private loadCredentials(taskId: string): Record<string, string> {
    const rows = this.db.sqlite.prepare('SELECT cred_key,cred_value_enc,cred_iv FROM credentials WHERE task_id=?').all(taskId) as Array<{ cred_key: string; cred_value_enc: Buffer; cred_iv: Buffer }>
    return Object.fromEntries(rows.map((row) => [row.cred_key, this.crypto.decrypt(row.cred_value_enc, row.cred_iv)]))
  }
  private loadCookies(taskId: string): string {
    const rows = this.db.sqlite.prepare('SELECT name,value_enc,value_iv FROM site_cookies WHERE task_id=? AND (expires_at IS NULL OR expires_at > ?)').all(taskId, new Date().toISOString()) as Array<{ name: string; value_enc: Buffer; value_iv: Buffer }>
    return rows.map((row) => `${row.name}=${this.crypto.decrypt(row.value_enc, row.value_iv)}`).join('; ')
  }
  private loadBrowserCookies(taskId: string): BrowserCookie[] {
    const rows = this.db.sqlite.prepare('SELECT name,domain,path,value_enc,value_iv,expires_at,secure,httponly FROM site_cookies WHERE task_id=? AND (expires_at IS NULL OR expires_at > ?)').all(taskId, new Date().toISOString()) as Array<{ name: string; domain: string; path: string; value_enc: Buffer; value_iv: Buffer; expires_at: string | null; secure: number; httponly: number }>
    return rows.map((row) => ({ name: row.name, value: this.crypto.decrypt(row.value_enc, row.value_iv), domain: row.domain, path: row.path || '/', expires: row.expires_at ? Math.floor(new Date(row.expires_at).getTime() / 1000) : undefined, secure: Boolean(row.secure), httpOnly: Boolean(row.httponly), sameSite: 'Lax' }))
  }
  private replaceCookies(taskId: string, cookies: BrowserCookie[]): void {
    const now = new Date().toISOString()
    this.db.sqlite.transaction(() => {
      this.db.sqlite.prepare('DELETE FROM site_cookies WHERE task_id=?').run(taskId)
      for (const cookie of cookies) this.saveCookie(taskId, { name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path, expiresAt: cookie.expires && cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : null, secure: Boolean(cookie.secure), httpOnly: Boolean(cookie.httpOnly) }, now)
    })()
  }
  private nextConsecutiveDays(task: Task, now: string): number {
    const previous = this.db.sqlite.prepare(`SELECT executed_at FROM execution_logs WHERE task_id=? AND status='success' ORDER BY executed_at DESC LIMIT 1`).get(task.id) as { executed_at: string } | undefined
    return computeConsecutiveDays(previous?.executed_at ?? null, new Date(now), this.safeTimezone(), task.consecutive_days)
  }

  private hydrate(task: Task): Task {
    const row = this.db.sqlite.prepare('SELECT * FROM schedule_states WHERE task_id=?').get(task.id) as { status: ScheduleSnapshot['status']; message: string | null; next_retry_at: string | null; scheduled_at: string | null; attempt_count: number; outcome: string | null; succeeded: number; local_date: string | null; timezone: string | null } | undefined
    if (!row) return task
    return { ...task, schedule_state: { status: row.status, message: row.message, next_retry_at: row.next_retry_at, scheduled_at: row.scheduled_at, attempt_count: Number(row.attempt_count) || 0, outcome: row.outcome, succeeded: Number(row.succeeded) === 1, local_date: row.local_date, timezone: row.timezone } }
  }

  private safeTimezone(): string {
    const value = this.getTimezone()
    try { Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date()); return value } catch { return 'Asia/Shanghai' }
  }
}

function parseSetCookies(headers: string[], defaultDomain: string): BrowserCookie[] {
  return headers.map((header) => {
    const parts = header.split(';').map((part) => part.trim()), separator = parts[0].indexOf('=')
    const cookie: BrowserCookie = { name: parts[0].slice(0, separator), value: parts[0].slice(separator + 1), domain: defaultDomain, path: '/' }
    for (const attribute of parts.slice(1)) {
      const [rawKey, ...rawValue] = attribute.split('='), key = rawKey.toLowerCase(), value = rawValue.join('=')
      if (key === 'domain') cookie.domain = value
      else if (key === 'path') cookie.path = value
      else if (key === 'expires') cookie.expires = Math.floor(new Date(value).getTime() / 1000)
      else if (key === 'max-age') cookie.expires = Math.floor(Date.now() / 1000) + Number(value)
      else if (key === 'secure') cookie.secure = true
      else if (key === 'httponly') cookie.httpOnly = true
      else if (key === 'samesite' && ['strict','lax','none'].includes(value.toLowerCase())) cookie.sameSite = `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}` as BrowserCookie['sameSite']
    }
    return cookie
  }).filter((cookie) => cookie.name)
}

interface ParsedCookie { name: string; value: string; domain: string; path: string; expiresAt: string | null; secure: boolean; httpOnly: boolean }
function parseCookies(raw: string, defaultDomain: string): ParsedCookie[] {
  if (!raw.trim()) return []
  try {
    const json = JSON.parse(raw) as Array<Record<string, unknown>>
    if (Array.isArray(json)) return json.filter((item) => item.name && item.value !== undefined).map((item) => ({ name: String(item.name), value: String(item.value), domain: String(item.domain ?? defaultDomain), path: String(item.path ?? '/'), expiresAt: item.expirationDate ? new Date(Number(item.expirationDate) * 1000).toISOString() : null, secure: Boolean(item.secure), httpOnly: Boolean(item.httpOnly) }))
  } catch { /* cookie header format */ }
  return raw.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const split = part.indexOf('='); return { name: part.slice(0, split).trim(), value: part.slice(split + 1).trim(), domain: defaultDomain, path: '/', expiresAt: null, secure: true, httpOnly: true }
  }).filter((cookie) => cookie.name && cookie.value)
}
