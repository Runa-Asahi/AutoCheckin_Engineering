import cron, { type ScheduledTask } from 'node-cron'
import type { ExecutionResult, Task } from '../../shared/types.js'
import type { TaskListQuery } from '../../shared/schemas.js'
import { endOfLocalDay, localDateKey } from '../../shared/localTime.js'
import { classifyOutcome, type CheckinOutcome } from './outcomeClassifier.js'
import { ScheduleStore, type ScheduleStateRow } from './scheduleStore.js'
import {
  closeAllCronProbes, cycleAlreadySucceeded, describeCycle, evaluateSchedule, getCronProbe, LEASE_MS, planAfterOutcome, retryJitterMs,
  type CycleWindow, type SuccessEvidence,
} from './schedulePolicy.js'

export interface ExecuteOptions {
  cycleKey?: string | null
  skipIfBusy?: boolean
  trigger?: string
}

export interface SchedulerTaskSource {
  list(query: TaskListQuery): Task[]
  get(id: string): { task: Task }
  execute(id: string, options?: ExecuteOptions): Promise<ExecutionResult>
  recentSuccesses(id: string, sinceIso: string): SuccessEvidence[]
  markFinalFailure(id: string): void
  markPending(id: string): void
  recordSkip(id: string, reason: string, cycleKey: string | null): void
}

export interface SchedulerEvent {
  taskId: string
  notify: 'success' | 'failed' | 'manual' | 'none'
  message: string
  task: Task
}

export interface SchedulerClock { now(): Date }
export interface SchedulerTimer { set(delayMs: number, callback: () => void): { clear(): void } }

const listQuery: TaskListQuery = { status: 'all', search: '', sortBy: 'created_at', sortOrder: 'desc' }

export class TaskScheduler {
  private jobs = new Map<string, ScheduledTask>()
  private executions = new Map<string, Promise<ExecutionResult>>()
  private chain: Promise<void> = Promise.resolve()
  private timer: { clear(): void } | null = null
  private stopped = false

  constructor(
    private readonly tasks: SchedulerTaskSource,
    private readonly store: ScheduleStore,
    private readonly onEvent: (event: SchedulerEvent) => void,
    private readonly getTimezone: () => string = () => 'Asia/Shanghai',
    private readonly clock: SchedulerClock = { now: () => new Date() },
    private readonly timerFactory: SchedulerTimer = defaultSchedulerTimer,
    private readonly jitterMs: (taskId: string) => number = retryJitterMs,
  ) {}

  refresh(): Promise<void> {
    this.stopped = false
    for (const job of this.jobs.values()) void this.releaseJob(job)
    this.jobs.clear()
    const timeZone = this.safeTimezone()
    for (const task of this.tasks.list(listQuery)) {
      if (!task.enabled || !cron.validate(task.schedule)) continue
      const job = cron.schedule(task.schedule, () => { void this.reconcile('cron') }, { timezone: timeZone, noOverlap: true, unref: true })
      job.unref()
      this.jobs.set(task.id, job)
    }
    return this.reconcile('refresh')
  }

  reconcile(reason = 'startup'): Promise<void> {
    return this.enqueue(() => this.reconcileNow(reason))
  }

  resume(): Promise<void> {
    return this.reconcile('resume')
  }

  checkNow(): Promise<void> {
    return this.reconcile('tray')
  }

  runManual(id: string): Promise<ExecutionResult> {
    const existing = this.executions.get(id)
    if (existing) return existing
    return this.occupy(id, () => this.enqueue(() => this.performManual(id)))
  }

  stop(): void {
    this.stopped = true
    for (const job of this.jobs.values()) void this.releaseJob(job)
    this.jobs.clear()
    this.timer?.clear()
    this.timer = null
    closeAllCronProbes()
  }

  flush(): Promise<void> {
    return this.chain
  }

  summary(): string {
    const rows = this.store.list()
    const count = (status: ScheduleStateRow['status']) => rows.filter((row) => row.status === status).length
    return `AutoCheckin · 执行中 ${count('running')} · 等待重试 ${count('retrying')} · 待处理 ${count('manual')}`
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work)
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  private occupy(id: string, work: () => Promise<ExecutionResult>): Promise<ExecutionResult> {
    const existing = this.executions.get(id)
    if (existing) return existing
    const run = work().finally(() => { if (this.executions.get(id) === run) this.executions.delete(id) })
    this.executions.set(id, run)
    return run
  }

