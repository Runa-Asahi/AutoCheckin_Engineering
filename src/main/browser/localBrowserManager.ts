import { spawn } from 'node:child_process'
import { cp, mkdir, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { Adapter } from '../../shared/schemas.js'
import type { BrowserProgress, Task } from '../../shared/types.js'
import { sanitizeLog } from '../security/logSanitizer.js'
import { LocalBrowserScanner } from './localBrowserScanner.js'
import type { BrowserCookie, BrowserEngineOutput } from './browserEngine.js'

type ProfileMode = 'managed' | 'system'

interface LocalBrowserConfig extends Record<string, unknown> {
  profileMode?: ProfileMode
  browserId?: string
  channel?: 'chrome' | 'msedge'
  executablePath?: string
  userDataDir?: string
  customUserDataDir?: string
  profileName?: string
}

export class LocalBrowserManager {
  private readonly scanner = new LocalBrowserScanner()

  constructor(private readonly appUserDataDir: string, private readonly onProgress: (progress: BrowserProgress) => void) {}

  async executeWithLocalProfile(adapter: Adapter, task: Task, cookies: BrowserCookie[], variables: Record<string, string>, _executablePath?: string, customUserDataDir?: string): Promise<BrowserEngineOutput> {
    const target = await this.resolveTarget(task, customUserDataDir)
    const screenshotDir = join(this.appUserDataDir, 'screenshots', task.id)
    await mkdir(screenshotDir, { recursive: true })
    this.onProgress({ phase: 'executing', percent: 100, message: target.profileMode === 'managed' ? `正在使用 AutoCheckin 专用登录档案执行 ${task.site_name}` : `正在使用本地浏览器状态执行 ${task.site_name}` })

    const payload: RunnerPayload = {
      adapter,
      task: { id: task.id, siteName: task.site_name, loginType: task.login_type },
      cookies,
      variables,
      executablePath: target.executablePath,
      channel: target.channel,
      profileName: target.profileName,
      screenshotDir,
      persistentUserDataDir: target.userDataDir,
      timeoutMs: 120_000,
    }

    try {
      return await runRunner(payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (target.profileMode === 'system' && isProfileLockError(message)) {
        this.onProgress({ phase: 'executing', percent: 100, message: '日常浏览器正在运行，正在使用登录状态快照执行' })
        const snapshotDir = await this.createProfileSnapshot(target.userDataDir, target.profileName, task.id)
        return runRunner({ ...payload, persistentUserDataDir: snapshotDir })
      }
      if (target.profileMode === 'managed' && isProfileLockError(message)) {
        throw new Error('AutoCheckin 登录窗口仍在打开。请先在该窗口完成登录和首次签到，然后关闭整个浏览器窗口，再点击“立即执行”。')
      }
      throw error
    }
  }

  /**
   * Opens a task-owned persistent Chrome profile. The profile is never copied from
   * or shared with the user's everyday Chrome profile, so Google sign-in data and
   * site storage survive subsequent background runs without profile lock races.
   * Closing the browser is the explicit completion signal; anonymous cookies must
   * never be treated as proof that authentication succeeded.
   */
  async promptManualLogin(adapter: Adapter, task: Task): Promise<BrowserCookie[]> {
    const target = await this.resolveTarget(task)
    let context: import('playwright').BrowserContext | undefined
    let latestCookies: BrowserCookie[] = []

    try {
      process.env.PLAYWRIGHT_BROWSERS_PATH = join(this.appUserDataDir, 'browsers')
      const { chromium } = await import('playwright')
      context = await chromium.launchPersistentContext(target.userDataDir, {
        channel: target.channel,
        executablePath: target.executablePath,
        headless: false,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
          `--profile-directory=${target.profileName}`,
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
        ],
      })

      const existingPages = context.pages()
      const page = existingPages.find((item) => item.url() !== 'about:blank') ?? existingPages[0] ?? await context.newPage()
      await gotoWithRetry(page, adapter.site_url)
      if (page.url() === 'about:blank') throw new Error(`登录页面导航失败：${adapter.site_url}`)
      await Promise.all(context.pages().filter((item) => item !== page && item.url() === 'about:blank').map((item) => item.close().catch(() => undefined)))

      const domains = adapter.cookie_domains.length ? adapter.cookie_domains : [new URL(adapter.site_url).hostname]
      let browserClosed = false
      context.once('close', () => { browserClosed = true })
      const deadline = Date.now() + 15 * 60_000
      while (Date.now() < deadline) {
        if (browserClosed || !context || context.pages().length === 0) break
        try { latestCookies = (await context.cookies()).filter((cookie) => cookieMatches(cookie.domain, domains)) }
        catch (error) { if (browserClosed || /closed|Target page|browser has been closed/i.test(String(error))) break; throw error }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 750))
      }

      // The persistent profile itself is the source of truth. Cookies are also
      // returned for HTTP/hybrid fallback and encrypted database storage.
      return latestCookies
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isProfileLockError(message)) {
        if (target.profileMode === 'managed') throw new Error('此任务的 AutoCheckin 登录窗口已经打开。请切换到该窗口继续操作，完成签到后关闭整个浏览器窗口。')
        throw new Error('日常浏览器 Profile 正在使用中。建议改用“AutoCheckin 专用登录档案”；如需继续复用日常 Profile，请先完全关闭对应浏览器。')
      }
      if (isNavigationNetworkError(message)) throw new Error(`无法打开登录页面：${adapter.site_url}\n目标站点主动关闭了网络连接。请检查 VPN/代理（该站点可能需要“魔法”）、DNS 或稍后重试。原始错误：${message}`)
      throw error
    } finally {
      await context?.close().catch(() => undefined)
    }
  }

  private async resolveTarget(task: Task, customUserDataDir?: string): Promise<{ profileMode: ProfileMode; userDataDir: string; profileName: string; executablePath: string; channel: 'chrome' | 'msedge' }> {
    const config = parseConfig(task.config_json)
    const local = (isRecord(config.local_browser_config) ? config.local_browser_config : config) as LocalBrowserConfig
    // Existing tasks did not have profileMode. Default them to the reliable,
    // task-owned profile so they are repaired without requiring task recreation.
    const profileMode: ProfileMode = local.profileMode === 'system' ? 'system' : 'managed'
    const detected = await this.scanner.detectBrowsers()
    const selected = detected.find((browser) => browser.id === local.browserId) ?? detected.find((browser) => browser.channel === local.channel) ?? detected[0]
    const channel: 'chrome' | 'msedge' = local.channel === 'msedge' ? 'msedge' : selected?.channel ?? 'chrome'
    const executablePath = String(local.executablePath ?? selected?.executablePath ?? '')
    if (!executablePath) throw new Error('未找到原生 Chrome/Edge 可执行文件。请先安装 Chrome 或 Edge，然后在任务中重新选择浏览器。')

    if (profileMode === 'managed') {
      const userDataDir = resolve(this.appUserDataDir, 'managed-browser-profiles', task.id)
      const managedRoot = resolve(this.appUserDataDir, 'managed-browser-profiles')
      if (!userDataDir.startsWith(`${managedRoot}${sep}`)) throw new Error('AutoCheckin 专用浏览器档案路径无效。')
      await mkdir(userDataDir, { recursive: true })
      return { profileMode, userDataDir, profileName: 'Default', executablePath, channel }
    }

    const rawUserDataDir = String(customUserDataDir ?? local.userDataDir ?? local.customUserDataDir ?? selected?.userDataDir ?? '')
    const normalized = normalizeProfilePath(rawUserDataDir, String(local.profileName ?? 'Default'), selected?.profiles)
    if (!normalized.userDataDir) throw new Error('未检测到 Chrome/Edge 用户数据目录，请重新选择本地浏览器 Profile。')
    return { profileMode, userDataDir: normalized.userDataDir, profileName: normalized.profileName, executablePath, channel }
  }

  private async createProfileSnapshot(userDataDir: string, profileName: string, taskId: string): Promise<string> {
    const snapshotsRoot = resolve(this.appUserDataDir, 'local-browser-snapshots')
    const snapshotDir = resolve(snapshotsRoot, taskId)
    if (!snapshotDir.startsWith(`${snapshotsRoot}${sep}`)) throw new Error('本地浏览器快照路径无效。')
    await rm(snapshotDir, { recursive: true, force: true })
    await mkdir(join(snapshotDir, profileName), { recursive: true })
    const copy = async (relative: string): Promise<void> => {
      try { await cp(join(userDataDir, relative), join(snapshotDir, relative), { recursive: true, force: true }) } catch { /* optional or temporarily locked state */ }
    }
    await copy('Local State')
    for (const item of ['Network', 'Local Storage', 'Session Storage', 'IndexedDB', 'Preferences', 'Secure Preferences', 'Cookies', 'Web Data']) await copy(join(profileName, item))
    return snapshotDir
  }
}

