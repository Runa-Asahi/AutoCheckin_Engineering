import { afterEach, describe, expect, it, vi } from 'vitest'
import nock from 'nock'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { HttpEngine, cookieVariables } from '../src/main/engine/httpEngine.js'
import { AdapterSchema } from '../src/shared/schemas.js'
import { classifyOutcome } from '../src/main/services/outcomeClassifier.js'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '' } }))
afterEach(() => nock.cleanAll())

describe('通用 HTTP 流程', () => {
  it('支持 pre_requests 提取变量、{{cookie.X}} 模板与表单编码', async () => {
    nock('https://flow.test').get('/token').reply(200, { data: { token: 'tk1' } })
      .post('/sign', 'token=tk1&csrf=abc').reply(200, { code: 0 })
    const adapter = AdapterSchema.parse({
      site_id: 'flow', site_name: 'Flow', site_url: 'https://flow.test', engine_type: 'http', login_type: 'cookie',
      pre_requests: [{ method: 'GET', url: 'https://flow.test/token', extract: { token: 'data.token' } }],
      request: { method: 'POST', url: 'https://flow.test/sign', form: true, body: { token: '{{token}}', csrf: '{{cookie.csrf}}' } },
      success_rules: [{ type: 'json_path', value: { path: 'code', equals: 0 } }],
    })
    const result = await new HttpEngine().execute({ adapter, variables: {}, cookieHeader: 'csrf=abc; sid=1' })
    expect(result.success).toBe(true)
  })
  it('cookieVariables 展开 Cookie', () => {
    expect(cookieVariables('a=1; b=x=y')).toEqual({ 'cookie.a': '1', 'cookie.b': 'x=y' })
  })
})

describe('适配器 Schema', () => {
  it('native 引擎必须声明 plugin', () => {
    expect(AdapterSchema.safeParse({ site_id: 'x', site_name: 'x', site_url: 'https://x.test', engine_type: 'native', login_type: 'cookie' }).success).toBe(false)
  })
  it('非 native 引擎仍需 success_rules', () => {
    expect(AdapterSchema.safeParse({ site_id: 'x', site_name: 'x', site_url: 'https://x.test', engine_type: 'http', login_type: 'cookie', request: { method: 'GET', url: 'https://x.test' } }).success).toBe(false)
  })
  it('所有内置适配器都能通过校验与静态检查', async () => {
    const { inspectAdapter } = await import('../src/main/ai/adapterInspector.js')
    const root = join(process.cwd(), 'resources', 'adapters')
    for (const file of readdirSync(root).filter((name) => name.endsWith('.json'))) {
      const raw = JSON.parse(readFileSync(join(root, file), 'utf8'))
      expect(AdapterSchema.safeParse(raw).success, file).toBe(true)
      const report = inspectAdapter(raw)
      expect(report.issues.filter((issue) => issue.severity === 'error'), file).toEqual([])
    }
  })
})

describe('结果分类', () => {
  it('插件显式 outcome 优先', () => {
    expect(classifyOutcome({ success: false, outcome: 'authentication_required', message: 'x' })).toBe('authentication_required')
  })
})
