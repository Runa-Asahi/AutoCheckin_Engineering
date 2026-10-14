import { chromium, type BrowserContext, type Page } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { explainBrowserFailure, pageLooksLikeLogin } from '../../shared/browserFailure.js'
import { signAllTiebaForums } from './tiebaBatchSign.js'

interface RunnerInput {
  adapter: { site_url: string; steps?: Step[]; success_rules: Array<{ type: string; value: unknown }> }
  task: { id: string; siteName: string; loginType: string }
  cookies: Array<{ name: string; value: string; domain: string; path: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Strict'|'Lax'|'None' }>
  variables: Record<string, string>
  executablePath?: string
  channel?: 'chrome' | 'msedge'
  profileName?: string
  screenshotDir: string
  timeoutMs: number
  persistentUserDataDir?: string
}
type Step = Record<string, unknown> & { type?: string }

async function readInput(): Promise<RunnerInput> {
  let body = ''
  for await (const chunk of process.stdin) body += chunk.toString()
  return JSON.parse(body) as RunnerInput
}

function template<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => vars[key] ?? '') as T
  if (Array.isArray(value)) return value.map((item) => template(item, vars)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, template(item, vars)])) as T
  return value
}

async function randomMouse(page: Page, selector: string): Promise<void> {
  const box = await firstVisibleLocator(page, selector).boundingBox()
  if (!box) return
  await page.mouse.move(box.x + Math.random() * box.width, box.y + Math.random() * box.height, { steps: 5 + Math.floor(Math.random() * 8) })
}

function firstVisibleLocator(page: Page, selector: string): ReturnType<Page['locator']> {
  return page.locator(selector).filter({ visible: true }).first()
}

async function checkCondition(page: Page, check: Record<string, unknown>, vars: Record<string, string>): Promise<boolean> {
  const selector = check.selector_exists ?? check.selector ?? check.element
  if (selector) {
    const locator = page.locator(String(selector))
    if (check.text !== undefined) return (await locator.first().innerText().catch(() => '')).includes(String(template(check.text, vars)))
    return await locator.count() > 0
  }
  if (check.login_page === true) return pageLooksLikeLogin(page.url(), await page.locator('body').innerText().catch(() => ''))
  if (check.selector_text) return (await page.locator('body').innerText()).includes(String(template(check.selector_text, vars)))
  if (check.var) return String(vars[String(check.var)] ?? '') === String(template(check.equals ?? '', vars))
  return false
}

async function executeSteps(page: Page, context: BrowserContext, steps: Step[], vars: Record<string, string>, screenshotDir: string): Promise<string[]> {
  const logs: string[] = []
  for (const raw of steps) {
    const step = template(raw, vars), type = String(step.type ?? '')
    if (type === 'goto') await page.goto(String(step.url), { waitUntil: 'domcontentloaded', timeout: Number(step.timeout_ms ?? 30_000) })
    else if (type === 'click') {
      const selector = String(step.selector), locator = firstVisibleLocator(page, selector)
      try { await locator.waitFor({ state: 'visible', timeout: Number(step.timeout_ms ?? 15_000) }) }
      catch (error) { if (step.allow_missing === true) { logs.push(`跳过已不存在的控件：${selector}`); continue }; throw error }
      await randomMouse(page, selector)
      await locator.click({ timeout: Number(step.timeout_ms ?? 15_000) })
    }
    else if (type === 'fill') await page.locator(String(step.selector)).fill(String(step.value ?? ''))
    else if (type === 'wait') await page.waitForTimeout(Number(step.ms ?? step.milliseconds ?? 1000))
    else if (type === 'wait_for') await page.locator(String(step.selector)).waitFor({ state: (step.state as 'attached'|'detached'|'visible'|'hidden') ?? 'visible', timeout: Number(step.timeout_ms ?? step.timeout ?? 15_000) })
    else if (type === 'wait_for_text') {
      await page.waitForFunction((source) => new RegExp(source, 'i').test(document.body?.innerText ?? ''), String(step.value ?? step.text ?? ''), { timeout: Number(step.timeout_ms ?? step.timeout ?? 15_000) })
    }
    else if (type === 'extract') vars[String(step.name)] = await page.locator(String(step.selector)).first().innerText()
    else if (type === 'request') {
      const method = String(step.method ?? 'GET').toUpperCase()
      const requestUrl = String(template(step.url, vars))
      const response = method === 'POST' ? await context.request.post(requestUrl, { headers: step.headers as Record<string, string> | undefined, data: step.body }) : await context.request.get(requestUrl, { headers: step.headers as Record<string, string> | undefined })
      const responseText = await response.text()
      vars.__last_response_status = String(response.status())
      vars.__last_response_body = responseText
      logs.push(`${method} ${requestUrl} -> ${response.status()}`)
    }
    else if (type === 'tieba_batch_sign') {
      const result = await signAllTiebaForums(page, context.request)
      vars.__last_response_status = result.code === 401 ? '401' : '200'
      vars.__last_response_body = JSON.stringify(result)
      vars.__result_message = result.code === 0
        ? `贴吧批量签到完成：新签到 ${result.signed} 个，今日已签到 ${result.already} 个，跳过不可签到 ${result.skipped} 个，共 ${result.total} 个吧。`
        : `贴吧批量签到未完全完成：已处理 ${result.signed + result.already + result.skipped}/${result.total}，失败 ${result.failed}。${result.failures[0]?.reason ?? ''}`
      logs.push(vars.__result_message)
    }
    else if (type === 'log') { const message = String(step.message ?? ''); logs.push(message); if (step.result === true) vars.__result_message = message }
    else if (type === 'screenshot') { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, `${String(step.name ?? 'step')}-${Date.now()}.png`), fullPage: true }) }
    else if (type === 'condition') {
      const ok = await checkCondition(page, (step.check ?? step.if ?? {}) as Record<string, unknown>, vars)
      logs.push(...await executeSteps(page, context, (ok ? step.then : step.else ?? []) as Step[], vars, screenshotDir))
    } else if (type === 'retry') {
      let lastError: unknown
      for (let attempt = 1; attempt <= Number(step.max_attempts ?? 3); attempt++) {
        try { logs.push(...await executeSteps(page, context, (step.steps ?? []) as Step[], vars, screenshotDir)); lastError = undefined; break }
        catch (error) { lastError = error; if (attempt < Number(step.max_attempts ?? 3)) await page.waitForTimeout(Number(step.interval_ms ?? 1000)) }
      }
      if (lastError) throw lastError
    } else if (type === 'try_catch') {
      try { logs.push(...await executeSteps(page, context, (step.try ?? []) as Step[], vars, screenshotDir)) }
      catch (error) { vars.last_error = error instanceof Error ? error.message : String(error); logs.push(...await executeSteps(page, context, (step.catch ?? []) as Step[], vars, screenshotDir)) }
    } else throw new Error(`不支持的浏览器步骤类型：${type}`)
  }
  return logs
}

