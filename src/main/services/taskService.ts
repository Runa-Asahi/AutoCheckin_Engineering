import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../database/index.js'
import type { CredentialEncryptor } from '../security/crypto.js'
import type { AdapterRegistry } from '../adapters/adapterRegistry.js'
import type { CreateTaskInput, TaskListQuery, UpdateTaskInput } from '../../shared/schemas.js'
import type { ExecutionLog, ExecutionResult, Task } from '../../shared/types.js'
import { HttpEngine } from '../engine/httpEngine.js'
import { sanitizeLog } from '../security/logSanitizer.js'
import { BrowserEngine, type BrowserCookie } from '../browser/browserEngine.js'
import type { BrowserProgress } from '../../shared/types.js'
import { buildVariables } from '../engine/variableTemplate.js'

export class TaskService {
  private readonly httpEngine = new HttpEngine()
  private readonly browserEngine: BrowserEngine
  constructor(private db: AppDatabase, private crypto: CredentialEncryptor, private adapters: AdapterRegistry, userDataDir: string, private readonly onBrowserProgress: (progress: BrowserProgress) => void = () => undefined) {
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
    return this.getTask(id)
  }

  list(query: TaskListQuery): Task[] {
    const where: string[] = [], params: unknown[] = []
    if (query.status !== 'all') { where.push(`last_status = ?`); params.push(query.status) }
    if (query.search) { where.push(`site_name LIKE ?`); params.push(`%${query.search}%`) }
    const orderColumn = ['last_run_at', 'consecutive_days', 'created_at'].includes(query.sortBy) ? query.sortBy : 'created_at'
    const direction = query.sortOrder === 'asc' ? 'ASC' : 'DESC'
    return this.db.sqlite.prepare(`SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${orderColumn} ${direction}`).all(...params) as Task[]
  }

  get(id: string): { task: Task; logs: ExecutionLog[] } {
    return { task: this.getTask(id), logs: this.db.sqlite.prepare('SELECT * FROM execution_logs WHERE task_id = ? ORDER BY executed_at DESC LIMIT 20').all(id) as ExecutionLog[] }
  }

  update(id: string, input: UpdateTaskInput): Task {
    const fieldMap: Record<string, string> = { siteId: 'site_id', siteName: 'site_name', engineType: 'engine_type', loginType: 'login_type', schedule: 'schedule', enabled: 'enabled', priority: 'priority', adapterId: 'adapter_id', accountLabel: 'account_label', config: 'config_json' }
    const entries = Object.entries(input).filter(([, value]) => value !== undefined)
    if (entries.length) {
      const sets = entries.map(([key]) => `${fieldMap[key]} = ?`)
      const values = entries.map(([key, value]) => key === 'enabled' ? (value ? 1 : 0) : key === 'config' ? JSON.stringify(value) : value)
      this.db.sqlite.prepare(`UPDATE tasks SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, new Date().toISOString(), id)
    }
    return this.getTask(id)
  }

  delete(id: string): void { this.getTask(id); this.db.sqlite.prepare('DELETE FROM tasks WHERE id = ?').run(id) }
  cleanupLogs(retentionDays: number): void { this.db.sqlite.prepare('DELETE FROM execution_logs WHERE executed_at < ?').run(new Date(Date.now() - Math.max(7, retentionDays) * 86_400_000).toISOString()) }

  async execute(id: string): Promise<ExecutionResult> {
    const task = this.getTask(id), adapter = this.adapters.get(task.adapter_id), runId = randomUUID(), started = Date.now()
    this.db.sqlite.prepare(`UPDATE tasks SET last_status='running' WHERE id=?`).run(id)
    let retryCount = 0
    try {
      const variables = buildVariables(this.loadCredentials(id))
      const config = JSON.parse(task.config_json || '{}') as { maxRetries?: number }
      const maxRetries = Math.max(0, Math.min(3, Number(config.maxRetries ?? 1)))
      let output: { success: boolean; message: string; requestSummary?: string; responseSummary: string; screenshotPath?: string | null; engineUsed: string; cookies?: BrowserCookie[] } | undefined
      let lastError: unknown
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        retryCount = attempt
        try { output = await this.executeWithEngine(task, adapter, variables); lastError = undefined; if (output.success || attempt === maxRetries) break }
        catch (error) { lastError = error; if (attempt === maxRetries) throw error }
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
      }
      if (!output) throw lastError ?? new Error('执行引擎没有返回结果')
      if (output.cookies?.length) this.replaceCookies(id, output.cookies)
      const status = output.success ? 'success' : 'failed', durationMs = Date.now() - started, now = new Date().toISOString()
      const nextDays = this.nextConsecutiveDays(task, status, now)
      this.db.sqlite.transaction(() => {
        this.db.sqlite.prepare(`INSERT INTO execution_logs (id,task_id,run_id,status,engine_used,duration_ms,request_summary,response_summary,error_message,screenshot_path,retry_count,executed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), id, runId, status, output.engineUsed, durationMs, output.requestSummary ?? null, output.responseSummary, output.success ? null : output.message, output.screenshotPath ?? null, retryCount, now)
        this.db.sqlite.prepare(`UPDATE tasks SET last_run_at=?, last_status=?, consecutive_days=?, updated_at=? WHERE id=?`).run(now, status, nextDays, now, id)
      })()
      this.onBrowserProgress({ phase: 'completed', percent: 100, message: output.message })
      return { success: output.success, status, message: output.message, durationMs, engineUsed: output.engineUsed }
    } catch (error) {
      const durationMs = Date.now() - started, now = new Date().toISOString(), message = error instanceof Error ? error.message : String(error)
      this.db.sqlite.transaction(() => {
        this.db.sqlite.prepare(`INSERT INTO execution_logs (id,task_id,run_id,status,engine_used,duration_ms,error_message,retry_count,executed_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), id, runId, 'failed', task.engine_type, durationMs, sanitizeLog(message), retryCount, now)
        this.db.sqlite.prepare(`UPDATE tasks SET last_run_at=?, last_status='failed', consecutive_days=0, updated_at=? WHERE id=?`).run(now, now, id)
      })()
      this.onBrowserProgress({ phase: 'failed', percent: 100, message })
      return { success: false, status: 'failed', message, durationMs, engineUsed: task.engine_type }
    }
  }

  async promptManualLogin(id: string): Promise<{ count: number }> {
    const task = this.getTask(id), adapter = this.adapters.get(task.adapter_id)
    const cookies = await this.browserEngine.promptManualLoginForTask(adapter, task)
    this.replaceCookies(id, cookies)
    return { count: cookies.length }
  }

  private async executeWithEngine(task: Task, adapter: ReturnType<AdapterRegistry['get']>, variables: Record<string, string>): Promise<{ success: boolean; message: string; requestSummary?: string; responseSummary: string; screenshotPath?: string | null; engineUsed: string; cookies?: BrowserCookie[] }> {
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
  private nextConsecutiveDays(task: Task, status: string, now: string): number {
    if (status !== 'success') return 0
    const previous = this.db.sqlite.prepare(`SELECT executed_at FROM execution_logs WHERE task_id=? AND status='success' ORDER BY executed_at DESC LIMIT 1`).get(task.id) as { executed_at: string } | undefined
    if (!previous) return 1
    const currentDate = now.slice(0, 10), previousDate = previous.executed_at.slice(0, 10)
    if (currentDate === previousDate) return task.consecutive_days
    const delta = Math.round((new Date(`${currentDate}T00:00:00Z`).getTime() - new Date(`${previousDate}T00:00:00Z`).getTime()) / 86_400_000)
    return delta === 1 ? task.consecutive_days + 1 : 1
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
