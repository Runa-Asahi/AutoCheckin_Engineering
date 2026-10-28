import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import nock from 'nock'
import { runAccount } from '../src/main/core/runner.js'
import { CheckinService } from '../src/main/core/service.js'
import { noSleep, tempStore } from './helpers.js'

beforeAll(() => nock.disableNetConnect())
afterEach(() => nock.cleanAll())

const API = 'https://api.bilibili.com', MANGA = 'https://manga.bilibili.com'
const nav = { code: 0, data: { isLogin: true, mid: 42, uname: '小红' } }
const popular = { code: 0, data: { list: [{ aid: 1, bvid: 'BV1', cid: 11, duration: 100, owner: { mid: 7 } }, { aid: 2, bvid: 'BV2', cid: 22, owner: { mid: 8 } }] } }
const reward = (watch: boolean, share: boolean, coins = 0) => ({ code: 0, data: { login: true, watch, share, coins } })

function setup(tasks: Record<string, boolean>) {
  const { store } = tempStore()
  return { store, id: store.upsertAccount({ platform: 'bilibili', uid: '42', nickname: '小红', cookies: { SESSDATA: 's', bili_jct: 'jct', buvid3: 'b', _uuid: 'U' }, tasks }).id }
}

describe('哔哩哔哩：执行后查询任务状态确认', () => {
  it('观看/分享/投币请求成功且状态确认 → 成功；漫画已签 → 已完成', async () => {
    const { store, id } = setup({ watch: true, share: true, coin: true, manga: true })
    nock(API).get('/x/web-interface/nav').reply(200, nav)
      .get('/x/member/web/exp/reward').reply(200, reward(false, false))
      .get('/x/web-interface/popular').query(true).reply(200, popular)
      .post('/x/click-interface/web/heartbeat', (b) => b.csrf === 'jct').reply(200, { code: 0 })
      .get('/x/member/web/exp/reward').reply(200, reward(true, false))
      .post('/x/web-interface/share/add').reply(200, { code: 0 })
      .get('/x/member/web/exp/reward').reply(200, reward(true, true))
      .post('/x/web-interface/coin/add', (b) => b.aid === '1').reply(200, { code: 34005 })
      .post('/x/web-interface/coin/add', (b) => b.aid === '2').reply(200, { code: 0 })
      .get('/x/member/web/exp/reward').reply(200, reward(true, true, 10))
    nock(MANGA).post('/twirp/activity.v1.Activity/GetClockInInfo').reply(200, { code: 0, data: { status: 1 } })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(Object.fromEntries(run.results.map((r) => [r.taskId, r.status]))).toEqual({ watch: 'success', share: 'success', coin: 'success', manga: 'already' })
    expect(nock.isDone()).toBe(true)
  })

  it('【回归同类】请求返回 code 0 但任务状态一直未完成 → 失败', async () => {
    const { store, id } = setup({ watch: true, share: false, coin: false, manga: false })
    nock(API).get('/x/web-interface/nav').reply(200, nav)
      .get('/x/member/web/exp/reward').reply(200, reward(false, false))
      .get('/x/web-interface/popular').query(true).reply(200, popular)
      .post('/x/click-interface/web/heartbeat').reply(200, { code: 0 })
      .get('/x/member/web/exp/reward').times(4).reply(200, reward(false, false))
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0].status).toBe('failed')
    expect(run.results[0].message).toContain('未显示完成')
  })

  it('今日任务都已完成 → 不再请求视频', async () => {
    const { store, id } = setup({ watch: true, share: true, coin: false, manga: false })
    nock(API).get('/x/web-interface/nav').reply(200, nav).get('/x/member/web/exp/reward').reply(200, reward(true, true))
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results.map((r) => r.status)).toEqual(['already', 'already'])
  })

  it('漫画签到后状态确认', async () => {
    const { store, id } = setup({ watch: false, share: false, coin: false, manga: true })
    nock(API).get('/x/web-interface/nav').reply(200, nav).get('/x/member/web/exp/reward').reply(200, reward(true, true))
    nock(MANGA).post('/twirp/activity.v1.Activity/GetClockInInfo').reply(200, { code: 0, data: { status: 0 } })
      .post('/twirp/activity.v1.Activity/ClockIn').reply(200, { code: 0 })
      .post('/twirp/activity.v1.Activity/GetClockInInfo').reply(200, { code: 0, data: { status: 1 } })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0].status).toBe('success')
  })

  it('SESSDATA 过期（-101）→ 需重新扫码', async () => {
    const { store, id } = setup({ watch: true, share: true, coin: false, manga: true })
    nock(API).get('/x/web-interface/nav').reply(200, { code: -101, data: { isLogin: false } })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results.every((r) => r.status === 'login_expired')).toBe(true)
    expect(store.account(id).loginExpired).toBe(true)
  })

  it('412 风控 → 失败并说明原因（不重试轰炸）', async () => {
    const { store, id } = setup({ watch: true, share: false, coin: false, manga: false })
    nock(API).get('/x/web-interface/nav').reply(412)
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0].status).toBe('failed')
    expect(run.results[0].message).toContain('风控')
  })
})

