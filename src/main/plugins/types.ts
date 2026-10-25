import type { CheckinOutcome } from '../../shared/types.js'
import type { PluginHttpClient } from './httpClient.js'

/** 子任务结果：一个平台的一次签到可能包含多个子任务（如 B 站的观看、分享、投币）。 */
export interface SubtaskResult {
  name: string
  status: 'done' | 'already' | 'skipped' | 'failed'
  message: string
}

export interface PluginContext {
  /** 原始 Cookie 请求头（name=value; ...）。 */
  cookieHeader: string
  /** 解析后的 Cookie 键值。 */
  cookies: Record<string, string>
  /** 适配器 JSON 中的 plugin.options 与任务级 config.plugin_options 合并后的选项。 */
  options: Record<string, unknown>
  http: PluginHttpClient
  log: (message: string) => void
  now: () => Date
}

export interface PluginResult {
  success: boolean
  outcome: CheckinOutcome
  message: string
  subtasks: SubtaskResult[]
  /** 已脱敏的摘要数据，例如用户等级、积分。不得包含 Cookie。 */
  details?: Record<string, unknown>
}

export interface NativePlugin {
  id: string
  name: string
  /** 运行前必须存在的 Cookie 名称，缺失时直接报“需要重新登录”而不是发请求。 */
  requiredCookies: string[]
  run(ctx: PluginContext): Promise<PluginResult>
}

/** 带结果分类的错误。outcome 会直接交给调度器决定是否重试/通知。 */
export class CheckinError extends Error {
  constructor(message: string, readonly outcome: CheckinOutcome) { super(message); this.name = 'CheckinError' }
}

export function parseCookieHeader(header: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    result[part.slice(0, index).trim()] = part.slice(index + 1).trim()
  }
  return result
}

/** 把子任务列表汇总为一次签到结果：只要没有失败项即成功；有失败但也有完成项时记为部分成功（成功 + 提示）。 */
export function summarize(platform: string, subtasks: SubtaskResult[], details?: Record<string, unknown>): PluginResult {
  const failed = subtasks.filter((item) => item.status === 'failed')
  const completed = subtasks.filter((item) => item.status === 'done' || item.status === 'already')
  const lines = subtasks.map((item) => `${icon(item.status)} ${item.name}：${item.message}`)
  if (!failed.length) return { success: true, outcome: 'success', message: `${platform} 签到完成\n${lines.join('\n')}`, subtasks, details }
  if (completed.length) return { success: true, outcome: 'success', message: `${platform} 部分完成（${failed.length} 项失败）\n${lines.join('\n')}`, subtasks, details }
  return { success: false, outcome: 'retryable_error', message: `${platform} 所有子任务失败\n${lines.join('\n')}`, subtasks, details }
}

function icon(status: SubtaskResult['status']): string {
  return status === 'done' ? '✔' : status === 'already' ? '✔(已完成)' : status === 'skipped' ? '–' : '✘'
}
