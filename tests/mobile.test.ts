import { afterEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: (...args: unknown[]) => request(...args) } }))

const { nativeTransport } = await import('../mobile/src/nativeTransport.js')
const { HttpSession, setTransport, axiosTransport } = await import('../src/main/core/http.js')
const { CheckinService } = await import('../src/main/core/service.js')
const { tempStore } = await import('./helpers.js')

afterEach(() => { request.mockReset(); setTransport(axiosTransport) })

describe('手机原生 HTTP 传输', () => {
  it('表单字符串还原为对象、解析 JSON、关闭原生自动跳转', async () => {
    request.mockResolvedValue({ status: 200, headers: { 'Content-Type': 'application/json' }, data: '{"code":0}' })
    const res = await nativeTransport({ method: 'POST', url: 'https://www.luogu.com.cn/x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: 'a=1&b=%E4%BD%A0', timeoutMs: 1000 })
    expect(res.data).toEqual({ code: 0 })
    expect(request.mock.calls[0][0]).toMatchObject({ data: { a: '1', b: '你' }, disableRedirects: true })
  })
  it('跟随白名单内跳转，拦截白名单外跳转', async () => {
    request.mockResolvedValueOnce({ status: 302, headers: { Location: '/next' }, data: '' }).mockResolvedValueOnce({ status: 200, headers: {}, data: 'ok' })
    expect((await nativeTransport({ method: 'GET', url: 'https://tieba.baidu.com/a', headers: {}, timeoutMs: 1000 })).data).toBe('ok')
    expect(request.mock.calls[1][0].url).toBe('https://tieba.baidu.com/next')
    request.mockResolvedValueOnce({ status: 302, headers: { location: 'https://evil.example.com/' }, data: '' })
    await expect(nativeTransport({ method: 'GET', url: 'https://tieba.baidu.com/a', headers: {}, timeoutMs: 1000 })).rejects.toThrow('白名单')
    expect(request).toHaveBeenCalledTimes(3)
  })
  it('白名单外的地址根本不发出', async () => {
    await expect(nativeTransport({ method: 'GET', url: 'https://example.com/', headers: {}, timeoutMs: 1000 })).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})

describe('可替换传输层', () => {
  it('HttpSession 走注入的传输层，并能解析被逗号合并的 Set-Cookie', async () => {
    setTransport(async () => ({ status: 200, headers: { 'set-cookie': 'a=1; Path=/; Expires=Wed, 21 Oct 2099 07:28:00 GMT, b=2; Path=/' }, data: { ok: 1 } }))
    const http = new HttpSession({})
    await http.request({ url: 'https://music.163.com/x' })
    expect(http.cookies).toMatchObject({ a: '1', b: '2' })
  })
})

describe('手机端登录方式', () => {
  it('手机上 B 站/网易云扫码为主（可改网页登录），贴吧/洛谷用官方网页登录', () => {
    const service = new CheckinService(tempStore().store, { mobile: true })
    const kinds = Object.fromEntries(service.platforms().map((p) => [p.id, [p.loginKind, p.webFallback]]))
    expect(kinds).toEqual({ netease: ['qr', true], bilibili: ['qr', true], tieba: ['web', false], luogu: ['web', false] })
    expect(service.loginFor('bilibili')?.requiredCookies).toContain('SESSDATA')
    const desktop = new CheckinService(tempStore().store)
    expect(desktop.platforms().find((p) => p.id === 'netease')?.loginKind).toBe('qr')
  })
})

describe('用官方 App 打开扫码确认页', () => {
  it('B 站 / 网易云生成正确的 App 链接，且原始链接可完整还原', async () => {
    const { getPlatform } = await import('../src/main/core/platforms/index.js')
    const content = 'https://passport.bilibili.com/h5-app/passport/login/scan?navhide=1&qrcode_key=abc&from=x'
    const bili = getPlatform('bilibili').appLink!(content)
    expect(bili.startsWith('bilibili://browser?url=')).toBe(true)
    expect(decodeURIComponent(new URL(bili).searchParams.get('url')!)).toBe(content)
    const ne = getPlatform('netease').appLink!('https://music.163.com/login?codekey=k1')
    expect(ne).toBe('orpheus://openurl?url=https%3A%2F%2Fmusic.163.com%2Flogin%3Fcodekey%3Dk1')
    expect(getPlatform('tieba').appLink).toBeUndefined()
  })
})
