import { describe, expect, it } from 'vitest'
import { isDue } from '../src/main/core/runner.js'
import type { RunRecord } from '../src/shared/types.js'

const tz = 'Asia/Shanghai'
const at = (iso: string) => new Date(iso)
const run = (iso: string, status: 'success' | 'failed', attempt = 1): RunRecord => ({ at: iso, date: '2026-10-25', trigger: 'schedule', attempt, results: [{ taskId: 't', label: 't', status, message: '' }] })
const base = { enabled: true, time: '08:00', loginExpired: false, history: [] as RunRecord[] }

describe('每日调度', () => {
  it('未到时间不运行，到点运行', () => {
    expect(isDue(base, at('2026-10-24T23:59:00Z'), tz)).toBe(false) // 07:59 上海
    expect(isDue(base, at('2026-10-25T00:00:00Z'), tz)).toBe(true)
  })
  it('今天成功后不再运行', () => {
    expect(isDue({ ...base, history: [run('2026-10-25T00:01:00Z', 'success')] }, at('2026-10-25T05:00:00Z'), tz)).toBe(false)
  })
  it('失败后 30 分钟重试，最多 3 次', () => {
    const failed = [run('2026-10-25T00:01:00Z', 'failed')]
    expect(isDue({ ...base, history: failed }, at('2026-10-25T00:20:00Z'), tz)).toBe(false)
    expect(isDue({ ...base, history: failed }, at('2026-10-25T00:31:00Z'), tz)).toBe(true)
    expect(isDue({ ...base, history: [run('2026-10-25T01:00:00Z', 'failed', 3)] }, at('2026-10-25T05:00:00Z'), tz)).toBe(false)
  })
  it('登录过期或关闭时不运行', () => {
    expect(isDue({ ...base, loginExpired: true }, at('2026-10-25T05:00:00Z'), tz)).toBe(false)
    expect(isDue({ ...base, enabled: false }, at('2026-10-25T05:00:00Z'), tz)).toBe(false)
  })
})
