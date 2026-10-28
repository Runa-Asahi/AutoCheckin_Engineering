import { LoginExpiredError, NetworkError, type HttpSession } from '../http.js'
import { result, type Platform, type TaskContext } from '../platform.js'
import type { PlatformTaskInfo, TaskResult } from '../../../shared/types.js'
import { eapi, weapi } from './neteaseCrypto.js'
import { randomHex } from '../portable.js'

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

/** 客户端设备档案，取值与 NeteaseCloudMusicApi util/request.js 的 osMap / userAgentMap 一致。 */
const DEVICES = {
  /** alpha.1 实测可用的组合（PC 设备头 + iPhone UA，同 NeteaseCloudMusicApi 默认）：扫码登录与电脑端签到均已验证，保持不变。 */
  default: { os: 'pc', appver: '3.1.17.204416', osver: 'Microsoft-Windows-10-Professional-build-19045-64bit', channel: 'netease', mobilename: '', resolution: '1920x1080', ua: 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)' },
  android: { os: 'android', appver: '8.20.20.231215173437', osver: '14', channel: 'xiaomi', mobilename: '23013RK75C', resolution: '1080x2400', ua: 'NeteaseMusic/9.1.65.240927161425(9001065);Dalvik/2.1.0 (Linux; U; Android 14; 23013RK75C Build/UKQ1.230804.001)' },
} as const
export type NeteaseDevice = keyof typeof DEVICES

/** 客户端（eapi）调用：Cookie 由设备头 + MUSIC_U 组成；device 决定模拟电脑客户端还是安卓 App。 */
export async function eapiCall<T extends Coded>(session: HttpSession, uri: string, data: Record<string, unknown> = {}, device: NeteaseDevice = 'default'): Promise<T> {
  if (!session.cookies.deviceId) session.cookies.deviceId = randomHex(52).toUpperCase()
  const profile = DEVICES[device]
  const header: Record<string, string> = {
    osver: profile.osver, deviceId: session.cookies.deviceId, os: profile.os, appver: profile.appver,
    versioncode: '140', mobilename: profile.mobilename, buildver: String(Math.floor(Date.now() / 1000)), resolution: profile.resolution,
    __csrf: session.cookies.__csrf ?? '', channel: profile.channel, requestId: `${Date.now()}_${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
  }
  if (session.cookies.MUSIC_U) header.MUSIC_U = session.cookies.MUSIC_U
  const cookie = Object.entries(header).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('; ')
  const body = eapi(uri, { ...data, e_r: false, header })
  return session.json<T>({ method: 'POST', url: `${EAPI_ORIGIN}/eapi/${uri.replace(/^\/api\//, '')}`, form: body, headers: { Cookie: cookie, 'User-Agent': profile.ua }, rawCookie: true })
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
  appName: '网易云音乐',
  // orpheus://openurl?url= 在网易云 App 内置浏览器打开链接
  appLink: (content) => `orpheus://openurl?url=${encodeURIComponent(content)}`,
  mobileLogin: { url: 'https://y.music.163.com/m/login', domains: ['163.com', '126.net'], requiredCookies: ['MUSIC_U'], cookieUrls: ['https://music.163.com/'] },
  tasks: [MOBILE, PC],

  async qrStart(session) {
    const body = await eapiCall<Coded & { unikey?: string }>(session, '/api/login/qrcode/unikey', { type: 3 }, 'default')
    if (body.code !== 200 || !body.unikey) throw new NetworkError(`获取二维码失败：${reason(body)}`)
    return { key: body.unikey, content: `https://music.163.com/login?codekey=${body.unikey}` }
  },

  async qrPoll(session, key) {
    const body = await eapiCall<Coded & { nickname?: string }>(session, '/api/login/qrcode/client/login', { key, type: 3 }, 'default')
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

interface Attempt { name: string; send: () => Promise<Coded & { point?: number; data?: { point?: number } }> }

/**
 * 手机端：先以安卓 App 身份调用 dailyTask(type=0)；若状态仍未签到，再调用 App 内“云贝签到”接口
 * （NeteaseCloudMusicApi yunbei_sign：/api/pointmall/user/sign）。电脑端：以 PC 客户端身份 dailyTask(type=1)。
 * 每一步之后都查询状态，只认状态接口。
 */
function attemptsFor(ctx: TaskContext, type: 0 | 1): Attempt[] {
  if (type === 1) return [{ name: 'PC 客户端签到', send: () => eapiCall(ctx.session, '/api/point/dailyTask', { type: 1 }, 'default') }]
  return [
    { name: '安卓 App 签到', send: () => eapiCall(ctx.session, '/api/point/dailyTask', { type: 0 }, 'android') },
    { name: 'App 云贝签到', send: () => weapiCall(ctx.session, 'pointmall/user/sign') },
  ]
}

async function verify(ctx: TaskContext, flag: keyof SignStatus): Promise<{ ok: boolean; error: string }> {
  let error = ''
  for (let i = 0; i < 3; i++) {
    try { if ((await signStatus(ctx.session))[flag]) return { ok: true, error: '' } } catch (caught) {
      if (caught instanceof LoginExpiredError) throw caught
      error = (caught as Error).message
    }
    await ctx.sleep(1500)
  }
  return { ok: false, error }
}

async function signOnce(ctx: TaskContext, task: PlatformTaskInfo, type: 0 | 1, flag: keyof SignStatus, alreadyBefore: boolean | undefined): Promise<TaskResult> {
  if (alreadyBefore === true) return result(task, 'already', '今天已经签过了')
  const notes: string[] = []
  let anySent = false
  for (const attempt of attemptsFor(ctx, type)) {
    let response: Coded & { point?: number; data?: { point?: number } }
    try { response = await attempt.send() } catch (error) { notes.push(`${attempt.name}：请求失败（${(error as Error).message}）`); continue }
    anySent = true
    if (response.code === 301) throw new LoginExpiredError('网易云音乐登录已过期，请重新扫码')
    // 不论接口返回什么，都以状态接口为准，避免“接口说成功但实际没签上”
    const checked = await verify(ctx, flag)
    if (checked.ok) {
      const point = response.point ?? response.data?.point
      if (response.code === 200) return result(task, 'success', point ? `签到成功，获得 ${point} 积分` : '签到成功')
      return result(task, 'already', '今天已经签过了')
    }
    notes.push(`${attempt.name}：${response.code === 200 ? '接口返回成功，但平台状态显示仍未签到' : `平台返回 ${reason(response)}`}${checked.error ? `（确认失败：${checked.error}）` : ''}`)
  }
  return result(task, 'failed', anySent ? notes.join('；') : notes.join('；') || '签到请求失败')
}
