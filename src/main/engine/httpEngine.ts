import axios from 'axios'
import type { Adapter } from '../../shared/schemas.js'
import { parseResult } from './resultParser.js'
import { renderTemplate } from './variableTemplate.js'
import { sanitizeLog } from '../security/logSanitizer.js'

export interface HttpEngineInput { adapter: Adapter; variables: Record<string, string>; cookieHeader: string }
export interface HttpEngineOutput { success: boolean; message: string; requestSummary: string; responseSummary: string; setCookies: string[] }
type RequestDef = NonNullable<Adapter['request']>

/** 把 Cookie 请求头展开为 cookie.<name> 模板变量，便于在请求体里引用 CSRF（如 {{cookie.bili_jct}}）。 */
export function cookieVariables(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=')
    if (index > 0) result[`cookie.${part.slice(0, index).trim()}`] = part.slice(index + 1).trim()
  }
  return result
}

function readPath(body: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cursor, key) => cursor && typeof cursor === 'object' ? (cursor as Record<string, unknown>)[key] : undefined, body)
}

export class HttpEngine {
  async execute({ adapter, variables, cookieHeader }: HttpEngineInput): Promise<HttpEngineOutput> {
    if (!adapter.request) throw new Error('This adapter does not define an HTTP request')
    const vars = { ...cookieVariables(cookieHeader), ...variables }
    const setCookies: string[] = []
    for (const [index, pre] of (adapter.pre_requests ?? []).entries()) {
      const response = await this.send(renderTemplate(pre, vars) as RequestDef, cookieHeader)
      setCookies.push(...extractSetCookies(response.headers))
      if (response.status >= 400) throw new Error(`前置请求 #${index + 1} 失败（HTTP ${response.status}）`)
      for (const [name, path] of Object.entries(pre.extract ?? {})) {
        const value = readPath(typeof response.data === 'string' ? safeJson(response.data) : response.data, path)
        vars[name] = value === undefined || value === null ? '' : String(value)
      }
    }
    const request = renderTemplate(adapter.request, vars) as RequestDef
    const response = await this.send(request, cookieHeader)
    const success = parseResult(adapter.success_rules, { status: response.status, body: response.data }, adapter.success_logic)
    return {
      success,
      message: success ? '签到成功或今日已完成' : `未匹配成功规则（HTTP ${response.status}）`,
      requestSummary: sanitizeLog({ method: request.method, url: request.url }),
      responseSummary: sanitizeLog({ status: response.status, body: response.data }),
      setCookies: [...setCookies, ...extractSetCookies(response.headers)],
    }
  }

  private send(request: RequestDef, cookieHeader: string) {
    let data = request.body
    const headers: Record<string, string> = { ...request.headers, ...(cookieHeader ? { Cookie: cookieHeader } : {}) }
    if (request.form && data && typeof data === 'object') {
      data = new URLSearchParams(Object.entries(data as Record<string, unknown>).map(([key, value]) => [key, String(value)])).toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    return axios.request({ method: request.method, url: request.url, headers, data, timeout: request.timeout_ms, maxRedirects: 5, validateStatus: () => true })
  }
}

function extractSetCookies(headers: Record<string, unknown>): string[] {
  const value = headers['set-cookie']
  return Array.isArray(value) ? value.map(String) : []
}
function safeJson(text: string): unknown { try { return JSON.parse(text) } catch { return undefined } }
