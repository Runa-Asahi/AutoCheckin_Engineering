import { describe, expect, it } from 'vitest'
import { AdapterSchema } from '../src/shared/schemas.js'
import { normalizeGeneratedAdapter } from '../src/main/ai/adapterNormalizer.js'

const base = { site_id: 'demo', site_name: 'Demo', site_url: 'https://example.com', engine_type: 'browser', login_type: 'manual', cookie_domains: ['example.com'] }

describe('normalizeGeneratedAdapter', () => {
  it('normalizes common model aliases and fills values from alternate fields', () => {
    const normalized = normalizeGeneratedAdapter({ ...base, success_rules: [{ type: 'text_contains', text: '签到成功' }, { type: 'status_code', status: 200 }, { type: 'jsonPath', path: 'data.ok', expected: true }] }, base.site_url)
    const adapter = AdapterSchema.parse(normalized)
    expect(adapter.success_rules).toEqual([
      { type: 'body_includes', value: '签到成功' },
      { type: 'status', value: 200 },
      { type: 'json_path', value: { path: 'data.ok', equals: true } },
    ])
  })

  it('drops unusable rules and supplies a reviewable fallback', () => {
    const adapter = AdapterSchema.parse(normalizeGeneratedAdapter({ ...base, success_rules: [{ type: 'element_exists', selector: '#success' }] }, base.site_url))
    expect(adapter.success_rules).toHaveLength(1)
    expect(adapter.success_rules[0].type).toBe('body_regex')
  })

  it('accepts camelCase root fields produced by some models', () => {
    const adapter = AdapterSchema.parse(normalizeGeneratedAdapter({ siteId: 'demo', siteName: 'Demo', siteUrl: 'https://example.com', engineType: 'http', loginType: 'cookie', successRules: [{ type: 'body_contains', value: 'ok' }] }, base.site_url))
    expect(adapter.site_id).toBe('demo')
    expect(adapter.success_rules[0]).toEqual({ type: 'body_includes', value: 'ok' })
  })
})
