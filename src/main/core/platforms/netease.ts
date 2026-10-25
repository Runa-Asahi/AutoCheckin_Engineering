import { LoginExpiredError, NetworkError, type HttpSession } from '../http.js'
import { result, type Platform, type TaskContext } from '../platform.js'
import type { PlatformTaskInfo, TaskResult } from '../../../shared/types.js'
import { eapi, weapi } from './neteaseCrypto.js'
import { randomBytes } from 'node:crypto'

const ORIGIN = 'https://music.163.com'
const HEADERS = { Referer: 'https://music.163.com/', Origin: 'https://music.163.com' }

const MOBILE: PlatformTaskInfo = { id: 'mobile_sign', label: '手机端每日签到', description: '领取每日云贝（等同在 App 里点“签到”）', defaultOn: true }
const PC: PlatformTaskInfo = { id: 'pc_sign', label: '电脑端每日签到', description: '电脑客户端 / 网页端签到积分', defaultOn: true }

interface Coded { code: number; msg?: string; message?: string }
interface SignStatus { mobileSign?: boolean; pcSign?: boolean }

/** 以 weapi 加密方式调用接口（与官方网页端相同的调用方式）。 */
export async function weapiCall<T extends Coded>(session: HttpSession, path: string, data: Record<string, unknown> = {}): Promise<T> {
  const csrf = session.cookies.__csrf ?? ''
  const body = weapi({ ...data, csrf_token: csrf })
  return session.json<T>({ method: 'POST', url: `${ORIGIN}/weapi/${path}`, params: { csrf_token: csrf }, form: body, headers: HEADERS })
}

const EAPI_ORIGIN = 'https://interface.music.163.com'
const CLIENT_UA = 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)'

