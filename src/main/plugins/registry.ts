import { bilibiliPlugin } from './bilibili.js'
import { neteasePlugin } from './netease.js'
import { PluginHttpClient } from './httpClient.js'
import { CheckinError, parseCookieHeader, type NativePlugin, type PluginResult } from './types.js'

const plugins = new Map<string, NativePlugin>()
export function registerPlugin(plugin: NativePlugin): void { plugins.set(plugin.id, plugin) }
export function getPlugin(id: string): NativePlugin | undefined { return plugins.get(id) }
export function listPluginIds(): string[] { return [...plugins.keys()] }
registerPlugin(neteasePlugin)
registerPlugin(bilibiliPlugin)

export interface RunPluginInput {
  pluginId: string
  cookieHeader: string
  options?: Record<string, unknown>
  maxRetries?: number
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

/** 统一入口：校验 Cookie → 运行插件 → 把异常转换成带 outcome 的结果，不向外抛出。 */
export async function runPlugin(input: RunPluginInput): Promise<PluginResult & { logs: string[] }> {
  const logs: string[] = []
  const plugin = plugins.get(input.pluginId)
  if (!plugin) return { success: false, outcome: 'permanent_failure', message: `未知的原生插件：${input.pluginId}（可用：${listPluginIds().join(', ')}）`, subtasks: [], logs }
  const cookies = parseCookieHeader(input.cookieHeader)
  const missing = plugin.requiredCookies.filter((name) => !cookies[name])
  if (missing.length) return { success: false, outcome: 'authentication_required', message: `${plugin.name} 缺少必要 Cookie：${missing.join(', ')}。请重新登录并粘贴完整 Cookie（需要重新登录）`, subtasks: [], logs }
  const http = new PluginHttpClient({ cookieHeader: input.cookieHeader, maxRetries: input.maxRetries, sleep: input.sleep })
  try {
    const result = await plugin.run({ cookieHeader: input.cookieHeader, cookies, options: input.options ?? {}, http, log: (line) => logs.push(line), now: input.now ?? (() => new Date()) })
    return { ...result, logs }
  } catch (error) {
    if (error instanceof CheckinError) return { success: false, outcome: error.outcome, message: error.message, subtasks: [], logs }
    return { success: false, outcome: 'retryable_error', message: `插件运行异常：${(error as Error).message}`, subtasks: [], logs }
  }
}