async function gotoWithRetry(page: import('playwright').Page, url: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: attempt === 1 ? 'domcontentloaded' : 'commit', timeout: 45_000 })
      return
    } catch (error) {
      lastError = error
      if (!isNavigationNetworkError(String(error)) || attempt === 3) break
      await page.waitForTimeout(1200 * attempt)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

interface RunnerPayload {
  adapter: Adapter
  task: { id: string; siteName: string; loginType: string }
  cookies: BrowserCookie[]
  variables: Record<string, string>
  executablePath: string
  channel: 'chrome' | 'msedge'
  profileName: string
  screenshotDir: string
  persistentUserDataDir: string
  timeoutMs: number
}

function runRunner(payload: RunnerPayload): Promise<BrowserEngineOutput> {
  const runnerPath = join(import.meta.dirname, 'browser', 'runner.js')
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [runnerPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', settled = false
    const timer = setTimeout(() => { child.kill(); if (!settled) { settled = true; reject(new Error('本地浏览器任务执行超时（120 秒）。')) } }, payload.timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.once('error', (error) => { clearTimeout(timer); if (!settled) { settled = true; reject(error) } })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (code !== 0) reject(new Error(`本地浏览器执行失败：${sanitizeLog(stderr || stdout)}`))
      else {
        try { resolvePromise(JSON.parse(stdout.trim()) as BrowserEngineOutput) }
        catch { reject(new Error(`本地浏览器返回结果无效：${sanitizeLog(stdout || stderr)}`)) }
      }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

function parseConfig(raw: string): Record<string, unknown> {
  try { const value = JSON.parse(raw || '{}'); return value && typeof value === 'object' ? value as Record<string, unknown> : {} } catch { return {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isProfileLockError(message: string): boolean {
  return /EBUSY|lock|profile|user data|in use|singleton|ProcessSingleton/i.test(message)
}

function isNavigationNetworkError(message: string): boolean {
  return /ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ERR_CONNECTION_REFUSED|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|net::ERR_|timeout.*navigation|Navigation timeout/i.test(message)
}

function cookieMatches(cookieDomain: string, expectedDomains: string[]): boolean {
  const normalized = cookieDomain.replace(/^\./, '').toLowerCase()
  return expectedDomains.some((domain) => {
    const expected = domain.replace(/^\./, '').toLowerCase()
    return normalized === expected || normalized.endsWith(`.${expected}`) || expected.endsWith(`.${normalized}`)
  })
}

export function normalizeProfilePath(path: string, configuredProfile = 'Default', availableProfiles: string[] = []): { userDataDir: string; profileName: string } {
  const trimmed = path.trim()
  const name = basename(trimmed)
  const match = name.match(/^Profile\s*(\d+)$/i)
  if (name.toLowerCase() === 'default') return { userDataDir: dirname(trimmed), profileName: 'Default' }
  if (match) return { userDataDir: dirname(trimmed), profileName: `Profile ${match[1]}` }
  const profileName = availableProfiles.includes(configuredProfile) ? configuredProfile : ((availableProfiles[0] ?? configuredProfile) || 'Default')
  return { userDataDir: trimmed, profileName }
}
