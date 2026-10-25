import type { HttpSession } from './http.js'
import type { PlatformTaskInfo, QrState, TaskResult } from '../../shared/types.js'

export interface QrTicket { key: string; content: string }
export interface QrResult { state: QrState; message: string }
export interface Profile { uid: string; nickname: string }

export interface TaskContext {
  session: HttpSession
  now: () => Date
  sleep: (ms: number) => Promise<void>
}

/**
 * 平台插件接口。新增平台只需要实现这个接口并在 platforms/index.ts 注册，
 * 用户界面会自动出现“扫码添加账号”与任务开关，无需任何用户配置。
 *
 * 约定：runTask 必须“执行后再查询确认”，只有平台状态接口确认完成才能返回 success/already。
 */
export interface Platform {
  id: string
  name: string
  loginHint: string
  tasks: PlatformTaskInfo[]
  qrStart(session: HttpSession): Promise<QrTicket>
  /** 成功时，session.cookies 中应已包含登录 Cookie。 */
  qrPoll(session: HttpSession, key: string): Promise<QrResult>
  /** 登录有效则返回用户资料，否则抛 LoginExpiredError。 */
  profile(session: HttpSession): Promise<Profile>
  /** 依次执行用户勾选的任务；实现内部可共享状态查询。 */
  run(taskIds: string[], ctx: TaskContext): Promise<TaskResult[]>
}

export function result(task: PlatformTaskInfo, status: TaskResult['status'], message: string): TaskResult {
  return { taskId: task.id, label: task.label, status, message }
}
