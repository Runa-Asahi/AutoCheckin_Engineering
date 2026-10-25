import type { Adapter } from '../../shared/schemas.js'
import type { CheckinOutcome } from '../../shared/types.js'

export type { CheckinOutcome }

const manualPattern = /验证码|captcha|人机验证|安全验证|请完成验证|人工确认|没有出现可点击|没有等到页面上的目标控件|请在右侧提示中手动/i
const authPattern = /未登录|请先登录|请登录|登录失效|登录已过期|登录状态已失效|仍要求登录|需要重新登录|authentication|HTTP 401|status(?: code)? 401/i
const selectorMissPattern = /locator\.waitFor|waiting for locator|waitForFunction: Timeout/i
const notReadyPattern = /尚未开放|未开放|还未开始|未到签到|签到未开始|稍后再试|not ready|签到时间未到|今日签到尚未/i
const retryablePattern = /timeout|timed out|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|socket hang up|网络|超时|HTTP 502|HTTP 503|HTTP 504/i
const alreadyPattern = /已签到|今日已签|已经签到|已领取|签到成功/
const negativeAlreadyPattern = /未签到|尚未签到|签到失败|没有签到/

export function classifyOutcome(input: { success: boolean; outcome?: CheckinOutcome; message?: string; responseSummary?: string; failureRules?: Adapter['failure_rules'] }): CheckinOutcome {
  const text = `${input.message ?? ''}\n${input.responseSummary ?? ''}`
  if (input.outcome) return input.outcome
  if (input.success || (alreadyPattern.test(text) && !negativeAlreadyPattern.test(text))) return 'success'
  for (const rule of input.failureRules ?? []) {
    const matched = rule.type === 'body_regex' ? safeRegex(rule.value).test(text) : text.includes(rule.value)
    if (matched) return rule.outcome
  }
  if (manualPattern.test(text)) return 'manual_action_required'
  if (authPattern.test(text)) return 'authentication_required'
  if (notReadyPattern.test(text)) return 'not_ready'
  if (selectorMissPattern.test(text)) return 'manual_action_required'
  if (retryablePattern.test(text)) return 'retryable_error'
  return 'permanent_failure'
}

function safeRegex(source: string): RegExp {
  try { return new RegExp(source, 'i') } catch { return /$^/ }
}
