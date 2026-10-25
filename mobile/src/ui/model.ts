import type { AccountView, RunRecord, TaskStatus } from '../../../src/shared/types'

/** 平台外观：品牌色 + 单字标识（不使用平台商标图片） */
export const BRAND: Record<string, { color: string; glyph: string }> = {
  netease: { color: '#E20000', glyph: '云' },
  bilibili: { color: '#FB7299', glyph: 'B' },
  tieba: { color: '#3388FF', glyph: '贴' },
  luogu: { color: '#7C4DFF', glyph: '洛' },
}
export const brand = (id: string): { color: string; glyph: string } => BRAND[id] ?? { color: '#6750A4', glyph: id.slice(0, 1).toUpperCase() }

export type Tone = 'success' | 'warning' | 'error' | 'neutral' | 'info'
export interface Chip { tone: Tone; text: string }

export function today(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}
export const hhmm = (iso: string): string => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

const isBad = (s: TaskStatus): boolean => s === 'failed' || s === 'login_expired'

/** 卡片右上角的状态标签 */
export function statusChip(a: AccountView, now = new Date()): Chip {
  if (a.running) return { tone: 'info', text: '签到中…' }
  if (a.loginExpired) return { tone: 'error', text: '需重新登录' }
  if (!a.enabled) return { tone: 'neutral', text: '已暂停' }
  const run = a.lastRun
  if (!run || run.date !== today(now)) return { tone: 'neutral', text: `今天 ${a.time} 签到` }
  const bad = run.results.filter((r) => isBad(r.status)).length
  return bad ? { tone: 'warning', text: `${bad} 项未完成` } : { tone: 'success', text: '今日已完成' }
}

/** 卡片里的一行结果摘要 */
export function summary(run: RunRecord | null): string {
  if (!run) return '还没有运行过，点“立即签到”试试'
  const done = run.results.filter((r) => r.status === 'success' || r.status === 'already').length
  const bad = run.results.filter((r) => isBad(r.status))
  const when = `${run.date === today() ? '今天' : run.date.slice(5)} ${hhmm(run.at)}`
  if (bad.length) return `${when} · ${bad[0].label}：${bad[0].message}`
  return `${when} · ${done}/${run.results.length} 项完成`
}

export const STATUS_TEXT: Record<TaskStatus, string> = { success: '已完成', already: '今日已做过', failed: '未成功', login_expired: '登录失效', skipped: '已跳过' }
export const statusTone = (s: TaskStatus): Tone => (s === 'success' || s === 'already' ? 'success' : s === 'skipped' ? 'neutral' : 'error')
