import { describe, expect, it } from 'vitest'
import { explainBrowserFailure, pageLooksLikeLogin } from '../src/shared/browserFailure.js'

describe('browser failure explanations', () => {
  it('turns a missing OpenASI check-in button into a manual next step', () => {
    const raw = 'locator.waitFor: Timeout 30000ms exceeded.\nCall log:\n- waiting for locator(\'button:has-text("签到")\') to be visible'
    expect(explainBrowserFailure(raw, 'https://app.openasi.bitmiracle.cn/dashboard', '仪表盘')).toContain('没有出现可点击的签到按钮')
    expect(explainBrowserFailure(raw)).not.toContain('Timeout')
  })

  it('recognizes the OpenASI login screen', () => {
    expect(pageLooksLikeLogin('https://app.openasi.bitmiracle.cn/login', '邮箱 密码')).toBe(true)
    expect(pageLooksLikeLogin('https://app.openasi.bitmiracle.cn/dashboard', '仪表盘 签到')).toBe(false)
    expect(explainBrowserFailure('locator.waitFor: Timeout 30000ms exceeded.', 'https://app.openasi.bitmiracle.cn/login', '邮箱 密码')).toContain('登录状态已失效')
  })
})
