import cron, { type ScheduledTask } from 'node-cron'
import type { TaskService } from './taskService.js'
import type { Task } from '../../shared/types.js'

export class TaskScheduler {
  private jobs = new Map<string, ScheduledTask>()
  private nextRuns = new Map<string, Date>()
  constructor(private tasks: TaskService, private onComplete: (task: Task) => void, private getTimezone: () => string = () => 'Asia/Shanghai') {}
  refresh(): void {
    for (const job of this.jobs.values()) job.stop()
    this.jobs.clear()
    for (const task of this.tasks.list({ status: 'all', search: '', sortBy: 'created_at', sortOrder: 'desc' })) {
      if (!task.enabled || !cron.validate(task.schedule)) continue
      const job = cron.schedule(task.schedule, async () => { await this.tasks.execute(task.id); this.onComplete(this.tasks.get(task.id).task); this.captureNext(task.id) }, { timezone: this.getTimezone() })
      this.jobs.set(task.id, job); this.captureNext(task.id)
    }
  }
  async resume(): Promise<void> {
    const now = new Date()
    for (const [taskId, nextRun] of this.nextRuns) if (nextRun <= now) { await this.tasks.execute(taskId); this.onComplete(this.tasks.get(taskId).task) }
    this.refresh()
  }
  stop(): void { for (const job of this.jobs.values()) job.stop(); this.jobs.clear() }
  private captureNext(taskId: string): void { const next = this.jobs.get(taskId)?.getNextRun(); if (next) this.nextRuns.set(taskId, next) }
}
