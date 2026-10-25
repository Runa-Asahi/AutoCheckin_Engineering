import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.github.runaasahi.autocheckin',
  appName: 'AutoCheckin',
  webDir: 'mobile/dist',
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  plugins: {
    // 打开后 fetch/XHR 也走原生层（AI 解释请求不受 CORS 限制）；签到请求本身走 nativeTransport
    CapacitorHttp: { enabled: true },
    // 不让 WebView 与原生共享 Cookie：登录信息只在加密存储里
    CapacitorCookies: { enabled: false },
  },
}
export default config
