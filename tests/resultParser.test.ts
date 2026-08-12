import { describe, expect, it } from 'vitest'
import { parseResult } from '../src/main/engine/resultParser.js'

describe('result parser', () => {
  it('matches status, text and regex rules', () => {
    expect(parseResult([{ type: 'status', value: 200 }], { status: 200, body: '' })).toBe(true)
    expect(parseResult([{ type: 'body_includes', value: 'done' }], { status: 500, body: 'already done' })).toBe(true)
    expect(parseResult([{ type: 'body_regex', value: 'success|完成' }], { status: 200, body: '签到完成' })).toBe(true)
  })
  it('reads JSON paths', () => {
    expect(parseResult([{ type: 'json_path', value: { path: 'data.ok', equals: true } }], { status: 200, body: { data: { ok: true } } })).toBe(true)
  })
  it('supports explicit AND/OR logic', () => {
    const rules = [{ type: 'status' as const, value: 200 }, { type: 'body_includes' as const, value: 'ok' }]
    expect(parseResult(rules, { status: 200, body: 'failed' }, 'and')).toBe(false)
    expect(parseResult(rules, { status: 200, body: 'failed' }, 'or')).toBe(true)
  })
})
