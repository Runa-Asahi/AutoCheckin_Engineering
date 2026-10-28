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
    for (const ok of ['https://music.163.com/x', 'https://interface.music.163.com/eapi/x', 'https://api.bilibili.com/x', 'https://tieba.baidu.com/', 'https://c.tieba.baidu.com/c']) expect(isAllowedUrl(ok), ok).toBe(true)
    for (const bad of ['http://music.163.com/', 'https://evil.com/', 'https://bilibili.com.evil.com/', 'https://127.0.0.1/', 'https://notbaidu.com/', 'https://www.luogu.com.cn/', 'file:///etc/passwd']) expect(isAllowedUrl(bad), bad).toBe(false)
  })
  it('请求白名单外地址直接拒绝，不发出', async () => {
    await expect(new HttpSession().request({ url: 'https://evil.com/steal' })).rejects.toThrow('白名单')
  })
  it('跳转到白名单外地址被拦截', async () => {
    nock('https://api.bilibili.com').get('/r').reply(302, '', { Location: 'https://evil.com/x' })
    await expect(new HttpSession({}, { retries: 0 }).request({ url: 'https://api.bilibili.com/r' })).rejects.toThrow()
  })
  it('HTTPS 被降级跳转到 http 时拦截，错误里写明目标主机（不含路径/参数）', async () => {
    nock('https://tieba.baidu.com').get('/dc/common/tbs').reply(301, '', { Location: 'http://tieba.baidu.com/dc/common/tbs?red_tag=secret' })
    const error = await new HttpSession({ BDUSS: 'COOKIE_VALUE' }, { retries: 0 }).request({ url: 'https://tieba.baidu.com/dc/common/tbs' }).catch((e: Error) => e)
    expect(String((error as Error).message)).toContain('http://tieba.baidu.com')
    expect(String((error as Error).message)).toContain('降级')
    expect(String((error as Error).message)).not.toMatch(/red_tag|secret|COOKIE_VALUE/)
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

describe('已下线平台的清理', () => {
  it('启动时删除已不支持平台（洛谷）的账号及其登录信息', async () => {
    const { CheckinService } = await import('../src/main/core/service.js')
    const { tempStore } = await import('./helpers.js')
    const { store } = tempStore()
    store.upsertAccount({ platform: 'luogu', uid: '1', nickname: 'x', cookies: { __client_id: 'secret' }, tasks: {} })
    store.upsertAccount({ platform: 'tieba', uid: '2', nickname: 'y', cookies: { BDUSS: 'b' }, tasks: {} })
    const service = new CheckinService(store)
    expect(service.accounts().map((a) => a.platform)).toEqual(['tieba'])
  })
})
