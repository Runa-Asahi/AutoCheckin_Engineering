import { listPluginIds } from '../plugins/registry.js'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { AdapterRegistry } from '../adapters/adapterRegistry.js'
import { PlaywrightBrowserManager } from '../browser/browserManager.js'
import { AdapterSchema, type AIProvider, type AIProviderConfig } from '../../shared/schemas.js'
import type { AIAnalysis, AIFailureDiagnosis, AIGeneration, BrowserProgress, ExecutionLog } from '../../shared/types.js'
import { UnifiedAIClient } from './client/unifiedAIClient.js'
import { normalizeGeneratedAdapter } from './adapterNormalizer.js'
import { inspectAdapter } from './adapterInspector.js'

export class AIGuideService {
  private readonly browserManager: PlaywrightBrowserManager
  private readonly client = new UnifiedAIClient()
  constructor(private readonly adapters: AdapterRegistry, onProgress: (progress: BrowserProgress) => void) { this.browserManager = new PlaywrightBrowserManager(onProgress) }

  async analyzeUrl(rawUrl: string): Promise<AIAnalysis> {
    const url = await assertPublicUrl(rawUrl), executablePath = await this.browserManager.ensureBrowser()
    process.env.PLAYWRIGHT_BROWSERS_PATH ||= ''
    const { chromium } = await import('playwright'), browser = await chromium.launch({ executablePath, headless: true })
    try {
      const context = await browser.newContext()
      await context.route('**/*', async (route) => { try { await assertPublicUrl(route.request().url()); await route.continue() } catch { await route.abort('blockedbyclient') } })
      const page = await context.newPage(); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await assertPublicUrl(page.url())
      const title = await page.title(), html = await page.content(), domSummary = sanitizeDom(html)
      return { url: page.url(), title, domSummary, estimatedInputTokens: Math.ceil(domSummary.length / 4) }
    } finally { await browser.close() }
  }

  async listModels(config: AIProviderConfig): Promise<string[]> { return this.client.listModels(config) }

  async generate(input: { url: string; domSummary: string } & AIProviderConfig): Promise<AIGeneration> {
    await assertPublicUrl(input.url)
    const prompt = buildPrompt(input.url, input.domSummary), raw = await this.client.generate(input, prompt)
    let adapter = parseAndNormalize(raw, input.url)
    let inspection = inspectAdapter(adapter), repairRaw = '', autoRepaired = false
    if (!inspection.valid) {
      repairRaw = await this.client.generate(input, buildRepairPrompt(input.url, adapter, inspection))
      adapter = parseAndNormalize(repairRaw, input.url)
      inspection = inspectAdapter(adapter)
      autoRepaired = true
    }
    const schema = AdapterSchema.safeParse(adapter)
    if (!schema.success) throw new Error(`模型生成的适配器仍有无法自动修复的字段：${formatAdapterIssues(schema.error.issues)}`)
    const inputTokens = Math.ceil(prompt.length / 4), outputTokens = Math.ceil((raw.length + repairRaw.length) / 4)
    return { adapter: schema.data, raw: repairRaw || raw, inspection, autoRepaired, estimatedCostUsd: estimateCost(input.provider, input.model, inputTokens, outputTokens), inputTokens, outputTokens, provider: input.provider, model: input.model }
  }
  inspectAdapter(raw: unknown) { return inspectAdapter(raw) }
  async diagnoseFailure(adapter: unknown, logs: ExecutionLog[], config: AIProviderConfig): Promise<AIFailureDiagnosis> {
    const prompt = buildFailurePrompt(adapter, logs)
    const raw = await this.client.generate(config, prompt)
    const parsed = parseDiagnosis(raw)
    const candidate = parseAndNormalize(JSON.stringify(parsed.adapter), String((adapter as { site_url?: string }).site_url ?? 'https://example.com/'))
    const inspection = inspectAdapter(candidate)
    return { ...parsed, adapter: candidate, inspection, provider: config.provider, model: config.model, autoRepaired: false }
  }
  async refineDiagnosis(adapter: unknown, inspection: ReturnType<typeof inspectAdapter>, config: AIProviderConfig): Promise<AIFailureDiagnosis> {
    const raw = await this.client.generate(config, buildRefinePrompt(adapter, inspection))
    const parsed = parseDiagnosis(raw)
    const candidate = parseAndNormalize(JSON.stringify(parsed.adapter), String((adapter as { site_url?: string }).site_url ?? 'https://example.com/'))
    const report = inspectAdapter(candidate)
    return { ...parsed, adapter: candidate, inspection: report, provider: config.provider, model: config.model, autoRepaired: true }
  }
  saveAdapter(raw: unknown) {
    const inspection = inspectAdapter(raw)
    if (!inspection.valid) throw new Error(`适配器自检未通过：${inspection.issues.filter((issue) => issue.severity === 'error').slice(0, 3).map((issue) => issue.message).join('；')}`)
    return this.adapters.saveCustom(AdapterSchema.parse(raw))
  }
}

