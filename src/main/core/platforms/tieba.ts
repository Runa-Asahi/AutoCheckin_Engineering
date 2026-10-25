import { md5Hex } from './neteaseCrypto.js'
import { LoginExpiredError, NetworkError, type HttpSession } from '../http.js'
import { result, type Platform, type TaskContext } from '../platform.js'
import type { PlatformTaskInfo, TaskResult } from '../../../shared/types.js'

const WEB = 'https://tieba.baidu.com'
const CLIENT = 'https://c.tieba.baidu.com'
const HEADERS = { Referer: 'https://tieba.baidu.com/' }

const SIGN_ALL: PlatformTaskInfo = { id: 'sign_all', label: '签到所有关注的吧', description: '逐个签到你关注的每一个吧，并逐个确认', defaultOn: true }

interface Forum { forum_name: string; forum_id: number | string; is_sign: number | boolean; user_level?: number }
interface MoIndex { no?: number; error?: string; data?: { like_forum?: Forum[] } }
interface Tbs { tbs?: string; is_login?: number }
interface ClientSign { error_code?: string | number; error_msg?: string }

/** 贴吧客户端签名：参数按键名排序拼成 k=v 串，加 "tiebaclient!!!" 后取 MD5 大写（与贴吧客户端一致）。 */
export function clientSign(params: Record<string, string>): string {
  const base = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('')
  return md5Hex(`${base}tiebaclient!!!`).toUpperCase()
}

async function tbs(session: HttpSession): Promise<string> {
  const body = await session.json<Tbs>({ url: `${WEB}/dc/common/tbs`, headers: HEADERS })
  if (body.is_login !== 1 || !body.tbs) throw new LoginExpiredError('百度贴吧登录已过期，请重新登录')
  return body.tbs
}

/** 关注的吧及其今日签到状态。 */
export async function likedForums(session: HttpSession): Promise<Forum[]> {
  const body = await session.json<MoIndex>({ url: `${WEB}/mo/q/newmoindex`, headers: HEADERS })
  if (body.no !== undefined && body.no !== 0) {
    if (body.no === 1 || /未登录|登录/.test(body.error ?? '')) throw new LoginExpiredError('百度贴吧登录已过期，请重新登录')
    throw new NetworkError(`读取关注的吧失败：${body.error ?? body.no}`)
  }
  return body.data?.like_forum ?? []
}

const signed = (forum: Forum | undefined): boolean => forum?.is_sign === 1 || forum?.is_sign === true
const STOP = /验证码|安全验证|频繁|风控|异常/

export const tieba: Platform = {
  id: 'tieba',
  name: '百度贴吧',
  loginHint: '在打开的百度官方登录窗口里登录（可扫码或输入账号，验证码请自己完成）',
  tasks: [SIGN_ALL],
  appName: '百度贴吧',
  webLogin: { url: 'https://passport.baidu.com/v2/?login&u=https%3A%2F%2Ftieba.baidu.com%2F', domains: ['baidu.com'], requiredCookies: ['BDUSS', 'STOKEN'], cookieUrls: ['https://passport.baidu.com/', 'https://tieba.baidu.com/'] },

  async profile(session) {
    await tbs(session)
    const body = await session.json<{ no?: number; data?: { user_name_show?: string; user_portrait?: string } }>({ url: `${WEB}/f/user/json_userinfo`, headers: HEADERS })
    if (body.no !== 0 || !body.data?.user_portrait) throw new LoginExpiredError('百度贴吧登录已过期，请重新登录')
    return { uid: body.data.user_portrait, nickname: body.data.user_name_show || '贴吧用户' }
  },

  async run(taskIds, ctx) {
    if (!taskIds.includes(SIGN_ALL.id)) return []
    return [await signAll(ctx)]
  },
}

async function signAll(ctx: TaskContext): Promise<TaskResult> {
  const token = await tbs(ctx.session)
  const before = await likedForums(ctx.session)
  if (!before.length) return result(SIGN_ALL, 'failed', '没有读取到你关注的吧（请确认账号至少关注了一个吧）')
  const pending = before.filter((forum) => !signed(forum))
  if (!pending.length) return result(SIGN_ALL, 'already', `关注的 ${before.length} 个吧今天都已经签过了`)

  const errors = new Map<string, string>()
  let stoppedEarly = ''
  for (const [index, forum] of pending.entries()) {
    const params: Record<string, string> = { BDUSS: ctx.session.cookies.BDUSS ?? '', fid: String(forum.forum_id), kw: forum.forum_name, tbs: token }
    try {
      const body = await ctx.session.json<ClientSign>({ method: 'POST', url: `${CLIENT}/c/c/forum/sign`, form: { ...params, sign: clientSign(params) } })
      const code = String(body.error_code ?? '')
      if (code !== '0' && code !== '160002') {
        errors.set(forum.forum_name, body.error_msg || `错误码 ${code}`)
        if (STOP.test(body.error_msg ?? '')) { stoppedEarly = body.error_msg ?? '触发安全验证'; break }
      }
    } catch (error) {
      if (error instanceof LoginExpiredError) throw error
      errors.set(forum.forum_name, (error as Error).message)
    }
    if (index < pending.length - 1) await ctx.sleep(400 + Math.floor(Math.random() * 400))
  }

  // 以重新读取的签到状态为准
  await ctx.sleep(1000)
  const after = new Map((await likedForums(ctx.session)).map((forum) => [forum.forum_name, forum]))
  const newly = pending.filter((forum) => signed(after.get(forum.forum_name)))
  const notDone = pending.filter((forum) => !signed(after.get(forum.forum_name)))
  const already = before.length - pending.length
  const summary = `共 ${before.length} 个吧：新签到 ${newly.length}，原本已签 ${already}，未成功 ${notDone.length}`
  if (!notDone.length) return result(SIGN_ALL, 'success', summary)
  const reasons = notDone.slice(0, 3).map((forum) => `${forum.forum_name}吧：${errors.get(forum.forum_name) ?? '签到后状态仍为未签到'}`)
  const more = notDone.length > 3 ? ` 等 ${notDone.length} 个` : ''
  return result(SIGN_ALL, 'failed', `${summary}（${reasons.join('；')}${more}）${stoppedEarly ? `。已暂停：${stoppedEarly}，请稍后再试` : ''}`)
}
