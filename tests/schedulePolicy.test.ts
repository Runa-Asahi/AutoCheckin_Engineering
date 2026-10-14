import { afterAll, describe, expect, it } from 'vitest'
import { calendarDaysBetween, computeConsecutiveDays, endOfLocalDay, localDateKey } from '../src/shared/localTime.js'
import { presentSchedule } from '../src/shared/scheduleView.js'
import { classifyOutcome } from '../src/main/services/outcomeClassifier.js'
import { closeAllCronProbes, describeCycle, evaluateSchedule, getCronProbe, planAfterOutcome } from '../src/main/services/schedulePolicy.js'

const shanghai = 'Asia/Shanghai'
const at = (value: string) => new Date(value)

describe('local dates and consecutive days', () => {
  it('uses the task timezone instead of the UTC date', () => {
    const lateEvening = at('2026-10-13T15:30:00.000Z')
    const afterMidnight = at('2026-10-13T16:30:00.000Z')
    expect(localDateKey(lateEvening, shanghai)).toBe('2026-10-13')
    expect(localDateKey(afterMidnight, shanghai)).toBe('2026-10-14')
    expect(lateEvening.toISOString().slice(0, 10)).toBe(afterMidnight.toISOString().slice(0, 10))
    expect(computeConsecutiveDays('2026-10-13T15:30:00.000Z', afterMidnight, shanghai, 4)).toBe(5)
    expect(computeConsecutiveDays('2026-10-13T15:30:00.000Z', afterMidnight, 'UTC', 4)).toBe(4)
  })

  it('resets the streak when a local day is skipped and keeps the same local day', () => {
    expect(computeConsecutiveDays('2026-10-11T00:00:00.000Z', at('2026-10-13T02:00:00.000Z'), shanghai, 6)).toBe(1)
    expect(computeConsecutiveDays('2026-10-13T00:30:00.000Z', at('2026-10-13T09:00:00.000Z'), shanghai, 3)).toBe(3)
    expect(calendarDaysBetween('2026-03-08', '2026-03-09')).toBe(1)
  })

  it('finds the end of a local day across a daylight-saving transition', () => {
    const beforeJump = at('2026-03-08T06:30:00.000Z')
    expect(localDateKey(beforeJump, 'America/New_York')).toBe('2026-03-08')
    const end = endOfLocalDay(beforeJump, 'America/New_York')
    expect(localDateKey(new Date(end.getTime() - 1000), 'America/New_York')).toBe('2026-03-08')
    expect(localDateKey(end, 'America/New_York')).toBe('2026-03-09')
  })
})

describe('check-in outcome classification', () => {
  it('accepts an already-signed page and rejects a mere page load', () => {
    expect(classifyOutcome({ success: false, message: '今日已签到' })).toBe('success')
    expect(classifyOutcome({ success: true, message: '签到成功或今日已完成' })).toBe('success')
    expect(classifyOutcome({ success: false, message: '页面已打开', responseSummary: 'HTTP 200' })).toBe('permanent_failure')
    expect(classifyOutcome({ success: false, message: '未匹配成功规则（HTTP 200）' })).toBe('permanent_failure')
  })

  it('separates not-ready, network, login and manual verification', () => {
    expect(classifyOutcome({ success: false, message: '今日签到尚未开放' })).toBe('not_ready')
    expect(classifyOutcome({ success: false, message: 'connect ETIMEDOUT 10.0.0.8:443' })).toBe('retryable_error')
    expect(classifyOutcome({ success: false, message: '登录已过期' })).toBe('authentication_required')
    expect(classifyOutcome({ success: false, message: '请完成验证码' })).toBe('manual_action_required')
    expect(classifyOutcome({ success: false, message: '登录状态已失效或当前页面仍要求登录，请重新点击“引导登录并完成首次签到”。' })).toBe('authentication_required')
    expect(classifyOutcome({ success: false, message: 'locator.waitFor: Timeout 30000ms exceeded.\nwaiting for locator(\'button:has-text("签到")\')' })).toBe('manual_action_required')
    expect(classifyOutcome({ success: false, message: 'page.goto: Timeout 30000ms exceeded.' })).toBe('retryable_error')
    expect(classifyOutcome({ success: false, message: '尚未开放', failureRules: [{ type: 'body_includes', value: '尚未开放', outcome: 'not_ready' }] })).toBe('not_ready')
  })
})

