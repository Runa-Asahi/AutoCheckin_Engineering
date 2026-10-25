import type { Adapter } from '../../shared/schemas.js'
import type { CheckinOutcome } from '../../shared/types.js'
import { runPlugin } from '../plugins/registry.js'
import { sanitizeLog } from '../security/logSanitizer.js'

export interface NativeEngineOutput { success: boolean; message: string; requestSummary: string; responseSummary: string; outcome: CheckinOutcome }

/** 执行代码级平台插件（网易云、B 站等需要多步调用 / CSRF / 业务码判断的平台）。 */
export class NativeEngine {
  async execute(adapter: Adapter, cookieHeader: string, taskOptions: Record<string, unknown> = {}): Promise<NativeEngineOutput> {
    if (!adapter.plugin) throw new Error('该适配器未声明 plugin，无法使用 native 引擎')
    const result = await runPlugin({ pluginId: adapter.plugin.id, cookieHeader, options: { ...adapter.plugin.options, ...taskOptions } })
    return {
      success: result.success,
      outcome: result.outcome,
      message: result.message,
      requestSummary: sanitizeLog({ plugin: adapter.plugin.id }),
      responseSummary: sanitizeLog({ subtasks: result.subtasks, details: result.details, logs: result.logs }),
    }
  }
}
