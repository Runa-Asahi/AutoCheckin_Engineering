import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import nock from 'nock'
import { createHash } from 'node:crypto'
import { runAccount } from '../src/main/core/runner.js'
import { clientSign } from '../src/main/core/platforms/tieba.js'
import { CheckinService } from '../src/main/core/service.js'
import { noSleep, tempStore } from './helpers.js'

beforeAll(() => nock.disableNetConnect())
afterEach(() => nock.cleanAll())

const WEB = 'https://tieba.baidu.com', CLIENT = 'https://c.tieba.baidu.com'
const forums = (signed: Record<string, boolean>) => ({ no: 0, error: 'success', data: { is_login: true, tbs: 'T', like_forum: Object.entries(signed).map(([name, s], i) => ({ forum_name: name, forum_id: 100 + i, is_sign: s ? 1 : 0 })) } })

function setup() {
  const { store } = tempStore()
  return { store, id: store.upsertAccount({ platform: 'tieba', uid: 'p1', nickname: '吧友', cookies: { BDUSS: 'bd', STOKEN: 'st' }, tasks: { sign_all: true } }).id }
}

describe('贴吧客户端签名', () => {
  it('按键名排序拼接 + tiebaclient!!! 后取 MD5 大写', () => {
    const expected = createHash('md5').update('BDUSS=bdfid=1kw=测试tbs=ttiebaclient!!!').digest('hex').toUpperCase()
    expect(clientSign({ tbs: 't', kw: '测试', fid: '1', BDUSS: 'bd' })).toBe(expected)
  })
})

describe('百度贴吧：逐个签到并重新读取签到状态确认', () => {
  it('新签到 + 原本已签 → 成功，并带上统计；请求带正确 sign', async () => {
    const { store, id } = setup()
    const bodies: Array<Record<string, string>> = []
    nock(WEB).get('/mo/q/newmoindex').reply(200, forums({ 编程: false, 音乐: true, 动漫: false }))
      .get('/mo/q/newmoindex').reply(200, forums({ 编程: true, 音乐: true, 动漫: true }))
    nock(CLIENT).post('/c/c/forum/sign').times(2).reply(200, function (_u, body) { bodies.push(Object.fromEntries(new URLSearchParams(String(body)))); return { error_code: '0' } })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0]).toMatchObject({ status: 'success', message: '共 3 个吧：新签到 2，原本已签 1，未成功 0' })
    const { sign, ...rest } = bodies[0]
    expect(rest).toMatchObject({ BDUSS: 'bd', kw: '编程', tbs: 'T', fid: '100' })
    expect(sign).toBe(clientSign(rest))
  })

  it('【确认】接口返回成功但状态仍未签 → 失败并说明', async () => {
    const { store, id } = setup()
    nock(WEB).get('/mo/q/newmoindex').reply(200, forums({ 编程: false }))
      .get('/mo/q/newmoindex').reply(200, forums({ 编程: false }))
    nock(CLIENT).post('/c/c/forum/sign').reply(200, { error_code: '0' })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0].status).toBe('failed')
    expect(run.results[0].message).toContain('编程吧：签到后状态仍为未签到')
  })

  it('部分吧被拒 → 失败，列出原因；触发验证时暂停后续签到', async () => {
    const { store, id } = setup()
    nock(WEB).get('/mo/q/newmoindex').reply(200, forums({ 甲: false, 乙: false, 丙: false }))
      .get('/mo/q/newmoindex').reply(200, forums({ 甲: true, 乙: false, 丙: false }))
    nock(CLIENT).post('/c/c/forum/sign').reply(200, { error_code: '0' })
      .post('/c/c/forum/sign').reply(200, { error_code: '340011', error_msg: '操作太频繁，请输入验证码' })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0].status).toBe('failed')
    expect(run.results[0].message).toContain('新签到 1')
    expect(run.results[0].message).toContain('乙吧：操作太频繁')
    expect(run.results[0].message).toContain('已暂停')
    expect(nock.isDone()).toBe(true) // 丙吧没有再发请求
  })

  it('全部已签 → 已完成，不发签到请求', async () => {
    const { store, id } = setup()
    nock(WEB).get('/mo/q/newmoindex').reply(200, forums({ a: true, b: true }))
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0]).toMatchObject({ status: 'already', message: '关注的 2 个吧今天都已经签过了' })
  })

  it('BDUSS 失效 → 需要重新登录', async () => {
    const { store, id } = setup()
    nock(WEB).get('/mo/q/newmoindex').reply(200, { no: 1, error: 'not logined!', data: { is_login: false, tbs: 'x' } })
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0].status).toBe('login_expired')
    expect(store.account(id).loginExpired).toBe(true)
  })
})

describe('贴吧网页登录完成', () => {
  it('只在拿到 BDUSS+STOKEN 且校验通过后保存账号', async () => {
    const { store } = tempStore()
    const service = new CheckinService(store)
    expect((await service.completeWebLogin('tieba', { BDUSS: 'x' })).state).toBe('error')
    nock(WEB).get('/mo/q/newmoindex').reply(200, forums({ 编程: false })).get('/f/user/json_userinfo').reply(200, { no: 0, data: { user_name_show: '吧友', user_portrait: 'tb.1.abc' } })
    const done = await service.completeWebLogin('tieba', { BDUSS: 'x', STOKEN: 'y' })
    expect(done).toMatchObject({ state: 'success', message: '已添加 吧友' })
    expect(store.cookies(store.accounts()[0])).toEqual({ BDUSS: 'x', STOKEN: 'y' })
  })
})

describe('真实故障回归：/dc/common/tbs 会 301 降级到 http', () => {
  it('登录校验不再请求会降级的接口；tbs 改从 HTTPS 的 newmoindex 读取', async () => {
    const { store } = tempStore()
    const service = new CheckinService(store)
    // 百度线上实际行为（2026-10-25 复现）：https://tieba.baidu.com/dc/common/tbs → 301 http://tieba.baidu.com/dc/common/tbs?red_tag=…
    nock(WEB).get('/dc/common/tbs').reply(301, '', { Location: 'http://tieba.baidu.com/dc/common/tbs?red_tag=i1' })
    nock(WEB).get('/mo/q/newmoindex').reply(200, forums({ 编程: false })).get('/f/user/json_userinfo').reply(200, { no: 0, data: { user_name_show: '吧友', user_portrait: 'tb.1.abc' } })
    expect(await service.completeWebLogin('tieba', { BDUSS: 'x', STOKEN: 'y' })).toMatchObject({ state: 'success' })
    expect(nock.pendingMocks().some((m) => m.includes('/dc/common/tbs'))).toBe(true) // 从未被请求
    nock.cleanAll()
  })
})

