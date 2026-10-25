import axios from 'axios'

export interface TransportRequest { method: 'GET' | 'POST'; url: string; params?: Record<string, string | number>; headers: Record<string, string>; data?: unknown; timeoutMs: number }
export interface TransportResponse { status: number; headers: Record<string, unknown>; data: unknown }
/** 实际发请求的底层实现。实现方必须在每次跳转前调用 isAllowedUrl 拦截白名单外地址。 */
export type Transport = (request: TransportRequest) => Promise<TransportResponse>

/** 桌面端（Node）：axios，跳转前检查白名单。 */
export const axiosTransport: Transport = async (request) => {
  const response = await axios.request({ method: request.method, url: request.url, params: request.params, data: request.data, headers: request.headers, timeout: request.timeoutMs, maxRedirects: 3, validateStatus: () => true,
    beforeRedirect: (redirect: { href?: string }) => { if (!isAllowedUrl(String(redirect.href ?? ''))) throw new NetworkError('已拦截跳转到白名单外的地址') } })
  return { status: response.status, headers: response.headers as Record<string, unknown>, data: response.data }
}

let transport: Transport = axiosTransport
/** 手机端启动时替换为原生 HTTP。 */
export function setTransport(next: Transport): void { transport = next }

export const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const RETRYABLE = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'EPIPE'])

/**
 * 网络白名单：只允许访问各平台官方域名（以及它们的子域名）。
 * 任何其它地址（含局域网、本机）都会被拒绝，防止数据被发往第三方。
 * AI 服务由用户在“高级设置”中显式填写，走独立客户端，不经过这里。
 */
export const ALLOWED_DOMAINS = ['music.163.com', 'bilibili.com', 'baidu.com', 'luogu.com.cn']

export function isAllowedUrl(raw: string): boolean {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return ALLOWED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/** 平台能识别并转换成“请重新扫码”的错误。 */
export class LoginExpiredError extends Error { constructor(message = '登录已过期，请重新扫码登录') { super(message); this.name = 'LoginExpiredError' } }
/** 网络或服务端暂时性错误。 */
export class NetworkError extends Error { constructor(message: string) { super(message); this.name = 'NetworkError' } }

export interface RequestOptions {
  method?: 'GET' | 'POST'
  url: string
  params?: Record<string, string | number>
  /** 对象会按表单编码；字符串原样发送。 */
  form?: Record<string, string | number | boolean>
  json?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
  /** 为 true 时使用 headers.Cookie 原样发送，不附加会话 Cookie（仍会吸收 Set-Cookie）。 */
  rawCookie?: boolean
}

/**
 * 带 Cookie 罐的 HTTP 会话：自动携带并更新 Cookie（扫码登录拿到的 Cookie 就是从这里收集的），
 * 网络错误 / 429 / 5xx 自动退避重试。
 */
export class HttpSession {
  readonly cookies: Record<string, string>
  constructor(cookies: Record<string, string> = {}, private readonly opts: { userAgent?: string; retries?: number; sleep?: (ms: number) => Promise<void> } = {}) {
    this.cookies = { ...cookies }
  }

  cookieHeader(): string { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') }

  async json<T>(options: RequestOptions): Promise<T> {
    const response = await this.request(options)
    let body: unknown = response.data
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch { throw new NetworkError(`服务器返回了无法识别的内容（HTTP ${response.status}）`) }
    }
    return body as T
  }

  async request(options: RequestOptions): Promise<TransportResponse> {
    if (!isAllowedUrl(options.url)) throw new NetworkError(`已拦截不在白名单内的网络请求：${safeHost(options.url)}`)
    const retries = this.opts.retries ?? 2, sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
    let lastError: Error = new NetworkError('网络请求失败')
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const headers: Record<string, string> = { 'User-Agent': this.opts.userAgent ?? DESKTOP_UA, Accept: 'application/json, text/plain, */*', ...options.headers }
        if (!options.rawCookie) { const cookie = this.cookieHeader(); if (cookie) headers.Cookie = cookie }
        let data: unknown
        if (options.form) { data = new URLSearchParams(Object.entries(options.form).map(([k, v]) => [k, String(v)])).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded' }
        else if (options.json !== undefined) { data = options.json; headers['Content-Type'] = 'application/json' }
        const response = await transport({ method: options.method ?? 'GET', url: options.url, params: options.params, data, headers, timeoutMs: options.timeoutMs ?? 15_000 })
        this.absorb(response.headers['set-cookie'])
        if (response.status === 429 || response.status >= 500) { lastError = new NetworkError(`服务器暂时不可用（HTTP ${response.status}）`) }
        else if (response.status === 412) throw new NetworkError('请求被平台风控拦截（HTTP 412），请稍后再试')
        else return response
      } catch (error) {
        if (error instanceof NetworkError && /412/.test(error.message)) throw error
        const code = (error as { code?: string }).code
        if (code && !RETRYABLE.has(code)) throw new NetworkError(`网络请求失败：${(error as Error).message}`)
        lastError = new NetworkError(`网络连接失败${code ? `（${code}）` : ''}，请检查网络`)
      }
      if (attempt < retries) await sleep(600 * 2 ** attempt)
    }
    throw lastError
  }

  private absorb(raw: unknown): void {
    // 原生 HTTP 可能把多条 Set-Cookie 用逗号合并；按“逗号后紧跟 name=”拆分（Expires 中的逗号后面不是 name=）
    const lines = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/,(?=\s*[A-Za-z0-9_.-]+=)/) : []
    for (const line of lines) {
      const first = line.split(';')[0], index = first.indexOf('=')
      if (index <= 0) continue
      const name = first.slice(0, index).trim(), value = first.slice(index + 1).trim()
      const expired = /max-age=0|expires=thu, 01 jan 1970/i.test(line)
      if (expired || value === '' || value === 'deleted') delete this.cookies[name]
      else this.cookies[name] = value
    }
  }
}

function safeHost(raw: string): string { try { return new URL(raw).host } catch { return '无效地址' } }
