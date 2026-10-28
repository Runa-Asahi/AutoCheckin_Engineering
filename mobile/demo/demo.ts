// 仅用于截图/界面演示的假数据，不会打进 APK
import { createApp } from 'vue'
import QRCode from 'qrcode'
import '../src/ui/theme.css'
import MobileApp from '../src/ui/MobileApp.vue'
import type { AccountView, AutoCheckinApi, PlatformInfo, RunRecord } from '../../src/shared/types'

const params = new URLSearchParams(location.search)
const empty = params.get('scene') === 'empty'
const d = new Date(); const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const at = (h: number, m: number): string => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.toISOString() }
const t = (id: string, label: string, description: string) => ({ id, label, description, defaultOn: true })
const platforms: PlatformInfo[] = [
  { id: 'netease', name: '网易云音乐', appName: '网易云音乐', loginHint: '', loginKind: 'qr', webFallback: true, tasks: [t('sign', '每日签到', '手机端 + 电脑端签到'), t('yunbei', '云贝签到', '领取每日云贝')] },
  { id: 'bilibili', name: '哔哩哔哩', appName: '哔哩哔哩', loginHint: '', loginKind: 'qr', webFallback: true, tasks: [t('watch', '观看视频', '+5 经验'), t('share', '分享视频', '+5 经验'), t('coin', '投币', '最多 +50 经验'), t('manga', '漫画签到', '每日签到')] },
  { id: 'tieba', name: '百度贴吧', appName: '百度贴吧', loginHint: '', loginKind: 'web', tasks: [t('sign', '关注的吧签到', '签到所有关注的吧')] },
]
const run = (results: RunRecord['results'], h = 8, m = 1): RunRecord => ({ at: at(h, m), date, trigger: 'schedule', attempt: 1, results })
const accounts: AccountView[] = empty ? [] : [
  { id: 'a1', platform: 'bilibili', platformName: '哔哩哔哩', nickname: '晴天的小鹿', uid: '1', enabled: true, time: '08:00', tasks: { watch: true, share: true, coin: true, manga: true }, loginExpired: false, running: false,
    lastRun: run([{ taskId: 'watch', label: '观看视频', status: 'success', message: '已确认 +5 经验' }, { taskId: 'share', label: '分享视频', status: 'success', message: '已确认 +5 经验' }, { taskId: 'coin', label: '投币', status: 'failed', message: '硬币不足（剩余 0 个）' }, { taskId: 'manga', label: '漫画签到', status: 'already', message: '今天已签到' }]), history: [] },
  { id: 'a2', platform: 'netease', platformName: '网易云音乐', nickname: '夜航星', uid: '2', enabled: true, time: '08:00', tasks: { sign: true, yunbei: true }, loginExpired: false, running: false,
    lastRun: run([{ taskId: 'sign', label: '每日签到', status: 'success', message: '手机端 +3、电脑端 +5 已确认' }, { taskId: 'yunbei', label: '云贝签到', status: 'success', message: '已领取 2 云贝' }], 8, 0), history: [] },
  { id: 'a3', platform: 'tieba', platformName: '百度贴吧', nickname: 'runa_s', uid: '3', enabled: true, time: '09:30', tasks: { sign: true }, loginExpired: false, running: false,
    lastRun: run([{ taskId: 'sign', label: '关注的吧签到', status: 'success', message: '共 12 个吧：新签到 11，原本已签 1，未成功 0' }], 9, 30), history: [] },
]
for (const a of accounts) if (a.lastRun) a.history = [a.lastRun, { ...a.lastRun, date: '2026-10-24', at: new Date(Date.parse(a.lastRun.at) - 864e5).toISOString() }]
const settings = { notifications: true, autoLaunch: false, keychainAvailable: true, mobile: true, ai: { enabled: false, provider: 'deepseek' as const, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hasKey: false } }

const api: AutoCheckinApi = {
  platforms: async () => platforms, accounts: async () => accounts,
  startQrLogin: async (p) => { const content = `https://passport.bilibili.com/h5-app/passport/login/scan?navhide=1&qrcode_key=demo${p}`; return { sessionId: 's', content, appLink: `bilibili://browser?url=${encodeURIComponent(content)}`, image: await QRCode.toDataURL(content, { width: 600, margin: 3 }) } },
  pollQrLogin: async () => ({ state: 'waiting', message: '' }), cancelQrLogin: async () => undefined,
  webLogin: () => new Promise(() => undefined), updateAccount: async (i) => ({ ...accounts.find((a) => a.id === i.id)!, ...i }) as AccountView, removeAccount: async () => undefined,
  runNow: async (id) => accounts.find((a) => a.id === id)!, settings: async () => settings, saveSettings: async () => settings,
  explainFailure: async () => '', onAccountsChanged: () => () => undefined, openExternal: async () => undefined,
  openApp: async () => true, saveImage: async () => ({ saved: true }),
}
window.api = api
createApp(MobileApp).mount('#app')
