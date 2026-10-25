import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import nock from 'nock'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HttpSession, isAllowedUrl } from '../src/main/core/http.js'
import { createLocalKeyCipher } from '../src/main/core/localCipher.js'
import { Store } from '../src/main/core/store.js'
import { filePersistence } from '../src/main/core/filePersistence.js'

beforeAll(() => nock.disableNetConnect())
afterEach(() => nock.cleanAll())

describe('网络白名单', () => {
  it('只允许官方域名的 HTTPS', () => {
    for (const ok of ['https://music.163.com/x', 'https://interface.music.163.com/eapi/x', 'https://api.bilibili.com/x', 'https://tieba.baidu.com/', 'https://c.tieba.baidu.com/c', 'https://www.luogu.com.cn/']) expect(isAllowedUrl(ok), ok).toBe(true)
    for (const bad of ['http://music.163.com/', 'https://evil.com/', 'https://bilibili.com.evil.com/', 'https://127.0.0.1/', 'https://notbaidu.com/', 'file:///etc/passwd']) expect(isAllowedUrl(bad), bad).toBe(false)
  })
  it('请求白名单外地址直接拒绝，不发出', async () => {
    await expect(new HttpSession().request({ url: 'https://evil.com/steal' })).rejects.toThrow('白名单')
  })
  it('跳转到白名单外地址被拦截', async () => {
    nock('https://api.bilibili.com').get('/r').reply(302, '', { Location: 'https://evil.com/x' })
    await expect(new HttpSession({}, { retries: 0 }).request({ url: 'https://api.bilibili.com/r' })).rejects.toThrow()
  })
})

describe('本地密钥加密兜底', () => {
  it('AES-256-GCM，密钥文件 0600，密文不含明文，可解密，篡改会失败', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-key-'))
    const cipher = createLocalKeyCipher(join(dir, 'local.key'))
    const enc = cipher.encrypt('{"SESSDATA":"secret-value"}')
    expect(enc.startsWith('gcm:')).toBe(true)
    expect(enc).not.toContain('secret-value')
    expect(cipher.decrypt(enc)).toBe('{"SESSDATA":"secret-value"}')
    if (process.platform !== 'win32') expect(statSync(join(dir, 'local.key')).mode & 0o777).toBe(0o600)
    const tampered = `gcm:${Buffer.from(Buffer.from(enc.slice(4), 'base64').map((b, i) => i === 40 ? b ^ 1 : b)).toString('base64')}`
    expect(() => cipher.decrypt(tampered)).toThrow()
    // 同一密钥文件重新加载仍可解密
    expect(createLocalKeyCipher(join(dir, 'local.key')).decrypt(enc)).toBe('{"SESSDATA":"secret-value"}')
  })
  it('数据文件里没有明文 Cookie', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-store-'))
    const store = new Store(filePersistence(join(dir, 'data.json')), createLocalKeyCipher(join(dir, 'local.key')))
    store.upsertAccount({ platform: 'bilibili', uid: '1', nickname: 'n', cookies: { SESSDATA: 'plain-secret' }, tasks: {} })
    expect(readFileSync(join(dir, 'data.json'), 'utf8')).not.toContain('plain-secret')
  })
})