describe('哔哩哔哩扫码登录', () => {
  it('扫码确认后从 Set-Cookie 拿到 SESSDATA/bili_jct 并保存账号', async () => {
    const { store } = tempStore()
    const service = new CheckinService(store)
    nock('https://passport.bilibili.com')
      .get('/x/passport-login/web/qrcode/generate').reply(200, { code: 0, data: { url: 'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=Q', qrcode_key: 'Q' } })
      .get('/x/passport-login/web/qrcode/poll').query({ qrcode_key: 'Q' }).reply(200, { code: 0, data: { code: 86090, message: '' } })
      .get('/x/passport-login/web/qrcode/poll').query({ qrcode_key: 'Q' }).reply(200, { code: 0, data: { code: 0, message: '' } }, { 'Set-Cookie': ['SESSDATA=sd; Path=/; Domain=.bilibili.com', 'bili_jct=jc; Path=/', 'DedeUserID=42; Path=/'] })
    nock(API).get('/x/frontend/finger/spi').reply(200, { code: 0, data: { b_3: 'B3', b_4: 'B4' } })
      .post('/x/internal/gaia-gateway/ExClimbWuzhi').reply(200, { code: 0 }).get('/x/web-interface/nav').reply(200, nav)
    const start = await service.startQrLogin('bilibili')
    expect((await service.pollQrLogin(start.sessionId)).state).toBe('scanned')
    const done = await service.pollQrLogin(start.sessionId)
    expect(done.state).toBe('success')
    const cookies = store.cookies(store.accounts()[0])
    expect(cookies).toMatchObject({ SESSDATA: 'sd', bili_jct: 'jc', buvid3: 'B3', buvid4: 'B4' })
    expect(cookies._uuid).toMatch(/infoc$/)
    expect(cookies.b_nut).toMatch(/^\d{10}$/)
    expect(done.account?.tasks).toEqual({ watch: true, share: true, coin: false, manga: true })
  })
})

describe('哔哩哔哩：设备指纹激活与网页端参数', () => {
  it('已有 buvid3 但未激活的账号：先上报 ExClimbWuzhi（同一组 Cookie + 一致 UA），之后分享带视频页 Referer 与网页参数', async () => {
    const { store } = tempStore()
    const id = store.upsertAccount({ platform: 'bilibili', uid: '42', nickname: '小红', cookies: { SESSDATA: 's', bili_jct: 'jct', buvid3: 'OLD', buvid4: 'OLD4' }, tasks: { watch: false, share: true, coin: false, manga: false } }).id
    let gaiaCookie = '', gaiaUa = '', payload: Record<string, unknown> = {}
    nock(API).get('/x/web-interface/nav').reply(200, nav)
      .post('/x/internal/gaia-gateway/ExClimbWuzhi').reply(function (_uri, body) {
        gaiaCookie = String(this.req.headers.cookie); gaiaUa = String(this.req.headers['user-agent'])
        payload = JSON.parse((body as { payload: string }).payload); return [200, { code: 0 }]
      })
      .get('/x/member/web/exp/reward').reply(200, reward(true, false))
      .get('/x/web-interface/popular').query(true).reply(200, popular)
      .post('/x/web-interface/share/add', (b) => b.aid === '1' && b.csrf === 'jct' && b.eab_x === '1' && b.source === 'web_normal' && b.ga === '1' && Number(b.ramval) >= 3)
      .matchHeader('referer', /^https:\/\/www\.bilibili\.com\/video\/BV1\//).matchHeader('origin', 'https://www.bilibili.com')
      .reply(200, { code: 0 })
      .get('/x/member/web/exp/reward').reply(200, reward(true, true))
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0].status).toBe('success')
    expect(gaiaCookie).toMatch(/buvid3=OLD; buvid4=OLD4; b_nut=\d+; _uuid=.+infoc/)
    expect(payload['df35']).toMatch(/infoc$/)
    expect((payload['3c43'] as Record<string, unknown>)['b8ce']).toBe(gaiaUa)
    expect(store.cookies(store.account(id))._uuid).toBe(payload['df35'])
  })

  it('已激活的设备不再重复上报（不刷新指纹）', async () => {
    const { store, id } = setup({ watch: true, share: false, coin: false, manga: false })
    nock(API).get('/x/web-interface/nav').reply(200, nav).get('/x/member/web/exp/reward').reply(200, reward(true, true))
    await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(nock.isDone()).toBe(true)
    expect(store.cookies(store.account(id)).buvid3).toBe('b')
  })

  it('投币带视频页 Referer 与 eab_x/ramval/source/ga，-403 如实报告', async () => {
    const { store, id } = setup({ watch: false, share: false, coin: true, manga: false })
    nock(API).get('/x/web-interface/nav').reply(200, nav)
      .get('/x/member/web/exp/reward').reply(200, reward(true, true, 0))
      .get('/x/web-interface/popular').query(true).reply(200, popular)
      .post('/x/web-interface/coin/add', (b) => b.eab_x === '2' && b.ramval === '3' && b.source === 'web_normal' && b.cross_domain === 'true')
      .matchHeader('referer', /\/video\/BV1\//).reply(200, { code: -403, message: '非法访问' })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0].status).toBe('failed')
    expect(run.results[0].message).toContain('非法访问')
  })
})
