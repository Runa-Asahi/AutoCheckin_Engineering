import { describe, expect, it } from 'vitest'
import { inspectAdapter } from '../src/main/ai/adapterInspector.js'

const base = { site_id: 'demo', site_name: 'Demo', site_url: 'https://example.com/', engine_type: 'browser', login_type: 'manual', cookie_domains: ['example.com'] }

describe('inspectAdapter', () => {
  it('rejects log-only manual adapters', () => { const report = inspectAdapter({ ...base, steps: [{ type: 'goto', url: 'https://example.com/' }, { type: 'log', message: '请手动完成签到' }], success_rules: [{ type: 'body_includes', value: '签到成功' }] }); expect(report.valid).toBe(false); expect(report.issues.map((item) => item.code)).toContain('manual_only_adapter') })
  it('accepts an executable browser adapter', () => { const report = inspectAdapter({ ...base, steps: [{ type: 'goto', url: 'https://example.com/' }, { type: 'click', selector: '#checkin' }], success_rules: [{ type: 'body_includes', value: '签到成功' }] }); expect(report.valid).toBe(true) })
  it('detects unsupported steps and unsafe captcha automation', () => { const report = inspectAdapter({ ...base, steps: [{ type: 'solve_captcha', selector: '#captcha' }], success_rules: [{ type: 'body_includes', value: 'ok' }] }); expect(report.valid).toBe(false); expect(report.issues.map((item) => item.code)).toContain('step_unsupported') })
})
