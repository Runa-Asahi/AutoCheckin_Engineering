import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '' } }))

describe('AdapterRegistry compatibility upgrades', () => {
  it('upgrades legacy OpenASI adapters to persistent browser automation', async () => {
    const { upgradeAdapterForRuntime } = await import('../src/main/adapters/adapterRegistry.js')
    const adapter = upgradeAdapterForRuntime({
      site_id: 'openasi', site_name: 'OpenASI', site_url: 'https://app.openasi.bitmiracle.cn/login',
      engine_type: 'browser', login_type: 'manual',
      steps: [{ type: 'goto', url: 'https://app.openasi.bitmiracle.cn/login' }, { type: 'click', selector: 'text=签到' }],
      success_rules: [{ type: 'body_regex', value: '签到成功' }], success_logic: 'or', cookie_domains: ['app.openasi.bitmiracle.cn'],
    })
    expect(adapter.login_type).toBe('local_browser')
    expect(adapter.site_url).toBe('https://app.openasi.bitmiracle.cn/dashboard')
    const steps = JSON.stringify(adapter.steps)
    expect(steps).toContain('login_page')
    expect(steps).toContain('button.w-full')
    expect(adapter.success_rules[0].value).toContain('已签到')
  })
})
