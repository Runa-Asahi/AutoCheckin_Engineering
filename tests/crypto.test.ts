import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { CredentialEncryptor } from '../src/main/security/crypto.js'

describe('CredentialEncryptor', () => {
  it('round-trips encrypted data', () => {
    const crypto = new CredentialEncryptor(randomBytes(32))
    const encrypted = crypto.encrypt('cookie-secret')
    expect(crypto.decrypt(encrypted.ciphertext, encrypted.iv)).toBe('cookie-secret')
  })
  it('rejects a wrong key', () => {
    const encrypted = new CredentialEncryptor(randomBytes(32)).encrypt('secret')
    expect(() => new CredentialEncryptor(randomBytes(32)).decrypt(encrypted.ciphertext, encrypted.iv)).toThrow()
  })
  it('detects tampering', () => {
    const crypto = new CredentialEncryptor(randomBytes(32)), encrypted = crypto.encrypt('secret')
    encrypted.ciphertext[0] ^= 1
    expect(() => crypto.decrypt(encrypted.ciphertext, encrypted.iv)).toThrow()
  })
})
