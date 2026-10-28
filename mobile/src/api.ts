import { App as CapApp } from '@capacitor/app'
import { LocalNotifications } from '@capacitor/local-notifications'
import { setTransport } from '../../src/main/core/http'
import { Store } from '../../src/main/core/store'
import { CheckinService } from '../../src/main/core/service'
import type { AccountView, AutoCheckinApi } from '../../src/shared/types'
import { nativeTransport } from './nativeTransport'
import { fieldCipher, keystorePersistence } from './secure'
import { WebLogin } from './webLogin'
import { AppBridge } from './appBridge'

const REMINDER_BASE = 1000
let notifySeq = 1

/** 每个启用的账号在设定时间提醒一次；点通知打开 App 即自动执行到期任务。 */
async function scheduleReminders(accounts: AccountView[]): Promise<void> {
  const pending = await LocalNotifications.getPending()
  const ours = pending.notifications.filter((n) => n.id >= REMINDER_BASE)
  if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) })
  const enabled = accounts.filter((a) => a.enabled && !a.loginExpired)
  if (!enabled.length) return
  const times = [...new Set(enabled.map((a) => a.time))]
  await LocalNotifications.schedule({
    notifications: times.map((time, index) => {
      const [hour, minute] = time.split(':').map(Number)
      return { id: REMINDER_BASE + index, title: 'AutoCheckin', body: '到签到时间了，点这里打开即可自动完成今天的签到', schedule: { on: { hour, minute }, allowWhileIdle: true } }
    }),
  })
}

export async function createMobileApi(): Promise<AutoCheckinApi> {
  setTransport(nativeTransport)
  const persistence = await keystorePersistence()
  const store = new Store(persistence, await fieldCipher())
  const listeners = new Set<(accounts: AccountView[]) => void>()
  const service = new CheckinService(store, {
    mobile: true,
    onChange: (accounts) => { for (const listener of listeners) listener(accounts); void scheduleReminders(accounts).catch(() => undefined) },
    notify: (title, body) => { void LocalNotifications.schedule({ notifications: [{ id: notifySeq++ % REMINDER_BASE, title, body }] }).catch(() => undefined) },
  })
  void LocalNotifications.requestPermissions().catch(() => undefined)
  void scheduleReminders(service.accounts()).catch(() => undefined)

  // 前台时每分钟检查；从后台回到前台（含点通知打开）立即检查一次
  const tick = (): void => { void service.tick().catch((error) => console.error('调度失败', (error as Error).message)) }
  let timer: ReturnType<typeof setInterval> | undefined = setInterval(tick, 60_000)
  tick()
  void CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) { tick(); timer ??= setInterval(tick, 60_000) } else { if (timer) clearInterval(timer); timer = undefined; void persistence.flush() }
  })

  return {
    platforms: async () => service.platforms(),
    accounts: async () => service.accounts(),
    startQrLogin: async (platform) => service.startQrLogin(platform),
    pollQrLogin: async (id) => service.pollQrLogin(id),
    cancelQrLogin: async (id) => service.cancelQrLogin(id),
    webLogin: async (platform) => {
      const login = service.loginFor(platform)
      if (!login) return { state: 'error', message: '该平台不支持网页登录' }
      const result = await WebLogin.open({ url: login.url, domains: login.domains, requiredCookies: login.requiredCookies, cookieUrls: login.cookieUrls ?? login.domains.map((d) => `https://${d}/`) })
      if (result.cancelled || !result.cookies) return { state: 'expired', message: '登录页已关闭' }
      return service.completeWebLogin(platform, result.cookies)
    },
    updateAccount: async (input) => service.update(input),
    removeAccount: async (id) => service.remove(id),
    runNow: (id) => service.runNow(id),
    settings: async () => ({ ...service.settings(), keychainAvailable: true, mobile: true }),
    saveSettings: async (input) => ({ ...service.saveSettings({ ...input, autoLaunch: false }), keychainAvailable: true, mobile: true }),
    explainFailure: (id) => service.explainFailure(id),
    onAccountsChanged: (callback) => { listeners.add(callback); return () => listeners.delete(callback) },
    openExternal: async (url) => { if (/^https:\/\//.test(url)) window.open(url, '_blank') },
    openApp: async (url) => (await AppBridge.openApp({ url })).opened,
    saveImage: async (dataUrl, fileName) => AppBridge.saveImage({ base64: dataUrl.replace(/^data:image\/\w+;base64,/, ''), fileName }),
  }
}