describe('schedule decisions', () => {
  afterAll(() => closeAllCronProbes())

  it('does not run a daily 08:00 task at 07:00', () => {
    const now = at('2026-10-12T23:00:00.000Z')
    const probe = getCronProbe('0 8 * * *', shanghai)
    expect(describeCycle(shanghai, now, probe)).toBeNull()
    expect(evaluateSchedule({ now, timeZone: shanghai, expression: '0 8 * * *', state: null, successes: [], probe }).type).toBe('wait')
  })

  it('catches up once at 10:00 and skips a later slot that already succeeded', () => {
    const probe = getCronProbe('0 8 * * *', shanghai)
    const ten = at('2026-10-13T02:00:00.000Z')
    const due = evaluateSchedule({ now: ten, timeZone: shanghai, expression: '0 8 * * *', state: null, successes: [], probe })
    expect(due.type).toBe('run')
    const done = evaluateSchedule({ now: ten, timeZone: shanghai, expression: '0 8 * * *', state: null, successes: [{ executed_at: '2026-10-13T01:00:00.000Z', cycle_key: null }], probe })
    expect(done).toMatchObject({ type: 'skip' })
  })

  it('does not backfill every missed day after the computer was off', () => {
    const probe = getCronProbe('0 8 * * *', shanghai)
    const now = at('2026-10-16T02:00:00.000Z')
    const decision = evaluateSchedule({ now, timeZone: shanghai, expression: '0 8 * * *', state: null, successes: [], probe })
    expect(decision.type).toBe('run')
    if (decision.type === 'run') expect(decision.cycle.localDate).toBe('2026-10-16')
  })

  it('keeps two slots on the same day distinct', () => {
    const probe = getCronProbe('0 8,20 * * *', shanghai)
    const evening = at('2026-10-13T13:30:00.000Z')
    const decision = evaluateSchedule({
      now: evening, timeZone: shanghai, expression: '0 8,20 * * *', state: null,
      successes: [{ executed_at: '2026-10-13T01:30:00.000Z', cycle_key: null }], probe,
    })
    expect(decision.type).toBe('run')
    if (decision.type === 'run') expect(decision.cycle.localDate).toBe('2026-10-13')
  })

  it('stops retrying when the next delay would pass the slot window', () => {
    const plan = planAfterOutcome({
      outcome: 'not_ready', attemptCount: 0, now: at('2026-10-13T10:25:00.000Z'), windowEnd: at('2026-10-13T10:30:00.000Z'), jitterMs: 0,
    })
    expect(plan.status).toBe('failed')
    expect(plan.nextRetryAt).toBeNull()
  })

  it('does not poll for login or manual verification', () => {
    expect(planAfterOutcome({ outcome: 'authentication_required', attemptCount: 0, now: at('2026-10-13T02:00:00.000Z'), windowEnd: at('2026-10-13T16:00:00.000Z') }).status).toBe('manual')
    expect(planAfterOutcome({ outcome: 'manual_action_required', attemptCount: 1, now: at('2026-10-13T02:00:00.000Z'), windowEnd: at('2026-10-13T16:00:00.000Z') }).nextRetryAt).toBeNull()
  })
})

describe('schedule presentation', () => {
  it('labels the current cycle and does not treat yesterday as today', () => {
    const now = at('2026-10-13T02:00:00.000Z')
    expect(presentSchedule({ schedule_state: { status: 'retrying', message: null, next_retry_at: now.toISOString(), scheduled_at: null, attempt_count: 1, outcome: 'not_ready', succeeded: false, local_date: '2026-10-13', timezone: shanghai } }, now).label).toBe('等待重试')
    expect(presentSchedule({ last_status: 'success', schedule_state: { status: 'success', message: null, next_retry_at: null, scheduled_at: null, attempt_count: 1, outcome: 'success', succeeded: true, local_date: '2026-10-12', timezone: shanghai } }, now).label).toBe('最近成功')
  })
})