/** 客户端（eapi）调用：与 NeteaseCloudMusicApi 默认方式一致，Cookie 由设备头 + MUSIC_U 组成。 */
export async function eapiCall<T extends Coded>(session: HttpSession, uri: string, data: Record<string, unknown> = {}): Promise<T> {
  if (!session.cookies.deviceId) session.cookies.deviceId = randomBytes(26).toString('hex').toUpperCase().slice(0, 52)
  const header: Record<string, string> = {
    osver: 'Microsoft-Windows-10-Professional-build-19045-64bit', deviceId: session.cookies.deviceId, os: 'pc', appver: '3.1.17.204416',
    versioncode: '140', mobilename: '', buildver: String(Math.floor(Date.now() / 1000)), resolution: '1920x1080',
    __csrf: session.cookies.__csrf ?? '', channel: 'netease', requestId: `${Date.now()}_${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
  }
  if (session.cookies.MUSIC_U) header.MUSIC_U = session.cookies.MUSIC_U
  const cookie = Object.entries(header).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('; ')
  const body = eapi(uri, { ...data, e_r: false, header })
  return session.json<T>({ method: 'POST', url: `${EAPI_ORIGIN}/eapi/${uri.replace(/^\/api\//, '')}`, form: body, headers: { Cookie: cookie, 'User-Agent': CLIENT_UA }, rawCookie: true })
}

function reason(body: Coded): string { return body.msg ?? body.message ?? `错误码 ${body.code}` }

/** 查询今日签到状态：/weapi/v1/user/info 返回 mobileSign / pcSign。 */
export async function signStatus(session: HttpSession): Promise<SignStatus> {
  const body = await weapiCall<Coded & SignStatus>(session, 'v1/user/info')
  if (body.code === 301) throw new LoginExpiredError('网易云音乐登录已过期，请重新扫码')
  if (body.code !== 200) throw new NetworkError(`无法查询签到状态：${reason(body)}`)
  if (typeof body.mobileSign !== 'boolean' || typeof body.pcSign !== 'boolean') throw new NetworkError('签到状态接口没有返回签到标记，无法确认结果')
  return { mobileSign: body.mobileSign, pcSign: body.pcSign }
}

export const netease: Platform = {
  id: 'netease',
  name: '网易云音乐',
  loginHint: '打开网易云音乐 App，点左上角菜单 → 扫一扫',
  tasks: [MOBILE, PC],

  async qrStart(session) {
    const body = await eapiCall<Coded & { unikey?: string }>(session, '/api/login/qrcode/unikey', { type: 3 })
    if (body.code !== 200 || !body.unikey) throw new NetworkError(`获取二维码失败：${reason(body)}`)
    return { key: body.unikey, content: `https://music.163.com/login?codekey=${body.unikey}` }
  },

  async qrPoll(session, key) {
    const body = await eapiCall<Coded & { nickname?: string }>(session, '/api/login/qrcode/client/login', { key, type: 3 })
    if (body.code === 801) return { state: 'waiting', message: '请用网易云音乐 App 扫码' }
    if (body.code === 802) return { state: 'scanned', message: `已扫码${body.nickname ? `（${body.nickname}）` : ''}，请在手机上确认登录` }
    if (body.code === 800) return { state: 'expired', message: '二维码已过期，请刷新' }
    if (body.code === 803) return session.cookies.MUSIC_U ? { state: 'success', message: '登录成功' } : { state: 'error', message: '登录成功但没有拿到登录凭据，请重试' }
    if (body.code === 8821) return { state: 'error', message: '网易云要求进行安全验证，请稍后重试或先在官方客户端登录一次' }
    return { state: 'error', message: `登录失败：${reason(body)}` }
  },

  async profile(session) {
    const body = await weapiCall<Coded & { account?: { id: number } | null; profile?: { nickname: string; userId: number } | null }>(session, 'nuser/account/get')
    if (body.code === 301 || !body.account || !body.profile) throw new LoginExpiredError('网易云音乐登录已过期，请重新扫码')
    return { uid: String(body.profile.userId), nickname: body.profile.nickname }
  },

  async run(taskIds, ctx) {
    await this.profile(ctx.session)
    let before: SignStatus
    try { before = await signStatus(ctx.session) } catch (error) {
      if (error instanceof LoginExpiredError) throw error
      before = {}
    }
    const out: TaskResult[] = []
    for (const [task, type, flag] of [[MOBILE, 0, 'mobileSign'], [PC, 1, 'pcSign']] as const) {
      if (!taskIds.includes(task.id)) continue
      out.push(await signOnce(ctx, task, type, flag, before[flag]))
    }
    return out
  },
}

async function signOnce(ctx: TaskContext, task: PlatformTaskInfo, type: 0 | 1, flag: keyof SignStatus, alreadyBefore: boolean | undefined): Promise<TaskResult> {
  if (alreadyBefore === true) return result(task, 'already', '今天已经签过了')
  let response: Coded & { point?: number }
  try { response = await eapiCall(ctx.session, '/api/point/dailyTask', { type }) } catch (error) {
    return result(task, 'failed', `签到请求失败：${(error as Error).message}`)
  }
  if (response.code === 301) throw new LoginExpiredError('网易云音乐登录已过期，请重新扫码')
  // 不论接口返回什么，都以状态接口为准，避免“接口说成功但实际没签上”
  let after: SignStatus | undefined, verifyError = ''
  for (let i = 0; i < 3; i++) {
    try { after = await signStatus(ctx.session); if (after[flag]) break } catch (error) {
      if (error instanceof LoginExpiredError) throw error
      verifyError = (error as Error).message
    }
    await ctx.sleep(1500)
  }
  if (after?.[flag]) {
    if (response.code === 200) return result(task, 'success', response.point ? `签到成功，获得 ${response.point} 积分` : '签到成功')
    return result(task, 'already', '今天已经签过了')
  }
  const said = response.code === 200 ? '接口返回成功，但平台状态显示仍未签到' : `平台返回：${reason(response)}`
  return result(task, 'failed', `${said}${verifyError ? `（确认失败：${verifyError}）` : ''}`)
}