  private async reconcileNow(reason: string): Promise<void> {
    if (this.stopped) return
    const now = this.clock.now()
    const timeZone = this.safeTimezone()
    const tasks = this.tasks.list(listQuery)
    await Promise.all(tasks.map(async (task) => {
      try { await this.reconcileTask(task, now, timeZone, reason) }
      catch (error) { console.error(`[scheduler] ${task.site_name} 调度失败`, error instanceof Error ? error.message : error) }
    }))
    const known = new Set(tasks.map((task) => task.id))
    for (const row of this.store.list()) if (!known.has(row.task_id)) this.store.delete(row.task_id)
    this.armRetryTimer()
  }

  private async reconcileTask(task: Task, now: Date, timeZone: string, reason: string): Promise<void> {
    if (!task.enabled || !cron.validate(task.schedule)) {
      this.store.delete(task.id)
      this.jobs.get(task.id)?.stop()
      this.jobs.delete(task.id)
      return
    }
    const probe = getCronProbe(task.schedule, timeZone)
    let row = this.store.get(task.id)
    const openCycle = describeCycle(timeZone, now, probe)
    const scheduledStillMatches = row ? this.matches(probe, row.scheduled_at) : false
    if (row && row.status === 'retrying' && !scheduledStillMatches) this.store.delete(task.id)
    else if (row && openCycle && row.cycle_key !== openCycle.cycleKey && row.status !== 'success' && row.status !== 'manual' && row.status !== 'failed' && !scheduledStillMatches) this.store.delete(task.id)
    row = this.store.get(task.id)
    const successes = this.tasks.recentSuccesses(task.id, new Date(now.getTime() - 3 * 86_400_000).toISOString())
    const decision = evaluateSchedule({ now, timeZone, expression: task.schedule, state: row ? this.store.toStored(row) : null, successes, probe })
    if (decision.type === 'wait') {
      if (decision.reason === '等待下一次重试') return
      const today = localDateKey(now, timeZone)
      if (row && (row.status === 'failed' || row.status === 'manual') && row.local_date === today) return
      const next = decision.nextAt ? new Date(decision.nextAt) : null
      this.store.save({
        task_id: task.id,
        cycle_key: next?.toISOString() ?? `waiting:${today}`,
        timezone: timeZone,
        scheduled_at: next?.toISOString() ?? now.toISOString(),
        window_end: (next ? endOfLocalDay(next, timeZone) : endOfLocalDay(now, timeZone)).toISOString(),
        local_date: next ? localDateKey(next, timeZone) : today,
        status: 'waiting', attempt_count: 0, last_attempt_at: row?.last_attempt_at ?? null, next_retry_at: null,
        outcome: null, message: decision.reason, succeeded: 0, lease_until: null, updated_at: now.toISOString(),
      })
      return
    }
    if (decision.type === 'skip') {
      if (decision.reason === '当前签到周期已经成功' && openCycle) this.rememberSuccess(task.id, openCycle, timeZone, now, row)
      return
    }
    if (decision.type === 'fail') {
      const closedPreviousCycle = !decision.cycle
      if (!row || (row.status !== 'failed' && row.status !== 'manual')) {
        this.store.save({
          task_id: task.id,
          cycle_key: decision.cycle?.cycleKey ?? row?.cycle_key ?? `closed:${localDateKey(now, timeZone)}`,
          timezone: timeZone,
          scheduled_at: decision.cycle?.scheduledAt.toISOString() ?? row?.scheduled_at ?? now.toISOString(),
          window_end: decision.cycle?.windowEnd.toISOString() ?? row?.window_end ?? now.toISOString(),
          local_date: decision.cycle?.localDate ?? row?.local_date ?? localDateKey(now, timeZone),
          status: 'failed', attempt_count: row?.attempt_count ?? 0, last_attempt_at: row?.last_attempt_at ?? now.toISOString(),
          next_retry_at: null, outcome: row?.outcome ?? 'permanent_failure', message: decision.reason, succeeded: 0, lease_until: null, updated_at: now.toISOString(),
        })
        this.tasks.markFinalFailure(task.id)
        this.emit(task.id, 'failed', decision.reason)
      }
      if (!closedPreviousCycle) return
      const next = probe.nextAfter(now)
      if (!next) return
      this.store.save({
        task_id: task.id, cycle_key: next.toISOString(), timezone: timeZone, scheduled_at: next.toISOString(),
        window_end: endOfLocalDay(next, timeZone).toISOString(), local_date: localDateKey(next, timeZone), status: 'waiting',
        attempt_count: 0, last_attempt_at: null, next_retry_at: null, outcome: null, message: '计划时间尚未到达', succeeded: 0, lease_until: null, updated_at: now.toISOString(),
      })
      return
    }
    if (this.executions.has(task.id)) {
      this.tasks.recordSkip(task.id, '任务正在执行，已跳过重复触发', decision.cycle.cycleKey)
      return
    }
    await this.occupy(task.id, () => this.perform(task, decision.cycle, timeZone, reason))
  }

