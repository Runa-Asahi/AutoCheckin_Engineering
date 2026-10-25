import { CheckinError, summarize, type NativePlugin, type PluginContext, type SubtaskResult } from './types.js'

const BASE = 'https://music.163.com'
const HEADERS = { Referer: 'https://music.163.com/', Origin: 'https://music.163.com' }

interface NeteaseAccount { code: number; account?: { id: number } | null; profile?: { nickname?: string; userId?: number } | null }
interface NeteaseSign { code: number; point?: number; msg?: string; message?: string }

/**
 * 网易云音乐每日签到。
 * 参考 NeteaseCloudMusicApi（daily_signin：type=0 安卓端、type=1 网页/PC 端）。
 * 需要 Cookie：MUSIC_U（登录态），建议同时提供 __csrf。
 */
export const neteasePlugin: NativePlugin = {
  id: 'netease_music',
  name: '网易云音乐',
  requiredCookies: ['MUSIC_U'],
  async run(ctx) {
    const account = await ctx.http.json<NeteaseAccount>({ url: `${BASE}/api/nuser/account/get`, headers: HEADERS })
    if (account.code === 301 || !account.account || !account.profile) throw new CheckinError('网易云音乐登录失效（MUSIC_U 无效或已过期），请重新登录后更新 Cookie', 'authentication_required')
    if (account.code !== 200) throw new CheckinError(`网易云音乐账户接口返回 code=${account.code}`, 'retryable_error')
    ctx.log(`已登录：${account.profile.nickname ?? account.profile.userId}`)

    const types = normalizeTypes(ctx.options.sign_types)
    const subtasks: SubtaskResult[] = []
    for (const type of types) subtasks.push(await dailySign(ctx, type))
    if (ctx.options.yunbei !== false) subtasks.push(await yunbeiSign(ctx))
    return summarize('网易云音乐', subtasks, { nickname: account.profile.nickname })
  },
}

function normalizeTypes(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw.map(Number).filter((value) => value === 0 || value === 1) : [0, 1]
  return list.length ? [...new Set(list)] : [0, 1]
}

async function dailySign(ctx: PluginContext, type: number): Promise<SubtaskResult> {
  const name = type === 0 ? '每日签到（安卓端）' : '每日签到（网页/PC 端）'
  const csrf = ctx.cookies.__csrf ?? ''
  const body = await ctx.http.json<NeteaseSign>({ method: 'POST', url: `${BASE}/api/point/dailyTask`, headers: HEADERS, form: true, data: { type, csrf_token: csrf } })
  return interpretSign(name, body)
}

export function interpretSign(name: string, body: NeteaseSign): SubtaskResult {
  const text = body.msg ?? body.message ?? ''
  if (body.code === 200) return { name, status: 'done', message: body.point ? `获得 ${body.point} 积分` : '签到成功' }
  if (body.code === -2 || /重复签到|已签到/.test(text)) return { name, status: 'already', message: '今日已签到' }
  if (body.code === 301) throw new CheckinError('网易云音乐登录失效（code 301），请更新 Cookie', 'authentication_required')
  return { name, status: 'failed', message: `code=${body.code} ${text}`.trim() }
}

async function yunbeiSign(ctx: PluginContext): Promise<SubtaskResult> {
  const name = '云贝签到'
  try {
    const body = await ctx.http.json<NeteaseSign & { data?: { point?: number } }>({ method: 'POST', url: `${BASE}/api/pointmall/user/sign`, headers: HEADERS, form: true, data: {} })
    if (body.code === 200) return { name, status: 'done', message: body.data?.point ? `获得 ${body.data.point} 云贝` : '签到成功' }
    if (body.code === -2 || /重复|已签/.test(body.msg ?? body.message ?? '')) return { name, status: 'already', message: '今日已签到' }
    return { name, status: 'failed', message: `code=${body.code} ${body.msg ?? body.message ?? ''}`.trim() }
  } catch (error) {
    if (error instanceof CheckinError && error.outcome === 'authentication_required') throw error
    return { name, status: 'failed', message: (error as Error).message }
  }
}
