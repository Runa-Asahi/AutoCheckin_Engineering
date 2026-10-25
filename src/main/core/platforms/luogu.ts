import { LoginExpiredError, NetworkError, type HttpSession } from '../http.js'
import { result, type Platform, type TaskContext } from '../platform.js'
import type { PlatformTaskInfo, TaskResult } from '../../../shared/types.js'

const ORIGIN = 'https://www.luogu.com.cn'
const PUNCH: PlatformTaskInfo = { id: 'punch', label: '每日打卡', description: '洛谷首页每日打卡（查看今日运势）', defaultOn: true }

interface PunchResponse { code?: number; message?: string; more?: { html?: string } }

async function homepage(session: HttpSession): Promise<string> {
  const response = await session.request({ url: `${ORIGIN}/`, headers: { Referer: `${ORIGIN}/`, Accept: 'text/html,application/xhtml+xml' } })
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
}

export function csrfToken(html: string): string | null {
  return /<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i.exec(html)?.[1] ?? null
}

/** 首页是否显示“已打卡”。未打卡时首页有“点击打卡”按钮；打卡后显示当日运势（如 § 大吉 §）。 */
export function punchState(html: string): { punched: boolean; fortune: string | null } {
  const fortune = /§\s*([^§<]{1,6}?)\s*§/.exec(html)?.[1]?.trim() ?? null
  const punched = !/点击打卡/.test(html) && (Boolean(fortune) || /已打卡|今日已签/.test(html))
  return { punched, fortune }
}

function loggedIn(session: HttpSession, html: string): boolean {
  const uid = session.cookies._uid
  return Boolean(uid && uid !== '0' && !/<title>\s*登录/.test(html))
}

export const luogu: Platform = {
  id: 'luogu',
  name: '洛谷',
  loginHint: '在打开的洛谷官方登录窗口里登录（验证码请自己完成）',
  tasks: [PUNCH],
  appName: '洛谷',
  webLogin: { url: `${ORIGIN}/auth/login`, domains: ['luogu.com.cn'], requiredCookies: ['__client_id', '_uid'], cookieUrls: [`${ORIGIN}/`] },

  async profile(session) {
    const uid = session.cookies._uid
    if (!uid || uid === '0') throw new LoginExpiredError('洛谷登录已过期，请重新登录')
    const body = await session.json<{ currentUser?: { uid?: number; name?: string } | null; currentData?: { user?: { uid?: number; name?: string } } }>({ url: `${ORIGIN}/user/${uid}`, params: { _contentOnly: 1 }, headers: { 'x-luogu-type': 'content-only', Referer: `${ORIGIN}/` } })
    const me = body.currentUser
    if (!me || String(me.uid) !== uid) throw new LoginExpiredError('洛谷登录已过期，请重新登录')
    return { uid, nickname: me.name ?? body.currentData?.user?.name ?? `洛谷用户 ${uid}` }
  },

  async run(taskIds, ctx) {
    if (!taskIds.includes(PUNCH.id)) return []
    return [await punch(ctx)]
  },
}

async function punch(ctx: TaskContext): Promise<TaskResult> {
  const html = await homepage(ctx.session)
  if (!loggedIn(ctx.session, html)) throw new LoginExpiredError('洛谷登录已过期，请重新登录')
  const before = punchState(html)
  if (before.punched) return result(PUNCH, 'already', `今天已经打过卡了${before.fortune ? `（今日运势：${before.fortune}）` : ''}`)
  const token = csrfToken(html)
  if (!token) return result(PUNCH, 'failed', '没有在洛谷首页找到打卡所需的安全令牌，洛谷页面可能改版了')

  let body: PunchResponse
  try {
    body = await ctx.session.json<PunchResponse>({ method: 'POST', url: `${ORIGIN}/index/ajax_punch`, headers: { 'x-csrf-token': token, Referer: `${ORIGIN}/`, Origin: ORIGIN, 'X-Requested-With': 'XMLHttpRequest' } })
  } catch (error) {
    if (error instanceof NetworkError) return result(PUNCH, 'failed', `打卡请求失败：${error.message}`)
    throw error
  }
  await ctx.sleep(800)
  const after = punchState(await homepage(ctx.session))
  if (after.punched) {
    const fortune = after.fortune ? `今日运势：${after.fortune}` : '已确认'
    return result(PUNCH, body.code === 201 ? 'already' : 'success', body.code === 201 ? `今天已经打过卡了（${fortune}）` : `打卡成功（${fortune}）`)
  }
  return result(PUNCH, 'failed', `打卡后首页仍显示未打卡（洛谷返回：${body.message ?? body.code ?? '无'}）`)
}
