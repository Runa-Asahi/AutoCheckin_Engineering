import { describe, expect, it } from 'vitest'
import { compileAdapterSteps } from '../src/main/browser/adapterScriptParser.js'

describe('AdapterScriptParser', () => {
  it('compiles enhanced nested steps and variables', () => {
    const result = compileAdapterSteps([{ type: 'condition', check: { selector_text: '{{label}}' }, then: [{ type: 'retry', max_attempts: 2, steps: [{ type: 'click', selector: '#{{button}}' }] }], else: [{ type: 'try_catch', try: [{ type: 'log', message: 'skip' }], catch: [] }] }], { label: '签到', button: 'sign' })
    expect((result[0].check as Record<string,string>).selector_text).toBe('签到')
    expect((((result[0].then as Array<Record<string,unknown>>)[0].steps as Array<Record<string,unknown>>)[0].selector)).toBe('#sign')
  })
  it('rejects unknown steps and unsafe retry counts', () => {
    expect(() => compileAdapterSteps([{ type: 'eval_script' }], {})).toThrow(/不支持/)
    expect(() => compileAdapterSteps([{ type: 'retry', max_attempts: 99, steps: [] }], {})).toThrow(/1-10/)
  })
})
