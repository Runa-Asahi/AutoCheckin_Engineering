import { CheckinError, summarize, type NativePlugin, type PluginContext, type SubtaskResult } from './types.js'

const API = 'https://api.bilibili.com'
const HEADERS = { Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com' }

interface BiliResponse<T = unknown> { code: number; message?: string; msg?: string; data?: T }
interface Nav { isLogin: boolean; mid: number; uname: string; money: number; level_info?: { current_level: number; current_exp: number; next_exp: number | string } }
interface Reward { login: boolean; watch: boolean; share: boolean; coins: number }
interface Video { aid: number; bvid: string; cid: number; duration?: number; owner?: { mid: number }; title?: string }

/**
 * 哔哩哔哩每日任务：登录检测、观看视频、分享视频、投币（可选）、漫画签到、直播签到（可选）。
 * 参考 BiliBiliToolPro / SocialSisterYi bilibili-API-collect 的公开接口文档。
 * 需要 Cookie：SESSDATA（登录态）、bili_jct（CSRF），建议同时提供 DedeUserID、buvid3。
 *
 * 选项（adapter.plugin.options 或任务 config.plugin_options）：
 *   watch(true) share(true) coins(0, 0~5，单位：枚) coin_select_like(false) manga(true) live(false)
 */
export const bilibiliPlugin: NativePlugin = {
  id: 'bilibili',
  name: '哔哩哔哩',
  requiredCookies: ['SESSDATA', 'bili_jct'],
  async run(ctx) {
    const nav = await ctx.http.json<BiliResponse<Nav>>({ url: `${API}/x/web-interface/nav`, headers: HEADERS })
    if (nav.code === -101 || !nav.data?.isLogin) throw new CheckinError('哔哩哔哩登录失效（SESSDATA 无效或已过期），请重新登录后更新 Cookie', 'authentication_required')
    if (nav.code !== 0) throw new CheckinError(`哔哩哔哩用户信息接口返回 code=${nav.code} ${nav.message ?? ''}`, 'retryable_error')
    const user = nav.data
    ctx.log(`已登录：${user.uname}（Lv${user.level_info?.current_level ?? '?'}）`)

    const reward = await fetchReward(ctx)
    const needsVideo = (ctx.options.watch !== false && !reward?.watch) || (ctx.options.share !== false && !reward?.share) || coinTarget(ctx, reward) > 0
    const videos = needsVideo ? await fetchVideos(ctx, user.mid) : []
    const subtasks: SubtaskResult[] = []
    subtasks.push(reward?.login ? { name: '每日登录', status: 'already', message: '已完成' } : { name: '每日登录', status: 'done', message: '已通过访问接口完成' })
    if (ctx.options.watch !== false) subtasks.push(reward?.watch ? done('观看视频', true) : await watchVideo(ctx, videos[0], user.mid))
    if (ctx.options.share !== false) subtasks.push(reward?.share ? done('分享视频', true) : await shareVideo(ctx, videos[0]))
    const coins = coinTarget(ctx, reward)
    if (Number(ctx.options.coins ?? 0) > 0) subtasks.push(coins > 0 ? await addCoins(ctx, videos, coins, user.money) : done('投币', true))
    if (ctx.options.manga !== false) subtasks.push(await mangaClockIn(ctx))
    if (ctx.options.live === true) subtasks.push(await liveSign(ctx))
    return summarize('哔哩哔哩', subtasks, { uname: user.uname, level: user.level_info?.current_level, coins: user.money })
  },
}

function done(name: string, already = false): SubtaskResult { return { name, status: already ? 'already' : 'done', message: already ? '今日已完成' : '完成' } }
function csrf(ctx: PluginContext): string { return ctx.cookies.bili_jct ?? '' }

function coinTarget(ctx: PluginContext, reward: Reward | null): number {
  const wanted = Math.max(0, Math.min(5, Math.floor(Number(ctx.options.coins ?? 0)) || 0))
  const given = Math.floor((reward?.coins ?? 0) / 10)
  return Math.max(0, wanted - given)
}

async function fetchReward(ctx: PluginContext): Promise<Reward | null> {
  try {
    const body = await ctx.http.json<BiliResponse<Reward>>({ url: `${API}/x/member/web/exp/reward`, headers: HEADERS })
    return body.code === 0 && body.data ? body.data : null
  } catch (error) {
    if (error instanceof CheckinError && error.outcome === 'authentication_required') throw error
    return null
  }
}

async function fetchVideos(ctx: PluginContext, selfMid: number): Promise<Video[]> {
  const body = await ctx.http.json<BiliResponse<{ list?: Video[] }>>({ url: `${API}/x/web-interface/popular`, params: { ps: 20, pn: 1 }, headers: HEADERS })
  const list = (body.data?.list ?? []).filter((video) => video.aid && video.bvid && video.owner?.mid !== selfMid)
  if (!list.length) throw new CheckinError(`获取热门视频失败：code=${body.code} ${body.message ?? ''}`, 'retryable_error')
  return list
}

async function watchVideo(ctx: PluginContext, video: Video | undefined, mid: number): Promise<SubtaskResult> {
  const name = '观看视频'
  if (!video) return { name, status: 'failed', message: '没有可用视频' }
  const playedTime = Math.max(15, Math.min(video.duration ?? 60, 90))
  const start = Math.floor(ctx.now().getTime() / 1000)
  const body = await ctx.http.json<BiliResponse>({
    method: 'POST', url: `${API}/x/click-interface/web/heartbeat`, headers: HEADERS, form: true,
    data: { aid: video.aid, bvid: video.bvid, cid: video.cid ?? 0, mid, csrf: csrf(ctx), played_time: playedTime, real_played_time: playedTime, realtime: playedTime, start_ts: start - playedTime, type: 3, dt: 2, play_type: 0 },
  })
  return body.code === 0 ? { name, status: 'done', message: `已上报观看 ${video.bvid}` } : failure(name, body)
}

async function shareVideo(ctx: PluginContext, video: Video | undefined): Promise<SubtaskResult> {
  const name = '分享视频'
  if (!video) return { name, status: 'failed', message: '没有可用视频' }
  const body = await ctx.http.json<BiliResponse>({ method: 'POST', url: `${API}/x/web-interface/share/add`, headers: HEADERS, form: true, data: { aid: video.aid, bvid: video.bvid, csrf: csrf(ctx), eab_x: 2, ramval: 0, source: 'web_normal', ga: 1 } })
  if (body.code === 0) return { name, status: 'done', message: `已分享 ${video.bvid}` }
  if (body.code === 71000) return { name, status: 'already', message: '重复分享，今日已完成' }
  return failure(name, body)
}

async function addCoins(ctx: PluginContext, videos: Video[], count: number, balance: number): Promise<SubtaskResult> {
  const name = '投币'
  const minReserve = Math.max(0, Number(ctx.options.coin_reserve ?? 0) || 0)
  const affordable = Math.max(0, Math.floor(balance - minReserve))
  if (affordable <= 0) return { name, status: 'skipped', message: `硬币余额 ${balance}，不足以投币` }
  let given = 0
  for (const video of videos) {
    if (given >= Math.min(count, affordable)) break
    const body = await ctx.http.json<BiliResponse>({ method: 'POST', url: `${API}/x/web-interface/coin/add`, headers: HEADERS, form: true, data: { aid: video.aid, multiply: 1, select_like: ctx.options.coin_select_like === true ? 1 : 0, cross_domain: 'true', csrf: csrf(ctx) } })
    if (body.code === 0) given++
    else if (body.code === 34005) continue // 该视频已达投币上限
    else if (body.code === -104) break // 硬币不足
    else if (body.code === -101) throw new CheckinError('哔哩哔哩登录失效，请更新 Cookie', 'authentication_required')
    else return { name, status: given ? 'done' : 'failed', message: `已投 ${given} 枚，后续失败：code=${body.code} ${body.message ?? ''}`.trim() }
  }
  return given ? { name, status: 'done', message: `投出 ${given} 枚硬币` } : { name, status: 'failed', message: '没有成功投出硬币' }
}

async function mangaClockIn(ctx: PluginContext): Promise<SubtaskResult> {
  const name = '漫画签到'
  try {
    const body = await ctx.http.json<BiliResponse & { msg?: string }>({ method: 'POST', url: 'https://manga.bilibili.com/twirp/activity.v1.Activity/ClockIn', headers: { Referer: 'https://manga.bilibili.com/' }, form: true, data: { platform: 'android' } })
    if (body.code === 0) return { name, status: 'done', message: '签到成功' }
    if (/duplicate|重复|已签/i.test(`${body.msg ?? ''}${body.message ?? ''}`)) return { name, status: 'already', message: '今日已签到' }
    return failure(name, body)
  } catch (error) { return softFailure(name, error) }
}

async function liveSign(ctx: PluginContext): Promise<SubtaskResult> {
  const name = '直播签到'
  try {
    const body = await ctx.http.json<BiliResponse<{ text?: string }>>({ url: 'https://api.live.bilibili.com/xlive/web-ucenter/v1/sign/DoSign', headers: { Referer: 'https://live.bilibili.com/' } })
    if (body.code === 0) return { name, status: 'done', message: body.data?.text ?? '签到成功' }
    if (body.code === 1011040 || /已签到/.test(body.message ?? '')) return { name, status: 'already', message: '今日已签到' }
    return failure(name, body)
  } catch (error) { return softFailure(name, error) }
}

function failure(name: string, body: BiliResponse): SubtaskResult {
  if (body.code === -101) throw new CheckinError('哔哩哔哩登录失效，请更新 Cookie', 'authentication_required')
  return { name, status: 'failed', message: `code=${body.code} ${body.message ?? body.msg ?? ''}`.trim() }
}
function softFailure(name: string, error: unknown): SubtaskResult {
  if (error instanceof CheckinError && error.outcome === 'authentication_required') throw error
  return { name, status: 'failed', message: (error as Error).message }
}
