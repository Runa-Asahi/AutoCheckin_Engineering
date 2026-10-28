import { HttpSession, LoginExpiredError } from './http.js'
import { getPlatform } from './platforms/index.js'
import type { RunRecord, TaskResult } from '../../shared/types.js'
import type { Store } from './store.js'

export interface RunnerDeps { store: Store; now?: () => Date; sleep?: (ms: number) => Promise<void>; timezone?: string }

export function localDate(date: Date, timezone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
export function localTime(date: Date, timezone?: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

/** 执行一个账号的全部已勾选任务，保存结果和刷新后的 Cookie。永不抛出。 */
export async function runAccount(id: string, trigger: RunRecord['trigger'], deps: RunnerDeps): Promise<RunRecord> {
  const now = deps.now ?? (() => new Date()), sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const account = deps.store.account(id), platform = getPlatform(account.platform)
  const selected = platform.tasks.filter((task) => account.tasks[task.id] ?? task.defaultOn).map((task) => task.id)
  const session = new HttpSession(deps.store.cookies(account), { sleep })
  const today = localDate(now(), deps.timezone)
  const previous = account.history[0]
  const attempt = previous && previous.date === today ? previous.attempt + 1 : 1
  let results: TaskResult[]
  if (!selected.length) results = []
  else {
    try {
      results = await platform.run(selected, { session, now, sleep })
      deps.store.patch(id, { loginExpired: false })
    } catch (error) {
      const expired = error instanceof LoginExpiredError
      if (expired) deps.store.patch(id, { loginExpired: true })
      results = platform.tasks.filter((task) => selected.includes(task.id)).map((task) => ({ taskId: task.id, label: task.label, status: expired ? 'login_expired' : 'failed', message: (error as Error).message }))
    }
  }
  deps.store.updateCookies(id, session.cookies)
  const record: RunRecord = { at: now().toISOString(), date: today, trigger, results, attempt }
  deps.store.addRun(id, record)
  return record
}

export function needsRetry(record: RunRecord | undefined): boolean {
  return Boolean(record?.results.some((item) => item.status === 'failed'))
}

/**
 * 调度判断（纯函数，便于测试）：到了设定时间、今天还没跑过 → 运行；
 * 今天跑过但有失败（非登录过期），间隔 30 分钟最多再试 2 次。
 */
export function isDue(account: { enabled: boolean; time: string; loginExpired: boolean; history: RunRecord[] }, now: Date, timezone?: string): boolean {
  if (!account.enabled || account.loginExpired) return false
  if (localTime(now, timezone) < account.time) return false
  const today = localDate(now, timezone)
  const todays = account.history.filter((run) => run.date === today)
  if (!todays.length) return true
  const latest = todays[0]
  if (!needsRetry(latest) || latest.attempt >= 3) return false
  return now.getTime() - new Date(latest.at).getTime() >= 30 * 60_000
}