  private async performManual(id: string): Promise<ExecutionResult> {
    const task = this.tasks.get(id).task
    const now = this.clock.now()
    const timeZone = this.safeTimezone()
    const cycle = task.schedule && cron.validate(task.schedule) ? describeCycle(timeZone, now, getCronProbe(task.schedule, timeZone)) : null
    if (!cycle) return this.performWithoutCycle(task, timeZone)
    const row = this.store.get(task.id)
    const successes = this.tasks.recentSuccesses(task.id, new Date(now.getTime() - 3 * 86_400_000).toISOString())
    const already = cycleAlreadySucceeded(cycle, timeZone, row ? this.store.toStored(row) : null, successes)
    const result = await this.perform(task, cycle, timeZone, 'manual', already)
    if (already && result.outcome !== 'success') this.rememberSuccess(task.id, cycle, timeZone, this.clock.now(), this.store.get(task.id))
    this.armRetryTimer()
    return result
  }

  private async performWithoutCycle(task: Task, timeZone: string): Promise<ExecutionResult> {
    const result = await this.tasks.execute(task.id, { skipIfBusy: false, trigger: 'manual' })
    const outcome = result.outcome ?? classifyOutcome({ success: result.success, message: result.message, responseSummary: result.responseSummary })
    if (outcome === 'success') this.emit(task.id, 'success', result.message || '签到成功')
    else if (outcome === 'authentication_required' || outcome === 'manual_action_required') {
      this.tasks.markFinalFailure(task.id)
      this.emit(task.id, 'manual', result.message || '需要人工处理')
    } else if (outcome === 'not_ready' || outcome === 'retryable_error' || outcome === 'skipped') this.tasks.markPending(task.id)
    else {
      this.tasks.markFinalFailure(task.id)
      this.emit(task.id, 'failed', result.message || '签到失败，已停止自动重试')
    }
    this.armRetryTimer()
    return { ...result, outcome }
  }

