import type { AppDatabase } from '../database/index.js'
import type { ScheduleSnapshot } from '../../shared/types.js'
import type { StoredCycle } from './schedulePolicy.js'

export interface ScheduleStateRow {
  task_id: string
  cycle_key: string
  timezone: string
  scheduled_at: string
  window_end: string
  local_date: string | null
  status: StoredCycle['status']
  attempt_count: number
  last_attempt_at: string | null
  next_retry_at: string | null
  outcome: string | null
  message: string | null
  succeeded: number
  lease_until: string | null
  updated_at: string
}

export class ScheduleStore {
  constructor(private readonly db: AppDatabase) {}

  get(taskId: string): ScheduleStateRow | null {
    return (this.db.sqlite.prepare('SELECT * FROM schedule_states WHERE task_id = ?').get(taskId) as ScheduleStateRow | undefined) ?? null
  }

  list(): ScheduleStateRow[] {
    return this.db.sqlite.prepare('SELECT * FROM schedule_states').all() as ScheduleStateRow[]
  }

  delete(taskId: string): void {
    this.db.sqlite.prepare('DELETE FROM schedule_states WHERE task_id = ?').run(taskId)
  }

  save(row: ScheduleStateRow): void {
    this.db.sqlite.prepare(`INSERT INTO schedule_states (
      task_id, cycle_key, timezone, scheduled_at, window_end, local_date, status, attempt_count, last_attempt_at, next_retry_at, outcome, message, succeeded, lease_until, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(task_id) DO UPDATE SET
      cycle_key=excluded.cycle_key, timezone=excluded.timezone, scheduled_at=excluded.scheduled_at, window_end=excluded.window_end,
      local_date=excluded.local_date, status=excluded.status, attempt_count=excluded.attempt_count, last_attempt_at=excluded.last_attempt_at,
      next_retry_at=excluded.next_retry_at, outcome=excluded.outcome, message=excluded.message, succeeded=excluded.succeeded,
      lease_until=excluded.lease_until, updated_at=excluded.updated_at`).run(
      row.task_id, row.cycle_key, row.timezone, row.scheduled_at, row.window_end, row.local_date, row.status, row.attempt_count,
      row.last_attempt_at, row.next_retry_at, row.outcome, row.message, row.succeeded ? 1 : 0, row.lease_until, row.updated_at,
    )
  }

  toStored(row: ScheduleStateRow): StoredCycle {
    return {
      cycleKey: row.cycle_key, status: row.status, attemptCount: Number(row.attempt_count) || 0, nextRetryAt: row.next_retry_at,
      succeeded: Number(row.succeeded) === 1, leaseUntil: row.lease_until, outcome: row.outcome,
    }
  }

  toSnapshot(row: ScheduleStateRow): ScheduleSnapshot {
    return {
      status: row.status, message: row.message, next_retry_at: row.next_retry_at, scheduled_at: row.scheduled_at,
      attempt_count: Number(row.attempt_count) || 0, outcome: row.outcome, succeeded: Number(row.succeeded) === 1,
      local_date: row.local_date, timezone: row.timezone,
    }
  }
}
