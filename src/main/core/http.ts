import axios, { type AxiosResponse } from 'axios'

export const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const RETRYABLE = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'EPIPE'])

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

  async request(options: RequestOptions): Promise<AxiosResponse> {
    const retries = this.opts.retries ?? 2, sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
    let lastError: Error = new NetworkError('网络请求失败')
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const headers: Record<string, string> = { 'User-Agent': this.opts.userAgent ?? DESKTOP_UA, Accept: 'application/json, text/plain, */*', ...options.headers }
        if (!options.rawCookie) { const cookie = this.cookieHeader(); if (cookie) headers.Cookie = cookie }
        let data: unknown
        if (options.form) { data = new URLSearchParams(Object.entries(options.form).map(([k, v]) => [k, String(v)])).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded' }
        else if (options.json !== undefined) { data = options.json; headers['Content-Type'] = 'application/json' }
        const response = await axios.request({ method: options.method ?? 'GET', url: options.url, params: options.params, data, headers, timeout: options.timeoutMs ?? 15_000, maxRedirects: 3, validateStatus: () => true })
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
    if (!Array.isArray(raw)) return
    for (const line of raw as string[]) {
      const first = line.split(';')[0], index = first.indexOf('=')
      if (index <= 0) continue
      const name = first.slice(0, index).trim(), value = first.slice(index + 1).trim()
      const expired = /max-age=0|expires=thu, 01 jan 1970/i.test(line)
      if (expired || value === '' || value === 'deleted') delete this.cookies[name]
      else this.cookies[name] = value
    }
  }
}
