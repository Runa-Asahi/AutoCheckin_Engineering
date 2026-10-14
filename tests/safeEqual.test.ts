import { describe, expect, it } from 'vitest'
import { MasterPasswordManager, safeEqual } from '../src/main/security/crypto.js'

describe('safeEqual', () => {
  it('matches equal strings and rejects different ones', () => {
    expect(safeEqual('correct horse', 'correct horse')).toBe(true)
    expect(safeEqual('correct horse', 'correct horsf')).toBe(false)
  })
  it('handles different lengths without throwing', () => {
    expect(safeEqual('short', 'a much longer password')).toBe(false)
    expect(safeEqual('', 'x')).toBe(false)
    expect(safeEqual('密码一二三', '密码一二三')).toBe(true)
  })
  it('is used by verifyMasterPassword for remembered passwords', async () => {
    const remembered = { get: async () => 'remembered-pass', set: async () => {} }
    const manager = new MasterPasswordManager('/nonexistent-autocheckin-test', null, remembered)
    expect(await manager.verifyMasterPassword('remembered-pass')).toBe(true)
    expect(await manager.verifyMasterPassword('remembered-pas')).toBe(false)
  })
})
