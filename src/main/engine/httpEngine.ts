import axios from 'axios'
import type { Adapter } from '../../shared/schemas.js'
import { parseResult } from './resultParser.js'
import { renderTemplate } from './variableTemplate.js'
import { sanitizeLog } from '../security/logSanitizer.js'

export interface HttpEngineInput { adapter: Adapter; variables: Record<string, string>; cookieHeader: string }
export interface HttpEngineOutput { success: boolean; message: string; requestSummary: string; responseSummary: string; setCookies: string[] }

export class HttpEngine {
  async execute({ adapter, variables, cookieHeader }: HttpEngineInput): Promise<HttpEngineOutput> {
    if (!adapter.request) throw new Error('This adapter does not define an HTTP request')
    const request = renderTemplate(adapter.request, variables) as Adapter['request']
    if (!request) throw new Error('Invalid request definition')
    const response = await axios.request({
      method: request.method, url: request.url, headers: { ...request.headers, ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
      data: request.body, timeout: request.timeout_ms, maxRedirects: 5, validateStatus: () => true,
    })
    const success = parseResult(adapter.success_rules, { status: response.status, body: response.data }, adapter.success_logic)
    return {
      success,
      message: success ? '签到成功或今日已完成' : `未匹配成功规则（HTTP ${response.status}）`,
      requestSummary: sanitizeLog({ method: request.method, url: request.url }),
      responseSummary: sanitizeLog({ status: response.status, body: response.data }),
      setCookies: Array.isArray(response.headers['set-cookie']) ? response.headers['set-cookie'] : [],
    }
  }
}