export function sanitizeDom(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '')
    .replace(/\s(?:value|srcdoc|nonce|integrity|data-[\w-]+)=("[^"]*"|'[^']*')/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 100_000)
}

export function buildPrompt(url: string, dom: string): string {
  return `You generate a safe AutoCheckin v2.0 adapter JSON. Return one JSON object only, without Markdown. Never bypass CAPTCHA, anti-bot systems, payment, or account security. A CAPTCHA must lead to a user-visible manual verification notice, never an automated action. The adapter MUST perform a real check-in action; a workflow that only opens a page or logs "please sign manually" is invalid. Required fields: site_id, site_name, site_url, engine_type (http|browser|api|hybrid), login_type (password|cookie|manual|local_browser), optional request, optional steps, success_rules, cookie_domains. HTTP/API/hybrid requires request. Browser/hybrid requires steps. Browser step types: goto, click, fill, wait, wait_for, extract, log, screenshot, request, condition, retry, try_catch. Prefer stable href/action/API endpoints over visual class names. Prefer condition checks for already-signed-in state and try_catch around fragile clicks. Every success_rules item MUST contain both type and value. Its type MUST be exactly one of: status, body_includes, body_regex, json_path. Valid examples: {"type":"status","value":200}, {"type":"body_includes","value":"签到成功"}, {"type":"body_regex","value":"签到成功|已签到"}, {"type":"json_path","value":{"path":"data.success","equals":true}}. Do not invent rule or step types. Generality features you SHOULD use when helpful: (1) templates {{date}} {{timestamp}} {{random}} and {{cookie.NAME}} (value of a cookie, e.g. a CSRF token such as {{cookie.csrf_token}}); (2) request.form=true sends an object body as application/x-www-form-urlencoded; (3) pre_requests: up to 5 requests run before request, each may have extract: {"var_name":"json.path"} so later requests can use {{var_name}} (e.g. fetch a token, then sign); (4) failure_rules: [{"type":"body_regex","value":"未登录|login","outcome":"authentication_required"}] so cookie expiry is reported instead of retried, outcome one of not_ready, retryable_error, authentication_required, manual_action_required, permanent_failure; treat "already signed today" responses as success in success_rules; (5) cookie_hint: a short Chinese hint telling the user which cookie names are required; description: one-line Chinese summary. Built-in native plugins exist for ${listPluginIds().join(', ')}: if the URL belongs to one of those sites (music.163.com → netease_music, bilibili.com → bilibili), return {"engine_type":"native","login_type":"cookie","plugin":{"id":"<id>","options":{}},"success_rules":[]} plus site fields instead of writing requests. URL: ${url}\nSanitized DOM:\n${dom}`
}

function buildRepairPrompt(url: string, adapter: unknown, inspection: ReturnType<typeof inspectAdapter>): string {
  return `Repair this AutoCheckin v2.0 adapter. Return one complete JSON object only. This is a single bounded repair pass. Preserve the intended site and login mode. Do not bypass CAPTCHA, anti-bot, payment, or account security. The result must perform an actual check-in action and use only supported fields. URL: ${url}\nInspection issues:\n${inspection.issues.map((issue) => `[${issue.severity}] ${issue.path}: ${issue.message} Fix: ${issue.suggestion}`).join('\n')}\nCandidate adapter:\n${JSON.stringify(adapter)}`
}

