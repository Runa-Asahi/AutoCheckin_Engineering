import { describe, expect, it } from 'vitest'
import { sanitizeLog } from '../src/main/security/logSanitizer.js'
import { buildVariables, renderTemplate } from '../src/main/engine/variableTemplate.js'

describe('security utilities', () => {
  it('redacts sensitive log values', () => {
    expect(sanitizeLog('Authorization: Bearer-123 password=hunter2')).not.toContain('Bearer-123')
    expect(sanitizeLog('token=abc123')).not.toContain('abc123')
  })
  it('renders nested variables', () => {
    expect(renderTemplate({ url: '/u/{{ user }}', body: ['{{token}}'] }, { user: 'alice', token: 'x' })).toEqual({ url: '/u/alice', body: ['x'] })
  })
  it('provides builtins while allowing explicit overrides', () => {
    const vars = buildVariables({ date: 'custom', token: 'x' }, new Date('2026-08-11T00:00:00Z'))
    expect(vars.date).toBe('custom')
    expect(vars.timestamp).toBeTruthy()
  })
})
