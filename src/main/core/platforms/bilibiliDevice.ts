import { randomHex, randomBytesArray, randomInt, toBase64 } from '../portable.js'
import { DESKTOP_UA, type HttpSession } from '../http.js'

const API = 'https://api.bilibili.com'
const HEADERS = { Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com' }

/**
 * 网页设备指纹激活。
 *
 * 背景（BiliBiliToolPro LoginDomainService / IGaiaApi 注释，2026-09 实测；bilibili-API-collect issue #933）：
 * finger/spi 生成的 buvid3/buvid4 在服务端没有设备档案，直接用于 share/add、coin/add 会被拒（-403“账号异常”/“非法访问”）。
 * 需要先用同一组 Cookie（buvid3/buvid4/b_nut/_uuid）和一致的 UA 向 gaia 网关 ExClimbWuzhi 上报一次设备特征。
 * 以 _uuid 是否存在作为“已激活”标记；激活后设备保持不变，不每天刷新（刷新会丢档案）。
 *
 * 载荷字段是 B 站前端的混淆键名；以下取值为本项目自拟的一台普通 Windows Chrome 设备，与 DESKTOP_UA 保持一致。
 */
export function deviceUuid(): string {
  const hex = randomHex(36).toUpperCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}${String(Date.now() % 100000).padStart(5, '0')}infoc`
}

const SCREENS: Array<[number, number, number]> = [[1920, 1080, 1032], [1536, 864, 816], [2560, 1440, 1392], [1440, 900, 852]]

export function gaiaPayload(uuid: string, now = Date.now()): string {
  const [w, h, ah] = SCREENS[randomInt(SCREENS.length)]
  const canvasTail = toBase64(randomBytesArray(12))
  const content = {
    '3064': 1, '5062': String(now), '03bf': 'https%3A%2F%2Fwww.bilibili.com%2F', '39c8': '333.1007.fp.risk',
    '34f1': '', 'd402': '', '654a': '', '6e7c': `${w - 600}x${ah - 100}`,
    '3c43': {
      '2673': 0, '5766': 24, '6527': 0, '7003': 1, '807e': 1, 'b8ce': DESKTOP_UA, '641c': 0, '07a4': 'zh-CN', '1c57': 'not available', '0bd0': 8,
      '748e': [w, h], 'd61f': [w, ah], 'fc9d': -480, '6aa9': 'Asia/Shanghai', '75b8': 1, '3b21': 1, '8a1c': 0, 'd52f': 'not available', 'adca': 'Win32',
      '80c9': [['PDF Viewer', 'Portable Document Format', [['application/pdf', 'pdf'], ['text/pdf', 'pdf']]], ['Chrome PDF Viewer', 'Portable Document Format', [['application/pdf', 'pdf'], ['text/pdf', 'pdf']]]],
      '13ab': `iVBORw0KGgoAAAANSUhEUgAA${canvasTail}`, 'bfe9': `aTot0S1jJ7Ws0JC6QkvAL/A${canvasTail}`,
      'a3c1': ['webgl version:WebGL 1.0 (OpenGL ES 2.0 Chromium)', 'webgl vendor:WebKit', 'webgl renderer:WebKit WebGL', 'webgl unmasked vendor:Google Inc. (Intel)', 'webgl unmasked renderer:ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
      '6bc5': 'Google Inc. (Intel)~ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ed31': 0, '72bd': 0, '097b': 0, '52cd': [0, 0, 0],
      'a658': ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Microsoft YaHei', 'SimHei', 'SimSun', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Verdana'],
      'd02f': '124.04347527516074',
    },
    '54ef': '{"in_new_ab":true}', '8b94': 'https%3A%2F%2Fwww.bilibili.com%2F', 'df35': uuid, '07a4': 'zh-CN', '5f45': null, 'db46': 0,
  }
  return JSON.stringify(content)
}

/** 确保已有设备指纹并已激活。返回说明文字用于日志；失败不抛错（不影响其它任务）。 */
export async function ensureDevice(session: HttpSession): Promise<string> {
  const c = session.cookies
  if (c.buvid3 && c._uuid) return '设备指纹已激活'
  if (!c.buvid3) {
    try {
      const body = await session.json<{ code: number; data?: { b_3?: string; b_4?: string } }>({ url: `${API}/x/frontend/finger/spi`, headers: HEADERS })
      if (body.data?.b_3) c.buvid3 = body.data.b_3
      if (body.data?.b_4) c.buvid4 = body.data.b_4
    } catch { /* 下面统一处理 */ }
    if (!c.buvid3) return '获取设备指纹失败'
  }
  if (!c.b_nut) c.b_nut = String(Math.floor(Date.now() / 1000))
  const uuid = deviceUuid()
  try {
    const cookie = ['buvid3', 'buvid4', 'b_nut'].filter((k) => c[k]).map((k) => `${k}=${c[k]}`).concat(`_uuid=${uuid}`).join('; ')
    const body = await session.json<{ code: number; message?: string }>({ method: 'POST', url: `${API}/x/internal/gaia-gateway/ExClimbWuzhi`, headers: { ...HEADERS, Cookie: cookie }, rawCookie: true, json: { payload: gaiaPayload(uuid) } })
    if (body.code === 0) { c._uuid = uuid; return '设备指纹激活成功' }
    return `设备指纹激活失败：${body.message ?? body.code}`
  } catch (error) { return `设备指纹激活失败：${(error as Error).message}` }
}
