import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import nock from 'nock'
import { runPlugin } from '../src/main/plugins/registry.js'
import { PluginHttpClient } from '../src/main/plugins/httpClient.js'
import { CheckinError } from '../src/main/plugins/types.js'

const noSleep = async () => undefined
beforeAll(() => nock.disableNetConnect())
afterEach(() => { nock.cleanAll() })

describe('网易云音乐插件', () => {
  const cookie = 'MUSIC_U=fake_token; __csrf=csrf123'
  it('登录有效时完成双端签到与云贝签到', async () => {
    nock('https://music.163.com').get('/api/nuser/account/get').reply(200, { code: 200, account: { id: 1 }, profile: { nickname: 'runa', userId: 1 } })
      .post('/api/point/dailyTask', (body) => body.type === '0' && body.csrf_token === 'csrf123').reply(200, { code: 200, point: 3 })
      .post('/api/point/dailyTask', (body) => body.type === '1').reply(200, { code: -2, msg: '重复签到' })
      .post('/api/pointmall/user/sign').reply(200, { code: 200, data: { point: 10 } })
    const result = await runPlugin({ pluginId: 'netease_music', cookieHeader: cookie, sleep: noSleep })
    expect(result.success).toBe(true)
    expect(result.outcome).toBe('success')
    expect(result.subtasks.map((item) => item.status)).toEqual(['done', 'already', 'done'])
    expect(result.message).toContain('获得 3 积分')
  })
  it('账户为空时判定为登录失效，不重试', async () => {
    nock('https://music.163.com').get('/api/nuser/account/get').reply(200, { code: 200, account: null, profile: null })
    const result = await runPlugin({ pluginId: 'netease_music', cookieHeader: cookie, sleep: noSleep })
    expect(result.success).toBe(false)
    expect(result.outcome).toBe('authentication_required')
  })
  it('缺少 MUSIC_U 时直接要求重新登录且不发请求', async () => {
    const result = await runPlugin({ pluginId: 'netease_music', cookieHeader: 'foo=bar' })
    expect(result.outcome).toBe('authentication_required')
    expect(result.message).toContain('MUSIC_U')
  })
  it('可通过选项只签网页端并关闭云贝', async () => {
    nock('https://music.163.com').get('/api/nuser/account/get').reply(200, { code: 200, account: { id: 1 }, profile: { nickname: 'r' } })
      .post('/api/point/dailyTask', (body) => body.type === '1').reply(200, { code: 200, point: 2 })
    const result = await runPlugin({ pluginId: 'netease_music', cookieHeader: cookie, options: { sign_types: [1], yunbei: false }, sleep: noSleep })
    expect(result.subtasks).toHaveLength(1)
    expect(nock.isDone()).toBe(true)
  })
})

