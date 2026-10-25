import { CapacitorHttp } from '@capacitor/core'
import { blockedMessage, isAllowedUrl, NetworkError, type Transport } from '../../src/main/core/http'

/**
 * Android 原生 HTTP（绕过 WebView 的 CORS / Cookie 限制，可自由设置 Cookie、Referer、User-Agent）。
 * 关闭自动跳转、手动跟随，每一跳都重新检查域名白名单。
 */
export const nativeTransport: Transport = async (request) => {
  let url = request.url
  let { method, data } = request
  for (let hop = 0; hop <= 3; hop++) {
    if (!isAllowedUrl(url)) throw new NetworkError(blockedMessage(url, hop > 0))
    const headers = { ...request.headers }
    const type = String(Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '')
    // 原生层对表单要求传对象，这里把已编码的字符串还原
    const body = typeof data === 'string' && type.includes('x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(data)) : data
    const response = await CapacitorHttp.request({
      url, method, headers, data: body,
      params: request.params ? Object.fromEntries(Object.entries(request.params).map(([k, v]) => [k, String(v)])) : undefined,
      connectTimeout: request.timeoutMs, readTimeout: request.timeoutMs, disableRedirects: true, responseType: 'text',
    })
    const lower: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(response.headers ?? {})) lower[key.toLowerCase()] = value
    const location = lower.location
    if (response.status >= 300 && response.status < 400 && typeof location === 'string') {
      url = new URL(location, url).toString()
      if (response.status !== 307 && response.status !== 308) { method = 'GET'; data = undefined }
      request = { ...request, params: undefined }
      continue
    }
    let parsed: unknown = response.data
    if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch { /* 非 JSON，按文本返回 */ } }
    return { status: response.status, headers: lower, data: parsed }
  }
  throw new NetworkError('跳转次数过多')
}
