import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import nock from 'nock'
import { readFileSync } from 'node:fs'
import { runAccount } from '../src/main/core/runner.js'
import { CheckinService } from '../src/main/core/service.js'
import { noSleep, tempStore } from './helpers.js'

beforeAll(() => nock.disableNetConnect())
afterEach(() => nock.cleanAll())

const WEB = 'https://music.163.com', APP = 'https://interface.music.163.com'
const account = { code: 200, account: { id: 1 }, profile: { nickname: '小明', userId: 1 } }

function setup(tasks = { mobile_sign: true, pc_sign: false }) {
  const { store, path } = tempStore()
  const rec = store.upsertAccount({ platform: 'netease', uid: '1', nickname: '小明', cookies: { MUSIC_U: 'secret-music-u', __csrf: 'c' }, tasks })
  return { store, path, id: rec.id }
}

describe('网易云音乐：执行后必须二次确认', () => {
  it('【回归】签到接口返回 200 但状态仍未签到 → 判定失败，不再误报成功', async () => {
    const { store, id } = setup()
    nock(WEB).post('/weapi/nuser/account/get').query(true).reply(200, account)
      .post('/weapi/v1/user/info').query(true).times(4).reply(200, { code: 200, mobileSign: false, pcSign: false })
    nock(APP).post('/eapi/point/dailyTask').reply(200, { code: 200, point: 3 })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results).toHaveLength(1)
    expect(run.results[0].status).toBe('failed')
    expect(run.results[0].message).toContain('仍未签到')
  })

  it('签到后状态确认已签 → 成功', async () => {
    const { store, id } = setup()
    nock(WEB).post('/weapi/nuser/account/get').query(true).reply(200, account)
      .post('/weapi/v1/user/info').query(true).reply(200, { code: 200, mobileSign: false, pcSign: false })
      .post('/weapi/v1/user/info').query(true).reply(200, { code: 200, mobileSign: true, pcSign: false })
    nock(APP).post('/eapi/point/dailyTask', (body) => typeof body.params === 'string' && /^[0-9A-F]+$/.test(body.params)).reply(200, { code: 200, point: 3 })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0]).toMatchObject({ status: 'success', message: '签到成功，获得 3 积分' })
  })

  it('今天已签（状态接口确认）→ 已完成，不发签到请求', async () => {
    const { store, id } = setup({ mobile_sign: true, pc_sign: true })
    nock(WEB).post('/weapi/nuser/account/get').query(true).reply(200, account)
      .post('/weapi/v1/user/info').query(true).reply(200, { code: 200, mobileSign: true, pcSign: true })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results.map((r) => r.status)).toEqual(['already', 'already'])
    expect(nock.isDone()).toBe(true)
  })

  it('接口说“重复签到”且状态确认 → 已完成', async () => {
    const { store, id } = setup()
    nock(WEB).post('/weapi/nuser/account/get').query(true).reply(200, account)
      .post('/weapi/v1/user/info').query(true).reply(200, { code: 200, mobileSign: false, pcSign: false })
      .post('/weapi/v1/user/info').query(true).reply(200, { code: 200, mobileSign: true, pcSign: false })
    nock(APP).post('/eapi/point/dailyTask').reply(200, { code: -2, msg: '重复签到' })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0].status).toBe('already')
  })

  it('状态接口不返回签到标记 → 失败并说明无法确认', async () => {
    const { store, id } = setup()
    nock(WEB).post('/weapi/nuser/account/get').query(true).reply(200, account)
      .post('/weapi/v1/user/info').query(true).times(4).reply(200, { code: 200 })
    nock(APP).post('/eapi/point/dailyTask').reply(200, { code: 200 })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0].status).toBe('failed')
    expect(run.results[0].message).toContain('无法确认')
  })

  it('登录过期 → 每个任务都标记需重新扫码，账号标记过期', async () => {
    const { store, id } = setup({ mobile_sign: true, pc_sign: true })
    nock(WEB).post('/weapi/nuser/account/get').query(true).reply(200, { code: 301 })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results.map((r) => r.status)).toEqual(['login_expired', 'login_expired'])
    expect(store.account(id).loginExpired).toBe(true)
  })

  it('登录信息加密保存，文件里没有明文 Cookie', () => {
    const { path } = setup()
    expect(readFileSync(path, 'utf8')).not.toContain('secret-music-u')
  })
})