async function main(): Promise<void> {
  const input = await readInput(), started = Date.now()
  const launchOptions = { ...(input.channel ? { channel: input.channel, executablePath: input.executablePath } : { executablePath: input.executablePath }), headless: true, ignoreDefaultArgs: ['--enable-automation'], args: [ ...(input.profileName ? [`--profile-directory=${input.profileName}`] : []), '--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'] }
  const persistentContext = input.persistentUserDataDir ? await chromium.launchPersistentContext(input.persistentUserDataDir, launchOptions) : undefined
  const browser = persistentContext ? undefined : await chromium.launch(launchOptions)
  let screenshotPath: string | null = null
  let page: Page | undefined
  try {
    const context = persistentContext ?? await browser!.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132 Safari/537.36' })
    await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }))
    if (input.cookies.length && !persistentContext) await context.addCookies(input.cookies)
    page = context.pages()[0] ?? await context.newPage(); page.setDefaultTimeout(15_000)
    let lastResponseStatus = 200
    page.on('response', (response) => { if (response.url().startsWith('http')) lastResponseStatus = response.status() })
    const vars: Record<string, string> = { ...input.variables, today: new Date().toISOString().slice(0, 10), timestamp: String(Date.now()) }
    const logs = await executeSteps(page, context, input.adapter.steps ?? [{ type: 'goto', url: input.adapter.site_url }], vars, input.screenshotDir)
    const pageBody = await page.locator('body').innerText().catch(() => '')
    const body = vars.__last_response_body ?? pageBody
    const effectiveStatus = Number(vars.__last_response_status ?? lastResponseStatus)
    const ruleResults = input.adapter.success_rules.map((rule) => evaluateBrowserRule(rule, body, effectiveStatus))
    const success = (input.adapter as { success_logic?: string }).success_logic === 'and' ? ruleResults.every(Boolean) : ruleResults.some(Boolean)
    const cookies = await context.cookies()
    const loginLike = /login|signin|auth|account\/choose|challenge/i.test(page.url()) || /请先登录|登录后|未登录|需要登录|sign in|log in|unauthorized/i.test(`${pageBody}\n${body}`)
    const message = vars.__result_message ?? (success ? '浏览器签到成功或今日已完成' : loginLike ? '登录状态已失效或当前页面仍要求登录，请重新点击“引导登录并完成首次签到”。' : '页面未匹配成功规则，请检查适配器步骤或成功提示文字。')
    process.stdout.write(JSON.stringify({ success, message, responseSummary: JSON.stringify({ url: page.url(), title: await page.title(), status: effectiveStatus, ruleResults, bodyPreview: body.slice(0, 500), logs, durationMs: Date.now() - started }), screenshotPath, cookies }))
  } catch (error) {
    await mkdir(input.screenshotDir, { recursive: true }); screenshotPath = join(input.screenshotDir, `error-${Date.now()}.png`); if (page) await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
    const url = page ? page.url() : ''
    const body = page ? await page.locator('body').innerText().catch(() => '') : ''
    const message = explainBrowserFailure(error instanceof Error ? error.message : String(error), url, body)
    process.stdout.write(JSON.stringify({ success: false, message, responseSummary: JSON.stringify({ url, bodyPreview: body.slice(0, 500) }), screenshotPath, cookies: [] }))
  } finally { if (persistentContext) await persistentContext.close(); else await browser?.close() }
}

function evaluateBrowserRule(rule: { type: string; value: unknown }, body: string, status: number): boolean {
  if (rule.type === 'status') return status === Number(rule.value)
  if (rule.type === 'body_includes') return body.includes(String(rule.value))
  if (rule.type === 'body_regex') {
    try { return new RegExp(String(rule.value), 'i').test(body) } catch { return false }
  }
  if (rule.type === 'json_path') {
    const spec = rule.value && typeof rule.value === 'object' ? rule.value as { path?: string; equals?: unknown } : {}
    try {
      const parsed = JSON.parse(body) as unknown
      const actual = String(spec.path ?? '').split('.').filter(Boolean).reduce<unknown>((cursor, key) => cursor && typeof cursor === 'object' ? (cursor as Record<string, unknown>)[key] : undefined, parsed)
      return actual === spec.equals
    } catch { return false }
  }
  return false
}

void main().catch((error) => { process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1 })