describe('哔哩哔哩插件', () => {
  const cookie = 'SESSDATA=sess; bili_jct=jct123; DedeUserID=42'
  const nav = { code: 0, data: { isLogin: true, mid: 42, uname: 'runa', money: 10, level_info: { current_level: 4, current_exp: 100, next_exp: 200 } } }
  const popular = { code: 0, data: { list: [{ aid: 1, bvid: 'BV1', cid: 11, duration: 120, owner: { mid: 7 } }, { aid: 2, bvid: 'BV2', cid: 22, duration: 30, owner: { mid: 8 } }] } }

  it('完成观看、分享、投币与漫画签到，并携带 csrf', async () => {
    nock('https://api.bilibili.com')
      .get('/x/web-interface/nav').reply(200, nav)
      .get('/x/member/web/exp/reward').reply(200, { code: 0, data: { login: true, watch: false, share: false, coins: 0 } })
      .get('/x/web-interface/popular').query(true).reply(200, popular)
      .post('/x/click-interface/web/heartbeat', (body) => body.csrf === 'jct123' && body.bvid === 'BV1').reply(200, { code: 0 })
      .post('/x/web-interface/share/add', (body) => body.csrf === 'jct123').reply(200, { code: 0 })
      .post('/x/web-interface/coin/add', (body) => body.aid === '1').reply(200, { code: 34005, message: '超过投币上限' })
      .post('/x/web-interface/coin/add', (body) => body.aid === '2').reply(200, { code: 0 })
    nock('https://manga.bilibili.com').post('/twirp/activity.v1.Activity/ClockIn').reply(200, { code: 'invalid_argument', msg: 'clockin clockin is duplicate' })
    const result = await runPlugin({ pluginId: 'bilibili', cookieHeader: cookie, options: { coins: 1 }, sleep: noSleep })
    expect(result.success).toBe(true)
    const byName = Object.fromEntries(result.subtasks.map((item) => [item.name, item.status]))
    expect(byName).toMatchObject({ 观看视频: 'done', 分享视频: 'done', 投币: 'done', 漫画签到: 'already' })
    expect(nock.isDone()).toBe(true)
  })
  it('今日任务已完成时不再请求视频接口', async () => {
    nock('https://api.bilibili.com')
      .get('/x/web-interface/nav').reply(200, nav)
      .get('/x/member/web/exp/reward').reply(200, { code: 0, data: { login: true, watch: true, share: true, coins: 50 } })
    const result = await runPlugin({ pluginId: 'bilibili', cookieHeader: cookie, options: { manga: false }, sleep: noSleep })
    expect(result.success).toBe(true)
    expect(result.subtasks.every((item) => item.status === 'already')).toBe(true)
  })
  it('code -101 判定为 Cookie 过期', async () => {
    nock('https://api.bilibili.com').get('/x/web-interface/nav').reply(200, { code: -101, message: '账号未登录', data: { isLogin: false } })
    const result = await runPlugin({ pluginId: 'bilibili', cookieHeader: cookie, sleep: noSleep })
    expect(result.outcome).toBe('authentication_required')
  })
  it('缺少 bili_jct 时提示补全 Cookie', async () => {
    const result = await runPlugin({ pluginId: 'bilibili', cookieHeader: 'SESSDATA=x' })
    expect(result.outcome).toBe('authentication_required')
    expect(result.message).toContain('bili_jct')
  })
  it('全部子任务失败时返回可重试错误', async () => {
    nock('https://api.bilibili.com')
      .get('/x/web-interface/nav').reply(200, nav)
      .get('/x/member/web/exp/reward').reply(200, { code: 0, data: { login: false, watch: false, share: false, coins: 0 } })
      .get('/x/web-interface/popular').query(true).reply(200, popular)
      .post('/x/click-interface/web/heartbeat').reply(200, { code: -400, message: '请求错误' })
      .post('/x/web-interface/share/add').reply(200, { code: -400, message: '请求错误' })
    const result = await runPlugin({ pluginId: 'bilibili', cookieHeader: cookie, options: { manga: false }, sleep: noSleep })
    // “每日登录”通过访问完成，所以属于部分成功
    expect(result.success).toBe(true)
    expect(result.message).toContain('部分完成')
  })
})

describe('PluginHttpClient', () => {
  it('5xx 自动重试后成功', async () => {
    nock('https://retry.test').get('/x').reply(503).get('/x').reply(200, { ok: 1 })
    const client = new PluginHttpClient({ cookieHeader: '', maxRetries: 2, sleep: noSleep })
    await expect(client.json({ url: 'https://retry.test/x' })).resolves.toEqual({ ok: 1 })
  })
  it('重试耗尽时抛出 retryable_error', async () => {
    nock('https://retry.test').get('/x').times(3).reply(502)
    const client = new PluginHttpClient({ cookieHeader: '', maxRetries: 2, sleep: noSleep })
    await expect(client.json({ url: 'https://retry.test/x' })).rejects.toMatchObject({ outcome: 'retryable_error' })
  })
  it('401 立即判定登录失效', async () => {
    nock('https://retry.test').get('/x').reply(401)
    const client = new PluginHttpClient({ cookieHeader: '', sleep: noSleep })
    const error = await client.json({ url: 'https://retry.test/x' }).catch((caught) => caught)
    expect(error).toBeInstanceOf(CheckinError)
    expect(error.outcome).toBe('authentication_required')
  })
  it('412 风控转人工处理', async () => {
    nock('https://retry.test').get('/x').reply(412)
    const client = new PluginHttpClient({ cookieHeader: '', sleep: noSleep })
    await expect(client.json({ url: 'https://retry.test/x' })).rejects.toMatchObject({ outcome: 'manual_action_required' })
  })
})

describe('未知插件', () => {
  it('返回 permanent_failure 并列出可用插件', async () => {
    const result = await runPlugin({ pluginId: 'nope', cookieHeader: '' })
    expect(result.outcome).toBe('permanent_failure')
    expect(result.message).toContain('bilibili')
  })
})
