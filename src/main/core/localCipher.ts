import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Cipher } from './store.js'

/**
 * 系统钥匙串不可用时（例如没有 libsecret 的 Linux）的本地加密兜底：
 * AES-256-GCM，密钥为 32 字节随机数，单独保存在用户数据目录、权限 0600。
 * 这比钥匙串弱（拿到整个用户目录的人可以解密），界面会明确提示用户。绝不明文保存。
 */
export function createLocalKeyCipher(keyPath: string): Cipher {
  let key: Buffer
  if (existsSync(keyPath)) key = readFileSync(keyPath)
  else {
    mkdirSync(dirname(keyPath), { recursive: true })
    key = randomBytes(32)
    writeFileSync(keyPath, key, { mode: 0o600 })
  }
  try { chmodSync(keyPath, 0o600) } catch { /* Windows 上忽略 */ }
  if (key.length !== 32) throw new Error('本地加密密钥文件已损坏')
  return {
    encrypt(plain) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      return `gcm:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`
    },
    decrypt(value) {
      if (!value.startsWith('gcm:')) throw new Error('不支持的加密格式')
      const raw = Buffer.from(value.slice(4), 'base64')
      const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
      decipher.setAuthTag(raw.subarray(12, 28))
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
    },
  }
}
