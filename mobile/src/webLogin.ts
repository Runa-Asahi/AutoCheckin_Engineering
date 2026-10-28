import { registerPlugin } from '@capacitor/core'

export interface WebLoginPlugin {
  /** 打开官方登录页（应用内 WebView，只允许访问 domains），检测到 requiredCookies 后返回从 cookieUrls 读到的 Cookie。 */
  open(options: { url: string; domains: string[]; requiredCookies: string[]; cookieUrls: string[] }): Promise<{ cancelled: boolean; cookies?: Record<string, string> }>
}
export const WebLogin = registerPlugin<WebLoginPlugin>('WebLogin')
