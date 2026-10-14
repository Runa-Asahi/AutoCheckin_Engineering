import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { AppDatabase, migrationSql } from '../src/main/database/index.js'
import { ScheduleStore } from '../src/main/services/scheduleStore.js'
import { TaskScheduler, type ExecuteOptions, type SchedulerEvent, type SchedulerTaskSource } from '../src/main/services/taskScheduler.js'
import type { CheckinOutcome, ExecutionResult, Task } from '../src/shared/types.js'

class Clock { constructor(private value: string) {} now(): Date { return new Date(this.value) } set(value: string): void { this.value = value } }
class FakeTimers {
  delay: number | null = null
  private callback: (() => void) | null = null
  set(delay: number, callback: () => void): { clear(): void } {
    this.delay = delay
    this.callback = callback
    return { clear: () => { if (this.callback === callback) { this.callback = null; this.delay = null } } }
  }
}

class RecordingTasks implements SchedulerTaskSource {
  runs: Array<{ id: string; at: string; trigger?: string }> = []
  started = 0
  skips: string[] = []
  outcome: CheckinOutcome | ((index: number) => CheckinOutcome) = 'success'
  gate: Promise<void> | null = null
  constructor(private readonly db: AppDatabase, private readonly clock: Clock) {}
  list(): Task[] { return this.db.sqlite.prepare('SELECT * FROM tasks').all() as Task[] }
  get(id: string): { task: Task } {
    const task = this.db.sqlite.prepare('SELECT * FROM tasks WHERE id=?').get(id) as Task | undefined
    if (!task) throw new Error('任务不存在')
    return { task }
  }
  async execute(id: string, options?: ExecuteOptions): Promise<ExecutionResult> {
    this.started += 1
    if (this.gate) await this.gate
    if (id === '00000000-0000-4000-8000-0000000000bb') throw new Error('这个任务执行失败')
    const outcome = typeof this.outcome === 'function' ? this.outcome(this.runs.length) : this.outcome
    const at = this.clock.now().toISOString()
    this.runs.push({ id, at, trigger: options?.trigger })
    const success = outcome === 'success'
    this.db.sqlite.prepare(`INSERT INTO execution_logs (id,task_id,run_id,status,engine_used,duration_ms,error_message,retry_count,executed_at,cycle_key) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), id, randomUUID(), success ? 'success' : 'failed', 'http', 1, success ? null : messageFor(outcome), 0, at, options?.cycleKey ?? null)
    this.db.sqlite.prepare(`UPDATE tasks SET last_run_at=?, last_status=? WHERE id=?`).run(at, success ? 'success' : 'pending', id)
    return { success, status: success ? 'success' : 'pending', message: messageFor(outcome), durationMs: 1, engineUsed: 'http', outcome }
  }
  recentSuccesses(id: string, sinceIso: string) { return this.db.sqlite.prepare(`SELECT executed_at, cycle_key FROM execution_logs WHERE task_id=? AND status='success' AND executed_at>=?`).all(id, sinceIso) as Array<{ executed_at: string; cycle_key: string | null }> }
  markFinalFailure(id: string): void { this.db.sqlite.prepare(`UPDATE tasks SET last_status='failed', consecutive_days=0 WHERE id=?`).run(id) }
  markPending(id: string): void { this.db.sqlite.prepare(`UPDATE tasks SET last_status='pending' WHERE id=?`).run(id) }
  recordSkip(id: string, reason: string): void { this.skips.push(`${id}:${reason}`) }
}

function messageFor(outcome: CheckinOutcome): string {
  if (outcome === 'success') return '签到成功'
  if (outcome === 'not_ready') return '今日签到尚未开放'
  if (outcome === 'retryable_error') return '网络超时'
  if (outcome === 'authentication_required') return '登录已过期'
  if (outcome === 'manual_action_required') return '请完成验证码'
  return '适配器不匹配'
}

function insertTask(db: AppDatabase, schedule = '0 8 * * *', id = randomUUID()): string {
  const now = '2026-10-01T00:00:00.000Z'
  db.sqlite.prepare(`INSERT INTO tasks (id,site_id,site_name,engine_type,login_type,schedule,enabled,priority,config_json,adapter_id,account_label,created_at,updated_at,last_status,consecutive_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',3)`).run(id, 'demo', 'Demo', 'http', 'cookie', schedule, 1, 0, '{}', 'demo', null, now, now)
  return id
}

describe('persistent scheduler', () => {
  const directories: string[] = []
  const databases: AppDatabase[] = []
  const schedulers: TaskScheduler[] = []
  afterEach(async () => {
    for (const scheduler of schedulers) scheduler.stop()
    schedulers.length = 0
    for (const database of databases) database.close()
    databases.length = 0
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  async function setup(schedule = '0 8 * * *', when = '2026-10-13T02:00:00.000Z') {
    const directory = await mkdtemp(join(tmpdir(), 'autocheckin-schedule-'))
    directories.push(directory)
    const db = new AppDatabase(join(directory, 'test.db'))
    databases.push(db)
    const id = insertTask(db, schedule)
    const clock = new Clock(when)
    const timers = new FakeTimers()
    const tasks = new RecordingTasks(db, clock)
    const store = new ScheduleStore(db)
    const events: SchedulerEvent[] = []
    const scheduler = new TaskScheduler(tasks, store, (event) => events.push(event), () => 'Asia/Shanghai', clock, timers, () => 0)
    schedulers.push(scheduler)
    return { db, id, clock, timers, tasks, store, events, scheduler }
  }

  it('does not run before 08:00 and catches up once at 10:00', async () => {
    const early = await setup('0 8 * * *', '2026-10-12T23:00:00.000Z')
    await early.scheduler.reconcile('startup')
    expect(early.tasks.runs).toHaveLength(0)
    expect(early.store.get(early.id)?.status).toBe('waiting')
    early.scheduler.stop()

    const late = await setup('0 8 * * *', '2026-10-13T02:00:00.000Z')
    await late.scheduler.reconcile('startup')
    expect(late.tasks.runs).toHaveLength(1)
    expect(late.store.get(late.id)?.status).toBe('success')
  })

  it('does not run again when today already succeeded', async () => {
    const ctx = await setup()
    ctx.db.sqlite.prepare(`INSERT INTO execution_logs (id,task_id,run_id,status,engine_used,duration_ms,retry_count,executed_at) VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), ctx.id, randomUUID(), 'success', 'http', 1, 0, '2026-10-13T01:00:00.000Z')
    await ctx.scheduler.reconcile('startup')
    expect(ctx.tasks.runs).toHaveLength(0)
    expect(ctx.store.get(ctx.id)?.succeeded).toBe(1)
    await ctx.scheduler.reconcile('startup')
    expect(ctx.tasks.runs).toHaveLength(0)
  })

  it('catches up a missed slot once after sleep and does not backfill several offline days', async () => {
    const slept = await setup('0 8 * * *', '2026-10-12T23:50:00.000Z')
    await slept.scheduler.reconcile('startup')
    expect(slept.tasks.runs).toHaveLength(0)
    slept.clock.set('2026-10-13T02:00:00.000Z')
    await slept.scheduler.resume()
    expect(slept.tasks.runs).toHaveLength(1)
    await slept.scheduler.resume()
    expect(slept.tasks.runs).toHaveLength(1)

    const offline = await setup('0 8 * * *', '2026-10-16T02:00:00.000Z')
    await offline.scheduler.reconcile('startup')
    expect(offline.tasks.runs).toHaveLength(1)
    expect(offline.store.get(offline.id)?.local_date).toBe('2026-10-16')
  })

  it('retries a closed site on the backoff schedule and cancels the queue after success', async () => {
    const ctx = await setup('0 8 * * *', '2026-10-13T00:00:00.000Z')
    ctx.tasks.outcome = (index) => index === 0 ? 'not_ready' : 'success'
    await ctx.scheduler.reconcile('startup')
    expect(ctx.tasks.runs).toHaveLength(1)
    expect(ctx.events.filter((event) => event.notify !== 'none')).toHaveLength(0)
    expect(ctx.timers.delay).toBe(5 * 60_000)
    ctx.clock.set('2026-10-13T00:00:01.000Z')
    await ctx.scheduler.reconcile('retry')
    expect(ctx.tasks.runs).toHaveLength(1)
    ctx.clock.set('2026-10-13T00:05:00.000Z')
    await ctx.scheduler.reconcile('retry')
    expect(ctx.tasks.runs).toHaveLength(2)
    expect(ctx.store.get(ctx.id)?.status).toBe('success')
    expect(ctx.timers.delay).toBeNull()
    ctx.clock.set('2026-10-13T06:00:00.000Z')
    await ctx.scheduler.reconcile('retry')
    expect(ctx.tasks.runs).toHaveLength(2)
  })

  it('limits network retries and does not keep polling login or captcha failures', async () => {
    const network = await setup('0 8 * * *', '2026-10-13T00:00:00.000Z')
    network.tasks.outcome = 'retryable_error'
    let cursor = Date.parse('2026-10-13T00:00:00.000Z')
    await network.scheduler.reconcile('startup')
    for (let index = 0; index < 6; index += 1) {
      cursor += network.timers.delay ?? 60 * 60_000
      network.clock.set(new Date(cursor).toISOString())
      await network.scheduler.reconcile('retry')
    }
    expect(network.tasks.runs.length).toBeLessThanOrEqual(5)
    expect(network.tasks.runs.length).toBeGreaterThanOrEqual(4)
    expect(network.store.get(network.id)?.status).toBe('failed')
    const settled = network.tasks.runs.length
    network.clock.set('2026-10-13T10:00:00.000Z')
    await network.scheduler.reconcile('retry')
    expect(network.tasks.runs).toHaveLength(settled)

    const auth = await setup('0 8 * * *', '2026-10-13T00:00:00.000Z')
    auth.tasks.outcome = 'authentication_required'
    await auth.scheduler.reconcile('startup')
    auth.clock.set('2026-10-13T04:00:00.000Z')
    await auth.scheduler.reconcile('retry')
    expect(auth.tasks.runs).toHaveLength(1)
    expect(auth.store.get(auth.id)?.status).toBe('manual')
    expect(auth.events.some((event) => event.notify === 'manual')).toBe(true)

    const captcha = await setup('0 8 * * *', '2026-10-13T00:00:00.000Z')
    captcha.tasks.outcome = 'manual_action_required'
    await captcha.scheduler.reconcile('startup')
    captcha.clock.set('2026-10-13T05:00:00.000Z')
    await captcha.scheduler.reconcile('retry')
    expect(captcha.tasks.runs).toHaveLength(1)
    expect(captcha.store.get(captcha.id)?.next_retry_at).toBeNull()
  })

  it('runs a task only once when startup, cron and manual triggers overlap', async () => {
    const ctx = await setup()
    let release: () => void = () => undefined
    ctx.tasks.gate = new Promise((resolve) => { release = resolve })
    const startup = ctx.scheduler.reconcile('startup')
    const cron = ctx.scheduler.reconcile('cron')
    const manual = ctx.scheduler.runManual(ctx.id)
    await new Promise((resolve) => setImmediate(resolve))
    expect(ctx.tasks.started).toBe(1)
    release()
    await Promise.all([startup, cron, manual])
    expect(ctx.tasks.runs).toHaveLength(1)
  })

  it('restores the saved retry instead of starting over after a restart', async () => {
    const ctx = await setup('0 8 * * *', '2026-10-13T00:00:00.000Z')
    ctx.tasks.outcome = 'not_ready'
    await ctx.scheduler.reconcile('startup')
    expect(ctx.store.get(ctx.id)?.attempt_count).toBe(1)
    ctx.scheduler.stop()
    const restarted = new TaskScheduler(ctx.tasks, ctx.store, (event) => ctx.events.push(event), () => 'Asia/Shanghai', ctx.clock, ctx.timers, () => 0)
    schedulers.push(restarted)
    ctx.clock.set('2026-10-13T02:00:00.000Z')
    await restarted.reconcile('startup')
    expect(ctx.tasks.runs).toHaveLength(2)
    expect(ctx.store.get(ctx.id)?.attempt_count).toBe(2)
    expect(ctx.timers.delay).toBe(10 * 60_000)
  })

  it('clears timers and stale retries when a task is disabled, removed or rescheduled', async () => {
    const ctx = await setup('0 8 * * *', '2026-10-13T00:10:00.000Z')
    ctx.tasks.outcome = 'not_ready'
    await ctx.scheduler.refresh()
    expect(ctx.tasks.runs).toHaveLength(1)
    expect(ctx.timers.delay).toBe(5 * 60_000)
    ctx.db.sqlite.prepare('UPDATE tasks SET enabled=0 WHERE id=?').run(ctx.id)
    await ctx.scheduler.refresh()
    expect(ctx.store.get(ctx.id)).toBeNull()
    expect(ctx.timers.delay).toBeNull()
    ctx.clock.set('2026-10-13T02:00:00.000Z')
    await ctx.scheduler.reconcile('retry')
    expect(ctx.tasks.runs).toHaveLength(1)

    ctx.db.sqlite.prepare('UPDATE tasks SET enabled=1, schedule=? WHERE id=?').run('0 8 * * *', ctx.id)
    ctx.tasks.outcome = 'not_ready'
    ctx.clock.set('2026-10-13T00:10:00.000Z')
    await ctx.scheduler.reconcile('startup')
    expect(ctx.tasks.runs).toHaveLength(2)
    ctx.db.sqlite.prepare('UPDATE tasks SET schedule=? WHERE id=?').run('0 9 * * *', ctx.id)
    await ctx.scheduler.refresh()
    expect(ctx.store.get(ctx.id)?.status).not.toBe('retrying')
    const runsAfterReschedule = ctx.tasks.runs.length
    ctx.clock.set('2026-10-13T00:20:00.000Z')
    await ctx.scheduler.reconcile('retry')
    expect(ctx.tasks.runs).toHaveLength(runsAfterReschedule)

    ctx.db.sqlite.prepare('DELETE FROM tasks WHERE id=?').run(ctx.id)
    await ctx.scheduler.refresh()
    expect(ctx.store.get(ctx.id)).toBeNull()
  })

  it('recovers an expired execution lease and does not duplicate a live one', async () => {
    const ctx = await setup('0 8 * * *', '2026-10-13T02:00:00.000Z')
    const scheduled = '2026-10-13T00:00:00.000Z'
    ctx.store.save({
      task_id: ctx.id, cycle_key: scheduled, timezone: 'Asia/Shanghai', scheduled_at: scheduled, window_end: '2026-10-13T16:00:00.000Z',
      local_date: '2026-10-13', status: 'running', attempt_count: 0, last_attempt_at: scheduled, next_retry_at: null, outcome: null,
      message: '正在签到', succeeded: 0, lease_until: '2026-10-13T03:00:00.000Z', updated_at: scheduled,
    })
    await ctx.scheduler.reconcile('startup')
    expect(ctx.tasks.runs).toHaveLength(0)
    ctx.clock.set('2026-10-13T03:01:00.000Z')
    await ctx.scheduler.reconcile('resume')
    expect(ctx.tasks.runs).toHaveLength(1)
    expect(ctx.store.get(ctx.id)?.status).toBe('success')
  })

  it('keeps scheduling the other task when one execution throws', async () => {
    const ctx = await setup('0 8 * * *', '2026-10-13T02:00:00.000Z')
    const broken = '00000000-0000-4000-8000-0000000000bb'
    insertTask(ctx.db, '0 8 * * *', broken)
    await ctx.scheduler.reconcile('startup')
    expect(ctx.tasks.runs.map((run) => run.id)).toContain(ctx.id)
    expect(ctx.tasks.runs.some((run) => run.id === broken)).toBe(false)
  })

  it('upgrades an existing version 1 database without dropping tasks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'autocheckin-migrate-'))
    directories.push(directory)
    const path = join(directory, 'legacy.db')
    const legacy = new DatabaseSync(path)
    legacy.exec(migrationSql)
    const id = randomUUID()
    legacy.prepare(`INSERT INTO tasks (id,site_id,site_name,engine_type,login_type,schedule,enabled,priority,config_json,adapter_id,created_at,updated_at,last_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'success')`).run(id, 'demo', 'Demo', 'http', 'cookie', '0 8 * * *', 1, 0, '{}', 'demo', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')
    legacy.close()
    const upgraded = new AppDatabase(path)
    const task = upgraded.sqlite.prepare('SELECT site_name, last_status FROM tasks WHERE id=?').get(id) as { site_name: string; last_status: string }
    const columns = upgraded.sqlite.prepare('PRAGMA table_info(execution_logs)').all() as Array<{ name: string }>
    expect(task).toEqual({ site_name: 'Demo', last_status: 'success' })
    expect(columns.some((column) => column.name === 'cycle_key')).toBe(true)
    expect(upgraded.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schedule_states'`).get()).toBeTruthy()
    upgraded.close()
    const reopened = new AppDatabase(path)
    expect((reopened.sqlite.prepare('SELECT COUNT(*) AS count FROM tasks').get() as { count: number }).count).toBe(1)
    reopened.close()
  })
})