describe('网易云音乐扫码登录', () => {
  it('等待 → 扫码 → 成功，自动保存账号与 Cookie', async () => {
    const { store } = tempStore()
    const service = new CheckinService(store, { sleep: noSleep })
    nock(APP).post('/eapi/login/qrcode/unikey').reply(200, { code: 200, unikey: 'KEY1' })
      .post('/eapi/login/qrcode/client/login').reply(200, { code: 801 })
      .post('/eapi/login/qrcode/client/login').reply(200, { code: 802, nickname: '小明' })
      .post('/eapi/login/qrcode/client/login').reply(200, { code: 803 }, { 'Set-Cookie': ['MUSIC_U=new-token; Path=/', '__csrf=cs; Path=/'] })
    nock(WEB).post('/weapi/nuser/account/get').query(true).reply(200, account)
    const start = await service.startQrLogin('netease')
    expect(start.image).toMatch(/^data:image\/png;base64,/)
    expect((await service.pollQrLogin(start.sessionId)).state).toBe('waiting')
    expect((await service.pollQrLogin(start.sessionId)).message).toContain('小明')
    const done = await service.pollQrLogin(start.sessionId)
    expect(done.state).toBe('success')
    const saved = store.accounts()[0]
    expect(store.cookies(saved).MUSIC_U).toBe('new-token')
    expect(done.account?.tasks).toEqual({ mobile_sign: true, pc_sign: true })
  })
  it('二维码过期', async () => {
    const { store } = tempStore()
    const service = new CheckinService(store)
    nock(APP).post('/eapi/login/qrcode/unikey').reply(200, { code: 200, unikey: 'K' }).post('/eapi/login/qrcode/client/login').reply(200, { code: 800 })
    const start = await service.startQrLogin('netease')
    expect((await service.pollQrLogin(start.sessionId)).state).toBe('expired')
  })
})

describe('网易云手机端签到：模拟安卓 App，并回退云贝签到', () => {
  it('安卓身份签到后状态仍未签 → 回退云贝签到 → 状态确认 → 成功', async () => {
    const { store, id } = setup()
    const seen: Array<{ cookie: string; ua: string }> = []
    nock(WEB).post('/weapi/nuser/account/get').query(true).reply(200, account)
      .post('/weapi/v1/user/info').query(true).times(4).reply(200, { code: 200, mobileSign: false, pcSign: true })
      .post('/weapi/pointmall/user/sign').query(true).reply(200, { code: 200, data: { point: 5 } })
      .post('/weapi/v1/user/info').query(true).reply(200, { code: 200, mobileSign: true, pcSign: true })
    nock(APP).post('/eapi/point/dailyTask').reply(function () {
      seen.push({ cookie: String(this.req.headers.cookie), ua: String(this.req.headers['user-agent']) }); return [200, { code: 200, point: 3 }]
    })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(seen[0].cookie).toContain('os=android')
    expect(seen[0].cookie).toContain('channel=xiaomi')
    expect(seen[0].cookie).toContain('MUSIC_U=secret-music-u')
    expect(seen[0].ua).toContain('Android')
    expect(run.results[0]).toMatchObject({ status: 'success', message: '签到成功，获得 5 积分' })
  })

  it('两种方式都没让状态变成已签 → 失败，并分别说明', async () => {
    const { store, id } = setup()
    nock(WEB).post('/weapi/nuser/account/get').query(true).reply(200, account)
      .post('/weapi/v1/user/info').query(true).times(7).reply(200, { code: 200, mobileSign: false, pcSign: false })
      .post('/weapi/pointmall/user/sign').query(true).reply(200, { code: 400, msg: '参数错误' })
    nock(APP).post('/eapi/point/dailyTask').reply(200, { code: 200 })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0].status).toBe('failed')
    expect(run.results[0].message).toContain('安卓 App 签到：接口返回成功，但平台状态显示仍未签到')
    expect(run.results[0].message).toContain('App 云贝签到：平台返回 参数错误')
  })

  it('电脑端签到保持 alpha.1 已验证的请求方式（PC 设备头）', async () => {
    const { store, id } = setup({ mobile_sign: false, pc_sign: true })
    let cookie = ''
    nock(WEB).post('/weapi/nuser/account/get').query(true).reply(200, account)
      .post('/weapi/v1/user/info').query(true).reply(200, { code: 200, mobileSign: false, pcSign: false })
      .post('/weapi/v1/user/info').query(true).reply(200, { code: 200, mobileSign: false, pcSign: true })
    nock(APP).post('/eapi/point/dailyTask').reply(function () { cookie = String(this.req.headers.cookie); return [200, { code: 200, point: 8 }] })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(cookie).toContain('os=pc')
    expect(run.results[0]).toMatchObject({ status: 'success', message: '签到成功，获得 8 积分' })
  })
})
