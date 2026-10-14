import cron from 'node-cron'
import { endOfLocalDay, localDateKey } from '../../shared/localTime.js'
import type { CheckinOutcome } from './outcomeClassifier.js'

export const DEFAULT_RETRY_DELAYS_MS = [5, 10, 20, 30].map((minutes) => minutes * 60_000)
export const DEFAULT_MAX_ATTEMPTS = 5
export const LEASE_MS = 10 * 60_000
const LOOKBACK_MS = 48 * 3_600_000
const LOOKAHEAD_MS = 400 * 24 * 3_600_000

export interface CronProbe {
  matches(date: Date): boolean
  previousAtOrBefore(now: Date): Date | null
  nextAfter(date: Date): Date | null
  close(): void
}

const probes = new Map<string, CronProbe>()

export function getCronProbe(expression: string, timeZone: string): CronProbe {
  const key = `${timeZone}\n${expression}`
  const cached = probes.get(key)
  if (cached) return cached
  if (!cron.validate(expression)) throw new Error(`无效的 Cron 表达式：${expression}`)
  const task = cron.createTask(expression, () => undefined, { timezone: timeZone })
  const fields = cron.parse(expression)
  const stepMs = fields.second.length === 1 && fields.second[0] === 0 ? 60_000 : 1_000
  const probe: CronProbe = {
    matches: (date) => task.match(date),
    previousAtOrBefore(now) {
      let cursor = Math.floor(now.getTime() / stepMs) * stepMs
      if (cursor > now.getTime()) cursor -= stepMs
      const limit = now.getTime() - LOOKBACK_MS
      for (; cursor >= limit; cursor -= stepMs) {
        const candidate = new Date(cursor)
        if (task.match(candidate)) return candidate
      }
      return null
    },
    nextAfter(date) {
      let cursor = Math.floor(date.getTime() / stepMs) * stepMs + stepMs
      const limit = date.getTime() + LOOKAHEAD_MS
      for (; cursor <= limit; cursor += stepMs) {
        const candidate = new Date(cursor)
        if (task.match(candidate)) return candidate
      }
      return null
    },
    close() { void task.destroy(); probes.delete(key) },
  }
  probes.set(key, probe)
  return probe
}

export function closeAllCronProbes(): void {
  for (const probe of probes.values()) probe.close()
}

export interface CycleWindow {
  scheduledAt: Date
  windowEnd: Date
  cycleKey: string
  localDate: string
  oncePerDay: boolean
}

export function describeCycle(timeZone: string, now: Date, probe: CronProbe): CycleWindow | null {
  const scheduledAt = probe.previousAtOrBefore(now)
  if (!scheduledAt || scheduledAt.getTime() > now.getTime()) return null
  const next = probe.nextAfter(scheduledAt)
  const dayEnd = endOfLocalDay(scheduledAt, timeZone)
  const windowEndMs = Math.min(dayEnd.getTime(), next?.getTime() ?? dayEnd.getTime())
  if (now.getTime() >= windowEndMs) return null
  const localDate = localDateKey(scheduledAt, timeZone)
  const previous = probe.previousAtOrBefore(new Date(scheduledAt.getTime() - 1))
  const nextIsAnotherDay = !next || localDateKey(next, timeZone) !== localDate
  const previousIsAnotherDay = !previous || localDateKey(previous, timeZone) !== localDate
  return {
    scheduledAt, windowEnd: new Date(windowEndMs), cycleKey: scheduledAt.toISOString(), localDate,
    oncePerDay: nextIsAnotherDay && previousIsAnotherDay,
  }
}

export interface StoredCycle {
  cycleKey: string
  status: 'waiting' | 'running' | 'retrying' | 'success' | 'failed' | 'manual'
  attemptCount: number
  nextRetryAt: string | null
  succeeded: boolean
  leaseUntil: string | null
  outcome: string | null
}

export interface SuccessEvidence { executed_at: string; cycle_key: string | null }

export type ScheduleDecision =
  | { type: 'wait'; nextAt: string | null; reason: string }
  | { type: 'skip'; reason: string }
  | { type: 'run'; cycle: CycleWindow; reason: string }
  | { type: 'retry'; cycle: CycleWindow; reason: string }
  | { type: 'fail'; cycle: CycleWindow | null; reason: string }

export function cycleAlreadySucceeded(cycle: CycleWindow, timeZone: string, state: StoredCycle | null, successes: SuccessEvidence[]): boolean {
  if (state?.cycleKey === cycle.cycleKey && state.succeeded) return true
  return successes.some((item) => {
    if (item.cycle_key === cycle.cycleKey) return true
    const when = new Date(item.executed_at).getTime()
    if (Number.isNaN(when)) return false
    if (cycle.oncePerDay && localDateKey(new Date(item.executed_at), timeZone) === cycle.localDate) return true
    return when >= cycle.scheduledAt.getTime() && when < cycle.windowEnd.getTime()
  })
}

