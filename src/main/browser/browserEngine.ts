import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Adapter } from '../../shared/schemas.js'
import type { BrowserProgress, Task } from '../../shared/types.js'
import { PlaywrightBrowserManager } from './browserManager.js'
import { sanitizeLog } from '../security/logSanitizer.js'
import { LocalBrowserManager } from './localBrowserManager.js'

export interface BrowserCookie { name: string; value: string; domain: string; path: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Strict' | 'Lax' | 'None' }
export interface BrowserEngineOutput { success: boolean; message: string; responseSummary: string; screenshotPath: string | null; cookies: BrowserCookie[] }
export interface IBrowserEngine {
  execute(adapter: Adapter, task: Task, cookies: BrowserCookie[], variables: Record<string, string>): Promise<BrowserEngineOutput>
  promptManualLogin(siteUrl: string, expectedCookieDomains: string[]): Promise<BrowserCookie[]>
}

export class BrowserEngine implements IBrowserEngine {
  private readonly manager: PlaywrightBrowserManager
  private readonly localBrowserManager: LocalBrowserManager
  constructor(private readonly userDataDir: string, private readonly onProgress: (progress: BrowserProgress) => void) {
    this.manager = new PlaywrightBrowserManager(onProgress)
    this.localBrowserManager = new LocalBrowserManager(userDataDir, onProgress)
  }

  async execute(adapter: Adapter, task: Task, cookies: BrowserCookie[], variables: Record<string, string>): Promise<BrowserEngineOutput> {
    if (task.login_type === 'local_browser') return this.localBrowserManager.executeWithLocalProfile(adapter, task, cookies, variables)
    const executablePath = await this.manager.ensureBrowser()
    this.onProgress({ phase: 'executing', percent: 100, message: `正在执行 ${task.site_name} 浏览器任务` })
    const screenshotDir = join(this.userDataDir, 'screenshots', task.id)
    await mkdir(screenshotDir, { recursive: true })
    const runnerPath = join(import.meta.dirname, 'browser', 'runner.js')
    const payload = { adapter, task: { id: task.id, siteName: task.site_name, loginType: task.login_type }, cookies, variables, executablePath, screenshotDir, timeoutMs: 120_000 }
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [runnerPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = '', stderr = '', settled = false
      const timer = setTimeout(() => { child.kill(); reject(new Error('浏览器任务执行超时（120 秒）')) }, 120_000)
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      child.once('error', (error) => { clearTimeout(timer); if (!settled) { settled = true; reject(error) } })
      child.once('exit', (code) => {
        clearTimeout(timer); if (settled) return; settled = true
        if (code !== 0) { reject(new Error(`浏览器执行进程失败：${sanitizeLog(stderr || stdout)}`)); return }
        try { resolve(JSON.parse(stdout.trim()) as BrowserEngineOutput) } catch { reject(new Error(`浏览器执行结果无效：${sanitizeLog(stdout || stderr)}`)) }
      })
      child.stdin.end(JSON.stringify(payload))
    })
  }

  async promptManualLogin(siteUrl: string, expectedCookieDomains: string[]): Promise<BrowserCookie[]> {
    const executablePath = await this.manager.ensureBrowser()
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({ executablePath, headless: false, args: ['--disable-blink-features=AutomationControlled'] })
    try {
      const context = await browser.newContext()
      await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }))
      const page = await context.newPage()
      await gotoWithRetry(page, siteUrl)
      const deadline = Date.now() + 5 * 60_000
      while (Date.now() < deadline) {
        await page.waitForTimeout(1000)
        const cookies = await context.cookies()
        const matching = cookies.filter((cookie) => cookieMatches(cookie.domain, expectedCookieDomains))
        if (matching.length) { await page.waitForTimeout(1200); return (await context.cookies()).filter((cookie) => cookieMatches(cookie.domain, expectedCookieDomains)) }
        if (page.isClosed()) throw new Error('已取消手动登录。')
      }
      throw new Error('手动登录等待超时（5 分钟），请重新触发后再试。')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isNavigationNetworkError(message)) throw new Error(`无法打开登录页面：${siteUrl}\n目标站点主动关闭了网络连接。请检查 VPN/代理、DNS 或稍后重试。原始错误：${message}`)
      throw error
    } finally { await browser.close() }
  }

  async promptManualLoginForTask(adapter: Adapter, task: Task): Promise<BrowserCookie[]> {
    if (task.login_type === 'local_browser') return this.localBrowserManager.promptManualLogin(adapter, task)
    return this.promptManualLogin(adapter.site_url, adapter.cookie_domains.length ? adapter.cookie_domains : [new URL(adapter.site_url).hostname])
  }
}

async function gotoWithRetry(page: import('playwright').Page, url: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await page.goto(url, { waitUntil: attempt === 1 ? 'domcontentloaded' : 'commit', timeout: 45_000 }); return }
    catch (error) { lastError = error; if (!isNavigationNetworkError(String(error)) || attempt === 3) break; await page.waitForTimeout(1200 * attempt) }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function isNavigationNetworkError(message: string): boolean {
  return /ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ERR_CONNECTION_REFUSED|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|net::ERR_|timeout.*navigation|Navigation timeout/i.test(message)
}

function cookieMatches(cookieDomain: string, expectedDomains: string[]): boolean {
  const normalized = cookieDomain.replace(/^\./, '').toLowerCase()
  return expectedDomains.some((domain) => { const expected = domain.replace(/^\./, '').toLowerCase(); return normalized === expected || normalized.endsWith(`.${expected}`) || expected.endsWith(`.${normalized}`) })
}