  private async perform(task: Task, cycle: CycleWindow, timeZone: string, trigger: string, preserveSuccess = false): Promise<ExecutionResult> {
    const now = this.clock.now()
    const existing = this.store.get(task.id)
    const finishedBefore = existing?.cycle_key === cycle.cycleKey ? (existing.status === 'running' ? existing.attempt_count + 1 : existing.attempt_count) : 0
    const leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString()
    this.writeCycle(task.id, cycle, timeZone, {
      status: 'running', attempt_count: finishedBefore, last_attempt_at: now.toISOString(), next_retry_at: null,
      outcome: null, message: '正在签到', succeeded: 0, lease_until: leaseUntil,
    })
    this.emit(task.id, 'none', '正在签到')
    let result: ExecutionResult
    try {
      result = await this.tasks.execute(task.id, { cycleKey: cycle.cycleKey, skipIfBusy: trigger !== 'manual', trigger })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result = { success: false, status: 'failed', message, durationMs: 0, engineUsed: task.engine_type, outcome: classifyOutcome({ success: false, message }) }
    }
    const outcome: CheckinOutcome = result.outcome ?? classifyOutcome({ success: result.success, message: result.message, responseSummary: result.responseSummary })
    if (outcome === 'skipped') return { ...result, outcome }
    const plan = planAfterOutcome({ outcome, attemptCount: finishedBefore, now: this.clock.now(), windowEnd: cycle.windowEnd, jitterMs: this.jitterMs(task.id) })
    this.writeCycle(task.id, cycle, timeZone, {
      status: plan.status,
      attempt_count: outcome === 'not_ready' || outcome === 'retryable_error' || plan.status === 'failed' ? finishedBefore + 1 : finishedBefore,
      last_attempt_at: this.clock.now().toISOString(), next_retry_at: plan.nextRetryAt, outcome, message: result.message || plan.message,
      succeeded: plan.succeeded ? 1 : 0, lease_until: null,
    })
    if (!preserveSuccess && (plan.status === 'failed' || plan.status === 'manual')) this.tasks.markFinalFailure(task.id)
    else if (plan.status === 'retrying') this.tasks.markPending(task.id)
    this.emit(task.id, preserveSuccess && outcome !== 'success' ? 'none' : plan.notify, result.message || plan.message)
    this.armRetryTimer()
    return { ...result, outcome }
  }

  private rememberSuccess(taskId: string, cycle: CycleWindow, timeZone: string, now: Date, previous: ScheduleStateRow | null): void {
    if (previous?.cycle_key === cycle.cycleKey && previous.status === 'success' && Number(previous.succeeded) === 1) return
    this.writeCycle(taskId, cycle, timeZone, {
      status: 'success', attempt_count: previous?.attempt_count ?? 0, last_attempt_at: previous?.last_attempt_at ?? now.toISOString(),
      next_retry_at: null, outcome: 'success', message: '当前签到周期已经成功', succeeded: 1, lease_until: null,
    })
  }

  private writeCycle(taskId: string, cycle: CycleWindow, timeZone: string, patch: Omit<ScheduleStateRow, 'task_id' | 'cycle_key' | 'timezone' | 'scheduled_at' | 'window_end' | 'local_date' | 'updated_at'>): void {
    this.store.save({
      task_id: taskId, cycle_key: cycle.cycleKey, timezone: timeZone, scheduled_at: cycle.scheduledAt.toISOString(),
      window_end: cycle.windowEnd.toISOString(), local_date: cycle.localDate, updated_at: this.clock.now().toISOString(), ...patch,
    })
  }

  private emit(taskId: string, notify: SchedulerEvent['notify'], message: string): void {
    try { this.onEvent({ taskId, notify, message, task: this.tasks.get(taskId).task }) }
    catch (error) { console.error('[scheduler] 状态通知失败', error instanceof Error ? error.message : error) }
  }

  private armRetryTimer(): void {
    this.timer?.clear()
    this.timer = null
    if (this.stopped) return
    const now = this.clock.now().getTime()
    let earliest = Number.POSITIVE_INFINITY
    for (const row of this.store.list()) {
      if (row.status !== 'retrying' || !row.next_retry_at) continue
      const at = new Date(row.next_retry_at).getTime()
      if (at < earliest) earliest = at
    }
    if (!Number.isFinite(earliest)) return
    const delay = Math.max(250, earliest - now)
    this.timer = this.timerFactory.set(delay, () => { void this.reconcile('retry') })
  }

  private matches(probe: { matches(date: Date): boolean }, value: string): boolean {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return false
    try { return probe.matches(date) } catch { return false }
  }

  private safeTimezone(): string {
    const value = this.getTimezone()
    try { Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date()); return value } catch { return 'Asia/Shanghai' }
  }

  private releaseJob(job: ScheduledTask): void {
    try { void job.stop(); void job.destroy() } catch { /* already stopped */ }
  }
}

const defaultSchedulerTimer: SchedulerTimer = {
  set(delayMs, callback) {
    const timer = setTimeout(callback, delayMs)
    timer.unref?.()
    return { clear: () => clearTimeout(timer) }
  },
}