export function evaluateSchedule(input: {
  now: Date
  timeZone: string
  expression: string
  state: StoredCycle | null
  successes: SuccessEvidence[]
  probe: CronProbe
  maxAttempts?: number
}): ScheduleDecision {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  let probe: CronProbe
  try { probe = input.probe } catch { return { type: 'fail', cycle: null, reason: 'Cron 表达式无效' } }
  if (!cron.validate(input.expression)) return { type: 'fail', cycle: null, reason: 'Cron 表达式无效' }
  const cycle = describeCycle(input.timeZone, input.now, probe)
  const nextAt = probe.nextAfter(input.now)?.toISOString() ?? null
  if (!cycle) {
    if (input.state && (input.state.status === 'retrying' || input.state.status === 'running' || input.state.status === 'waiting') && input.state.leaseUntil && new Date(input.state.leaseUntil).getTime() > input.now.getTime()) {
      return { type: 'skip', reason: '任务仍在执行' }
    }
    if (input.state && (input.state.status === 'retrying' || input.state.status === 'running')) return { type: 'fail', cycle: null, reason: '签到窗口已结束' }
    return { type: 'wait', nextAt, reason: '计划时间尚未到达' }
  }
  if (cycleAlreadySucceeded(cycle, input.timeZone, input.state, input.successes)) return { type: 'skip', reason: '当前签到周期已经成功' }
  const state = input.state?.cycleKey === cycle.cycleKey ? input.state : null
  if (state?.status === 'manual') return { type: 'skip', reason: '当前周期需要人工处理，已暂停自动重试' }
  if (state?.status === 'failed') return { type: 'skip', reason: '当前周期已停止自动重试' }
  if (state?.status === 'running' && state.leaseUntil && new Date(state.leaseUntil).getTime() > input.now.getTime()) return { type: 'skip', reason: '任务正在执行，已跳过重复触发' }
  const recoveredAttempts = state?.status === 'running' ? state.attemptCount + 1 : state?.attemptCount ?? 0
  if (state && (state.status === 'retrying' || state.status === 'running')) {
    if (recoveredAttempts >= maxAttempts) return { type: 'fail', cycle, reason: '已达到最大重试次数' }
    if (state.status === 'retrying' && state.nextRetryAt && new Date(state.nextRetryAt).getTime() > input.now.getTime()) {
      return { type: 'wait', nextAt: state.nextRetryAt, reason: '等待下一次重试' }
    }
    if (input.now.getTime() >= cycle.windowEnd.getTime()) return { type: 'fail', cycle, reason: '已超过本周期截止时间' }
    return { type: 'retry', cycle, reason: state.status === 'running' ? '恢复中断的执行' : '到达重试时间' }
  }
  return { type: 'run', cycle, reason: '当前周期尚未成功' }
}

export function planAfterOutcome(input: {
  outcome: CheckinOutcome
  attemptCount: number
  now: Date
  windowEnd: Date
  jitterMs?: number
  delays?: number[]
  maxAttempts?: number
}): { status: StoredCycle['status']; nextRetryAt: string | null; succeeded: boolean; notify: 'success' | 'failed' | 'manual' | 'none'; message: string } {
  const delays = input.delays ?? DEFAULT_RETRY_DELAYS_MS
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  if (input.outcome === 'success') return { status: 'success', nextRetryAt: null, succeeded: true, notify: 'success', message: '签到成功' }
  if (input.outcome === 'authentication_required') return { status: 'manual', nextRetryAt: null, succeeded: false, notify: 'manual', message: '登录状态失效，已暂停自动重试' }
  if (input.outcome === 'manual_action_required') return { status: 'manual', nextRetryAt: null, succeeded: false, notify: 'manual', message: '需要人工完成验证，已暂停自动重试' }
  if (input.outcome === 'skipped') return { status: 'retrying', nextRetryAt: input.now.toISOString(), succeeded: false, notify: 'none', message: '任务正在执行，已跳过重复触发' }
  if (input.outcome === 'not_ready' || input.outcome === 'retryable_error') {
    const attempts = input.attemptCount + 1
    if (attempts >= maxAttempts) return { status: 'failed', nextRetryAt: null, succeeded: false, notify: 'failed', message: '已达到最大重试次数' }
    const delay = delays[Math.min(attempts - 1, delays.length - 1)] + (input.jitterMs ?? 0)
    const next = new Date(input.now.getTime() + delay)
    if (next.getTime() >= input.windowEnd.getTime()) return { status: 'failed', nextRetryAt: null, succeeded: false, notify: 'failed', message: '下一次重试会超出本周期截止时间' }
    const reason = input.outcome === 'not_ready' ? '签到尚未开放' : '临时故障'
    return { status: 'retrying', nextRetryAt: next.toISOString(), succeeded: false, notify: 'none', message: `${reason}，将按退避间隔重试` }
  }
  return { status: 'failed', nextRetryAt: null, succeeded: false, notify: 'failed', message: '签到失败，已停止自动重试' }
}

export function retryJitterMs(taskId: string): number {
  let hash = 0
  for (const char of taskId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  return hash % 30_000
}
