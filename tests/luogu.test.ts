import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import nock from 'nock'
import { runAccount } from '../src/main/core/runner.js'
import { csrfToken, punchState } from '../src/main/core/platforms/luogu.js'
import { CheckinService } from '../src/main/core/service.js'
import { noSleep, tempStore } from './helpers.js'

beforeAll(() => nock.disableNetConnect())
afterEach(() => nock.cleanAll())

const ORIGIN = 'https://www.luogu.com.cn'
const page = (body: string) => `<html><head><title>洛谷</title><meta name="csrf-token" content="CSRF123"></head><body>${body}</body></html>`
const NOT_PUNCHED = page('<a name="punch">点击打卡</a>')
const PUNCHED = page('<div class="lg-punch">§ 大吉 § 宜：AC</div>')

function setup() {
  const { store } = tempStore()
  return { store, id: store.upsertAccount({ platform: 'luogu', uid: '123', nickname: 'oier', cookies: { __client_id: 'cid', _uid: '123' }, tasks: { punch: true } }).id }
}

describe('洛谷页面解析', () => {
  it('读取 csrf-token 与打卡状态 / 运势', () => {
    expect(csrfToken(NOT_PUNCHED)).toBe('CSRF123')
    expect(punchState(NOT_PUNCHED)).toEqual({ punched: false, fortune: null })
    expect(punchState(PUNCHED)).toEqual({ punched: true, fortune: '大吉' })
  })
})

describe('洛谷：打卡后重新读取首页确认', () => {
  it('带 x-csrf-token 打卡，首页显示运势 → 成功', async () => {
    const { store, id } = setup()
    nock(ORIGIN).get('/').reply(200, NOT_PUNCHED)
      .post('/index/ajax_punch').matchHeader('x-csrf-token', 'CSRF123').matchHeader('cookie', /__client_id=cid/).reply(200, { code: 200, message: '' })
      .get('/').reply(200, PUNCHED)
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0]).toMatchObject({ status: 'success', message: '打卡成功（今日运势：大吉）' })
  })

  it('【确认】接口说成功但首页仍未打卡 → 失败', async () => {
    const { store, id } = setup()
    nock(ORIGIN).get('/').reply(200, NOT_PUNCHED).post('/index/ajax_punch').reply(200, { code: 200 }).get('/').reply(200, NOT_PUNCHED)
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0].status).toBe('failed')
    expect(run.results[0].message).toContain('仍显示未打卡')
  })

  it('今天已打卡 → 已完成，不发请求', async () => {
    const { store, id } = setup()
    nock(ORIGIN).get('/').reply(200, PUNCHED)
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0]).toMatchObject({ status: 'already', message: '今天已经打过卡了（今日运势：大吉）' })
  })

  it('页面要求登录 → 需要重新登录', async () => {
    const { store, id } = setup()
    nock(ORIGIN).get('/').reply(200, '<html><head><title>登录 - 洛谷</title></head></html>')
    const run = await runAccount(id, 'manual', { store, sleep: noSleep })
    expect(run.results[0].status).toBe('login_expired')
  })

  it('网页登录：_uid 与 currentUser 一致才保存', async () => {
    const { store } = tempStore()
    const service = new CheckinService(store)
    nock(ORIGIN).get('/user/123').query({ _contentOnly: 1 }).reply(200, { currentUser: { uid: 123, name: 'oier' }, currentData: { user: { uid: 123, name: 'oier' } } })
    expect(await service.completeWebLogin('luogu', { __client_id: 'c', _uid: '123' })).toMatchObject({ state: 'success', message: '已添加 oier' })
    nock(ORIGIN).get('/user/9').query({ _contentOnly: 1 }).reply(200, { currentUser: null })
    expect((await service.completeWebLogin('luogu', { __client_id: 'c', _uid: '9' })).state).toBe('error')
  })
})
