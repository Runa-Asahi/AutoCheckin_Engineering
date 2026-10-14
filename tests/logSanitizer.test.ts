import { describe, expect, it } from 'vitest'
import { sanitizeLog } from '../src/main/security/logSanitizer.js'

describe('sanitizeLog', () => {
  it('redacts secrets inside JSON-serialized objects', () => {
    const out = sanitizeLog({ password: 'hunter2', token: 'abc123', api_key: 'sk-xyz', headers: { Authorization: 'Bearer tok-999', Cookie: 'sid=1; uid=2' }, ok: true })
    for (const secret of ['hunter2', 'abc123', 'sk-xyz', 'tok-999', 'sid=1']) expect(out).not.toContain(secret)
    expect(out).toContain('"ok":true')
    expect(() => JSON.parse(out)).not.toThrow()
  })
  it('drops the credential after an auth scheme', () => {
    const out = sanitizeLog('Authorization: Bearer xyz123')
    expect(out).not.toContain('xyz123')
    expect(out).toContain('Bearer ***')
  })
  it('redacts query-string style secrets', () => {
    expect(sanitizeLog('https://x.test/sign?access_token=t0k&day=1')).toBe('https://x.test/sign?access_token=***&day=1')
  })
  it('keeps non-sensitive text intact and caps length', () => {
    expect(sanitizeLog('签到成功 status=200')).toBe('签到成功 status=200')
    expect(sanitizeLog('a'.repeat(5000))).toHaveLength(4000)
  })
})
