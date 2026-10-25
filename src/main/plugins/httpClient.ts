import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { CheckinError } from './types.js'

export interface PluginRequest {
  method?: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
  /** 普通对象 + form=true 时按 application/x-www-form-urlencoded 发送。 */
  data?: unknown
  form?: boolean
  params?: Record<string, string | number>
  timeoutMs?: number
}

export interface HttpClientOptions {
  cookieHeader: string
  userAgent?: string
  defaultHeaders?: Record<string, string>
  maxRetries?: number
  baseDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'EPIPE'])

/** 插件专用 HTTP 客户端：自动带 Cookie/UA，网络错误、429、5xx 指数退避重试。 */
export class PluginHttpClient {
  private readonly maxRetries: number
  private readonly baseDelayMs: number
  private readonly sleep: (ms: number) => Promise<void>
  constructor(private readonly options: HttpClientOptions) {
    this.maxRetries = Math.max(0, Math.min(5, options.maxRetries ?? 2))
    this.baseDelayMs = options.baseDelayMs ?? 800
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async json<T = Record<string, unknown>>(request: PluginRequest): Promise<T> {
    const response = await this.send(request)
    let body: unknown = response.data
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch { throw new CheckinError(`接口返回了非 JSON 内容（HTTP ${response.status}），站点可能改版或触发风控`, 'permanent_failure') }
    }
    return body as T
  }

  async send(request: PluginRequest): Promise<AxiosResponse> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await axios.request(this.toConfig(request))
        if (response.status === 401 || (response.status === 403 && /login|登录/i.test(String(response.data)))) throw new CheckinError(`HTTP ${response.status}：登录失效，请更新 Cookie`, 'authentication_required')
        if (response.status === 412) throw new CheckinError('HTTP 412：请求被站点风控拦截，请稍后再试或在浏览器中手动访问一次', 'manual_action_required')
        if (response.status === 429 || response.status >= 500) { lastError = new CheckinError(`HTTP ${response.status}：服务暂时不可用`, 'retryable_error') }
        else return response
      } catch (error) {
        if (error instanceof CheckinError) throw error
        const code = (error as { code?: string }).code
        if (!code || !RETRYABLE_CODES.has(code)) throw new CheckinError(`网络请求失败：${(error as Error).message}`, 'retryable_error')
        lastError = new CheckinError(`网络请求失败（${code}）`, 'retryable_error')
      }
      if (attempt < this.maxRetries) await this.sleep(this.baseDelayMs * 2 ** attempt)
    }
    throw lastError instanceof Error ? lastError : new CheckinError('网络请求失败', 'retryable_error')
  }

  private toConfig(request: PluginRequest): AxiosRequestConfig {
    const headers: Record<string, string> = { 'User-Agent': this.options.userAgent ?? DEFAULT_UA, Accept: 'application/json, text/plain, */*', ...this.options.defaultHeaders, ...request.headers }
    if (this.options.cookieHeader) headers.Cookie = this.options.cookieHeader
    let data = request.data
    if (request.form && data && typeof data === 'object') {
      data = new URLSearchParams(Object.entries(data as Record<string, unknown>).map(([key, value]) => [key, String(value)])).toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    return { method: request.method ?? 'GET', url: request.url, params: request.params, headers, data, timeout: request.timeoutMs ?? 20_000, maxRedirects: 3, validateStatus: () => true }
  }
}