function buildFailurePrompt(adapter: unknown, logs: ExecutionLog[]): string {
  return `Diagnose recent AutoCheckin failures and produce a repaired adapter candidate. If the adapter uses engine_type native (a built-in code plugin), do not rewrite it into requests: keep engine_type/plugin, only adjust plugin.options when evidence supports it, and explain in summary whether the user must refresh cookies or wait for a plugin update. Authentication failures (code -101, 301, 未登录, 登录失效) mean the user must update cookies: set category authentication and requiresManualAction true. Return JSON only with keys: summary, category, confidence, evidence, changes, requiresManualAction, adapter. confidence is 0..1; evidence and changes are short arrays. category must be one of network, authentication, selector, success_rule, site_change, risk_control, unknown. Use only sanitized evidence. Never request/expose credentials, Cookies, tokens or DOM secrets. Never bypass CAPTCHA, anti-bot or account security. For authentication/risk-control failures set requiresManualAction true. Preserve site_id. The candidate must perform a real check-in action and use supported types only. Current adapter:\n${JSON.stringify(redactAdapter(adapter))}\nFailure evidence:\n${JSON.stringify(logs.slice(0, 10).map(sanitizeLog))}`
}
function buildRefinePrompt(adapter: unknown, inspection: ReturnType<typeof inspectAdapter>): string {
  return `Refine this AutoCheckin adapter using the static self-check report. Return JSON only with keys: summary, category, confidence, evidence, changes, requiresManualAction, adapter. Make only evidence-based changes. Never add credential handling, CAPTCHA/anti-bot bypass, hidden automation, or unsafe URLs. If the report indicates security verification, set requiresManualAction true and retain a visible manual step. Candidate:\n${JSON.stringify(redactAdapter(adapter))}\nReport:\n${JSON.stringify(inspection)}`
}

function parseDiagnosis(raw: string): Pick<AIFailureDiagnosis, 'summary' | 'category' | 'confidence' | 'evidence' | 'changes' | 'requiresManualAction'> & { adapter: unknown } {
  let parsed: unknown
  try { parsed = JSON.parse(extractJson(raw)) } catch { throw new Error('AI 诊断结果不是有效 JSON。') }
  if (!parsed || typeof parsed !== 'object') throw new Error('AI 诊断结果格式无效。')
  const value = parsed as Record<string, unknown>
  const categories = new Set<AIFailureDiagnosis['category']>(['network', 'authentication', 'selector', 'success_rule', 'site_change', 'risk_control', 'unknown'])
  const category = categories.has(value.category as AIFailureDiagnosis['category']) ? value.category as AIFailureDiagnosis['category'] : 'unknown'
  if (!value.adapter) throw new Error('AI 诊断没有返回修复候选适配器。')
  return { summary: String(value.summary ?? 'AI 已生成修复候选，请审核自检报告。'), category, confidence: Math.min(1, Math.max(0, Number(value.confidence ?? 0.5) || 0.5)), evidence: asShortList(value.evidence), changes: asShortList(value.changes), requiresManualAction: value.requiresManualAction === true, adapter: value.adapter }
}

function asShortList(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 8).map((item) => item.slice(0, 300)) : [] }
function sanitizeLog(log: ExecutionLog): Record<string, unknown> { return { status: log.status, engine: log.engine_used, durationMs: log.duration_ms, error: redactText(log.error_message), response: redactText(log.response_summary), retryCount: log.retry_count, executedAt: log.executed_at } }
function redactAdapter(adapter: unknown): unknown { try { const copy = JSON.parse(JSON.stringify(adapter)) as Record<string, unknown>; delete copy.credentials; delete copy.cookies; delete copy.apiKey; return copy } catch { return {} } }
function redactText(value: string | null): string | null { return value ? value.replace(/(cookie|authorization|api[-_]?key|token|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]').slice(0, 2000) : null }

function parseAndNormalize(raw: string, fallbackUrl: string): unknown {
  try { return normalizeGeneratedAdapter(JSON.parse(extractJson(raw)), fallbackUrl) }
  catch { throw new Error('模型返回的内容不是有效 JSON，请再次生成，或更换更擅长结构化输出的模型。') }
}

function extractJson(raw: string): string { const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i); return (fenced?.[1] ?? raw).trim() }
function formatAdapterIssues(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues.slice(0, 4).map((issue) => `${issue.path.join('.') || '根节点'}：${issue.message}`).join('；')
}
function estimateCost(provider: AIProvider, model: string, input: number, output: number): number {
  const lower = model.toLowerCase(); let rates = provider === 'anthropic' ? [3, 15] : provider === 'deepseek' || lower.includes('deepseek') ? [0.3, 1.2] : [2.5, 10]
  if (lower.includes('mini') || lower.includes('flash') || lower.includes('haiku')) rates = [0.2, 0.8]
  return Number(((input * rates[0] + output * rates[1]) / 1_000_000).toFixed(6))
}

async function assertPublicUrl(raw: string): Promise<string> {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅允许公开的 HTTP/HTTPS URL')
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local')) throw new Error('禁止访问本机或局域网地址')
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('禁止访问本机或局域网地址')
  return url.toString()
}
function isPrivateAddress(ip: string): boolean {
  const value = ip.toLowerCase()
  if (value === '::1' || value === '0.0.0.0' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true
  const mapped = value.startsWith('::ffff:') ? value.slice(7) : value
  const parts = mapped.split('.').map(Number)
  return parts.length === 4 && (parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168))
}
