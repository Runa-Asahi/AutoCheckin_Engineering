import { localDateKey } from './localTime.js'
import type { ScheduleSnapshot } from './types.js'

export type { ScheduleSnapshot }

export function presentSchedule(task: { last_status?: string | null; schedule_state?: ScheduleSnapshot | null }, now = new Date()): { label: string; tone: 'success' | 'failed' | 'running' | 'pending' } {
  const schedule = task.schedule_state
  const today = schedule?.timezone && schedule.local_date ? localDateKey(now, schedule.timezone) : null
  const current = Boolean(schedule && (!today || !schedule.local_date || schedule.local_date === today))
  if (schedule && current) {
    if (schedule.status === 'running') return { label: '正在签到', tone: 'running' }
    if (schedule.status === 'retrying') return { label: '等待重试', tone: 'running' }
    if (schedule.status === 'manual') return { label: '需要处理', tone: 'failed' }
    if (schedule.status === 'failed') return { label: '最终失败', tone: 'failed' }
    if (schedule.status === 'success' && schedule.succeeded) return { label: '今日成功', tone: 'success' }
    if (schedule.status === 'waiting') return { label: '等待计划', tone: 'pending' }
  }
  if (task.last_status === 'running') return { label: '正在签到', tone: 'running' }
  if (task.last_status === 'success') return { label: '最近成功', tone: 'success' }
  if (task.last_status === 'failed') return { label: '最近失败', tone: 'failed' }
  return { label: '等待计划', tone: 'pending' }
}
