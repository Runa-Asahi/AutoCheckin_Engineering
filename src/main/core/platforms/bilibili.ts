import { LoginExpiredError, NetworkError, type HttpSession } from '../http.js'
import { result, type Platform, type TaskContext } from '../platform.js'
import type { PlatformTaskInfo, TaskResult } from '../../../shared/types.js'

const API = 'https://api.bilibili.com'
const PASSPORT = 'https://passport.bilibili.com'
const HEADERS = { Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com' }

const WATCH: PlatformTaskInfo = { id: 'watch', label: '每日观看视频', description: '自动“看”一个热门视频，经验 +5', defaultOn: true }
const SHARE: PlatformTaskInfo = { id: 'share', label: '每日分享视频', description: '分享一个热门视频，经验 +5', defaultOn: true }
const COIN: PlatformTaskInfo = { id: 'coin', label: '每日投 1 枚硬币', description: '给热门视频投 1 枚硬币，经验 +10（会消耗硬币）', defaultOn: false }
const MANGA: PlatformTaskInfo = { id: 'manga', label: '漫画签到', description: '哔哩哔哩漫画每日签到', defaultOn: true }

interface Resp<T = unknown> { code: number; message?: string; msg?: string; data?: T }
interface Reward { login: boolean; watch: boolean; share: boolean; coins: number }
interface Video { aid: number; bvid: string; cid: number; duration?: number; owner?: { mid: number } }

function reason(body: Resp): string { return body.message || body.msg || `错误码 ${body.code}` }
function csrf(session: HttpSession): string { return session.cookies.bili_jct ?? '' }

async function reward(session: HttpSession): Promise<Reward> {
  const body = await session.json<Resp<Reward>>({ url: `${API}/x/member/web/exp/reward`, headers: HEADERS })
  if (body.code === -101) throw new LoginExpiredError('B 站登录已过期，请重新扫码')
  if (body.code !== 0 || !body.data) throw new NetworkError(`无法查询每日任务状态：${reason(body)}`)
  return body.data
}

/** 执行后轮询任务状态，最多约 6 秒，等待 B 站记录生效。 */
async function confirm(ctx: TaskContext, check: (r: Reward) => boolean): Promise<{ ok: boolean; error?: string }> {
  let error: string | undefined
  for (let i = 0; i < 4; i++) {
    await ctx.sleep(i === 0 ? 1000 : 1500)
    try { if (check(await reward(ctx.session))) return { ok: true } } catch (caught) {
      if (caught instanceof LoginExpiredError) throw caught
      error = (caught as Error).message
    }
  }
  return { ok: false, error }
}

async function videos(session: HttpSession, selfMid: string): Promise<Video[]> {
  const body = await session.json<Resp<{ list?: Video[] }>>({ url: `${API}/x/web-interface/popular`, params: { ps: 20, pn: 1 }, headers: HEADERS })
  const list = (body.data?.list ?? []).filter((v) => v.aid && v.bvid && String(v.owner?.mid) !== selfMid)
  if (!list.length) throw new NetworkError(`获取热门视频失败：${reason(body)}`)
  return list
}

export const bilibili: Platform = {
  id: 'bilibili',
  name: '哔哩哔哩',
  loginHint: '打开哔哩哔哩 App，点右上角扫一扫',
  tasks: [WATCH, SHARE, COIN, MANGA],

  async qrStart(session) {
    const body = await session.json<Resp<{ url: string; qrcode_key: string }>>({ url: `${PASSPORT}/x/passport-login/web/qrcode/generate`, headers: HEADERS })
    if (body.code !== 0 || !body.data) throw new NetworkError(`获取二维码失败：${reason(body)}`)
    return { key: body.data.qrcode_key, content: body.data.url }
  },

  async qrPoll(session, key) {
    const body = await session.json<Resp<{ code: number; message: string }>>({ url: `${PASSPORT}/x/passport-login/web/qrcode/poll`, params: { qrcode_key: key }, headers: HEADERS })
    const code = body.data?.code
    if (code === 86101) return { state: 'waiting', message: '请用哔哩哔哩 App 扫码' }
    if (code === 86090) return { state: 'scanned', message: '已扫码，请在手机上确认登录' }
    if (code === 86038) return { state: 'expired', message: '二维码已过期，请刷新' }
    if (code === 0) {
      if (!session.cookies.SESSDATA || !session.cookies.bili_jct) return { state: 'error', message: '登录成功但没有拿到登录凭据，请重试' }
      await ensureBuvid(session)
      return { state: 'success', message: '登录成功' }
    }
    return { state: 'error', message: `登录失败：${body.data?.message ?? reason(body)}` }
  },

  async profile(session) {
    const body = await session.json<Resp<{ isLogin: boolean; mid: number; uname: string }>>({ url: `${API}/x/web-interface/nav`, headers: HEADERS })
    if (body.code === -101 || !body.data?.isLogin) throw new LoginExpiredError('B 站登录已过期，请重新扫码')
    return { uid: String(body.data.mid), nickname: body.data.uname }
  },

  async run(taskIds, ctx) {
    const me = await this.profile(ctx.session)
    await ensureBuvid(ctx.session)
    const out: TaskResult[] = []
    let state: Reward | undefined, stateError = ''
    try { state = await reward(ctx.session) } catch (error) { if (error instanceof LoginExpiredError) throw error; stateError = (error as Error).message }
    const needsVideo = taskIds.some((id) => (id === 'watch' && !state?.watch) || (id === 'share' && !state?.share) || (id === 'coin' && (state?.coins ?? 0) < 10))
    let list: Video[] = [], videoError = ''
    if (needsVideo) { try { list = await videos(ctx.session, me.uid) } catch (error) { videoError = (error as Error).message } }

    if (taskIds.includes('watch')) out.push(await doTask(ctx, WATCH, state?.watch, (r) => r.watch, stateError, videoError, async () => {
      const v = list[0], played = Math.max(15, Math.min(v.duration ?? 60, 90)), now = Math.floor(ctx.now().getTime() / 1000)
      return ctx.session.json<Resp>({ method: 'POST', url: `${API}/x/click-interface/web/heartbeat`, headers: HEADERS, form: { aid: v.aid, bvid: v.bvid, cid: v.cid ?? 0, mid: me.uid, csrf: csrf(ctx.session), played_time: played, real_played_time: played, realtime: played, start_ts: now - played, type: 3, dt: 2, play_type: 0 } })
    }))
    if (taskIds.includes('share')) out.push(await doTask(ctx, SHARE, state?.share, (r) => r.share, stateError, videoError, async () => {
      const v = list[0]
      const body = await ctx.session.json<Resp>({ method: 'POST', url: `${API}/x/web-interface/share/add`, headers: HEADERS, form: { aid: v.aid, bvid: v.bvid, csrf: csrf(ctx.session), eab_x: 2, ramval: 0, source: 'web_normal', ga: 1 } })
      return body.code === 71000 ? { code: 0 } : body
    }))
    if (taskIds.includes('coin')) {
      const before = state?.coins ?? 0
      out.push(await doTask(ctx, COIN, state ? before >= 10 : undefined, (r) => r.coins > before, stateError, videoError, async () => {
        let last: Resp = { code: -1, message: '没有可投币的视频' }
        for (const v of list.slice(0, 5)) {
          last = await ctx.session.json<Resp>({ method: 'POST', url: `${API}/x/web-interface/coin/add`, headers: HEADERS, form: { aid: v.aid, multiply: 1, select_like: 0, cross_domain: 'true', csrf: csrf(ctx.session) } })
          if (last.code === 34005) continue // 该视频已投满
          return last.code === -104 ? { code: -104, message: '硬币不足' } : last
        }
        return last
      }))
    }
    if (taskIds.includes('manga')) out.push(await manga(ctx))
    return out
  },
}

async function doTask(ctx: TaskContext, task: PlatformTaskInfo, alreadyDone: boolean | undefined, check: (r: Reward) => boolean, stateError: string, videoError: string, action: () => Promise<Resp>): Promise<TaskResult> {
  if (alreadyDone === true) return result(task, 'already', '今天已经完成了')
  if (videoError) return result(task, 'failed', videoError)
  let body: Resp
  try { body = await action() } catch (error) { return result(task, 'failed', `请求失败：${(error as Error).message}`) }
  if (body.code === -101) throw new LoginExpiredError('B 站登录已过期，请重新扫码')
  if (body.code !== 0) return result(task, 'failed', `B 站返回：${reason(body)}`)
  const verified = await confirm(ctx, check)
  if (verified.ok) return result(task, 'success', '已完成，B 站任务状态已确认')
  return result(task, 'failed', `请求已发送，但 B 站任务状态未显示完成${verified.error || stateError ? `（${verified.error || stateError}）` : ''}`)
}

async function manga(ctx: TaskContext): Promise<TaskResult> {
  const status = async (): Promise<boolean> => {
    const body = await ctx.session.json<Resp<{ status?: number }>>({ method: 'POST', url: 'https://manga.bilibili.com/twirp/activity.v1.Activity/GetClockInInfo', headers: { Referer: 'https://manga.bilibili.com/' }, json: {} })
    if (body.code !== 0 || !body.data) throw new NetworkError(`无法查询漫画签到状态：${reason(body)}`)
    return body.data.status === 1
  }
  try {
    if (await status()) return result(MANGA, 'already', '今天已经签过了')
    const body = await ctx.session.json<Resp>({ method: 'POST', url: 'https://manga.bilibili.com/twirp/activity.v1.Activity/ClockIn', headers: { Referer: 'https://manga.bilibili.com/' }, form: { platform: 'android' } })
    await ctx.sleep(800)
    if (await status()) return result(MANGA, 'success', '签到成功，状态已确认')
    return result(MANGA, 'failed', `签到后状态仍为未签到（平台返回：${reason(body)}）`)
  } catch (error) { return result(MANGA, 'failed', (error as Error).message) }
}

/** 获取设备标识 buvid3/buvid4，降低风控（412）概率。 */
async function ensureBuvid(session: HttpSession): Promise<void> {
  if (session.cookies.buvid3) return
  try {
    const body = await session.json<Resp<{ b_3?: string; b_4?: string }>>({ url: `${API}/x/frontend/finger/spi`, headers: HEADERS })
    if (body.data?.b_3) session.cookies.buvid3 = body.data.b_3
    if (body.data?.b_4) session.cookies.buvid4 = body.data.b_4
  } catch { /* 非必须 */ }
}
