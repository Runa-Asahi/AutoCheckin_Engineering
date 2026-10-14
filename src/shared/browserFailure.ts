const AUTH_MESSAGE = '登录状态已失效或当前页面仍要求登录，请重新点击“引导登录并完成首次签到”。'
const MISSING_CHECKIN = '页面上没有出现可点击的签到按钮。请在右侧提示中手动完成登录和签到，或查看失败原因并生成修复方案。'
const MISSING_CONTROL = '自动步骤没有等到页面上的目标控件。请在右侧提示中手动完成这次操作，或查看失败原因并生成修复方案。'

export function pageLooksLikeLogin(url: string, body: string): boolean {
  if (/\/login|\/signin|\/sign-in/i.test(url)) return true
  if (/仪表盘/.test(body) && /签到/.test(body)) return false
  return /请先登录|未登录|需要登录|sign in|log in/i.test(body) || (/登录/.test(body) && /密码|邮箱/.test(body))
}

export function explainBrowserFailure(message: string, url = '', body = ''): string {
  if (pageLooksLikeLogin(url, body)) return AUTH_MESSAGE
  const selectorMiss = /locator\.waitFor|waiting for locator|waitForFunction: Timeout/i.test(message)
  if (selectorMiss && /签到/.test(`${message}\n${body}`)) return MISSING_CHECKIN
  if (selectorMiss) return MISSING_CONTROL
  const compact = message.replace(/\s+/g, ' ').trim()
  return compact.length > 180 ? `${compact.slice(0, 180)}…` : compact
}
