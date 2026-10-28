import { app, BrowserWindow, Notification, ipcMain, powerMonitor, safeStorage, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Store, type Cipher } from './core/store.js'
import { createLocalKeyCipher } from './core/localCipher.js'
import { filePersistence } from './core/filePersistence.js'
import { getPlatform } from './core/platforms/index.js'
import type { WebLogin } from './core/platform.js'
import { randomUUID } from 'node:crypto'
import { CheckinService } from './core/service.js'
import { AIProviderConfigSchema, UpdateAccountSchema } from '../shared/schemas.js'
import { createAppTray, resourcePath, type TrayController } from './tray.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
let tray: TrayController | null = null
let mainWindow: BrowserWindow | null = null
let allowQuit = false
let timer: NodeJS.Timeout | undefined

/**
 * 凭据加密：优先使用操作系统钥匙串（Windows DPAPI / macOS Keychain / Linux libsecret）。
 * 钥匙串不可用时改用本地 AES-256-GCM 密钥（0600），并在设置页明确提示；任何情况下都不明文保存。
 */
let keychainAvailable = true
function createCipher(): Cipher {
  keychainAvailable = safeStorage.isEncryptionAvailable()
  const local = createLocalKeyCipher(join(app.getPath('userData'), 'local.key'))
  return {
    encrypt: (plain) => keychainAvailable ? `enc:${safeStorage.encryptString(plain).toString('base64')}` : local.encrypt(plain),
    decrypt: (value) => {
      if (value.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
      // alpha.1 在无钥匙串时的旧格式：读出后下次保存即改为加密格式
      if (value.startsWith('raw:')) return Buffer.from(value.slice(4), 'base64').toString('utf8')
      return local.decrypt(value)
    },
  }
}

/** 打开平台官方登录页（独立、不持久化的会话），用户自行登录后截获声明的登录 Cookie。 */
function openWebLogin(platformId: string, login: WebLogin, parent: BrowserWindow | null): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const partition = `login-${randomUUID()}`
    const window = new BrowserWindow({ width: 480, height: 720, parent: parent ?? undefined, modal: Boolean(parent), title: '登录', autoHideMenuBar: true, webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true } })
    const allowed = (raw: string): boolean => { try { const host = new URL(raw).hostname; return login.domains.some((d) => host === d || host.endsWith(`.${d}`)) } catch { return false } }
    window.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault() })
    window.webContents.setWindowOpenHandler(({ url }) => { if (allowed(url)) void window.loadURL(url); return { action: 'deny' } })
    let done = false
    const finish = (value: Record<string, string> | null): void => {
      if (done) return
      done = true; clearInterval(timer)
      const ses = window.webContents.session
      if (!window.isDestroyed()) window.destroy()
      void ses.clearStorageData()
      resolve(value)
    }
    const timer = setInterval(async () => {
      if (window.isDestroyed()) return finish(null)
      const ses = window.webContents.session
      const jar: Record<string, string> = {}
      if (login.cookieUrls?.length) {
        for (const url of login.cookieUrls) for (const cookie of await ses.cookies.get({ url })) jar[cookie.name] = cookie.value
      } else {
        for (const cookie of await ses.cookies.get({})) {
          const domain = (cookie.domain ?? '').replace(/^\./, '')
          if (login.domains.some((d) => domain === d || domain.endsWith(`.${d}`))) jar[cookie.name] = cookie.value
        }
      }
      if (login.requiredCookies.every((name) => jar[name] && jar[name] !== '0')) finish(jar)
    }, 1000)
    window.on('closed', () => finish(null))
    void window.loadURL(login.url)
    console.info(`已打开 ${platformId} 登录窗口`)
  })
}

function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); return }
  const window = new BrowserWindow({
    width: 1040, height: 760, minWidth: 820, minHeight: 600, show: false, title: 'AutoCheckin', autoHideMenuBar: true, icon: resourcePath('icon.png'), backgroundColor: '#f5f7fb',
    webPreferences: { preload: join(currentDir, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => { if (tray && !allowQuit) { event.preventDefault(); window.hide() } })
  window.on('closed', () => { if (mainWindow === window) mainWindow = null })
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(currentDir, '../renderer/index.html'))
  mainWindow = window
}

async function start(): Promise<void> {
  const cipher = createCipher()
  if (!keychainAvailable) console.warn('系统钥匙串不可用，已改用本地密钥加密登录信息')
  const store = new Store(filePersistence(join(app.getPath('userData'), 'autocheckin-v2.json')), cipher)
  const broadcast = (channel: string, payload: unknown): void => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload) }
  const service = new CheckinService(store, {
    onChange: (accounts) => broadcast('accounts:changed', accounts),
    notify: (title, body) => { if (Notification.isSupported()) { const n = new Notification({ title, body }); n.on('click', showMainWindow); n.show() } },
  })
  const applyAutoLaunch = (enabled: boolean): void => { try { app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] }) } catch (e) { console.error(e) } tray?.rebuild() }

  ipcMain.handle('platforms', () => service.platforms())
  ipcMain.handle('accounts', () => service.accounts())
  ipcMain.handle('qr:start', (_e, platform: string) => service.startQrLogin(String(platform)))
  ipcMain.handle('qr:poll', (_e, id: string) => service.pollQrLogin(String(id)))
  ipcMain.handle('web:login', async (_e, platformId: string) => {
    const platform = getPlatform(String(platformId))
    const login = service.loginFor(platform.id)
    if (!login) return { state: 'error', message: '该平台不支持网页登录' }
    const cookies = await openWebLogin(platform.id, login, mainWindow)
    if (!cookies) return { state: 'expired', message: '登录窗口已关闭' }
    return service.completeWebLogin(platform.id, cookies)
  })
  ipcMain.handle('qr:cancel', (_e, id: string) => service.cancelQrLogin(String(id)))
  ipcMain.handle('account:update', (_e, input: unknown) => service.update(UpdateAccountSchema.parse(input)))
  ipcMain.handle('account:remove', (_e, id: string) => service.remove(String(id)))
  ipcMain.handle('account:run', (_e, id: string) => service.runNow(String(id)))
  ipcMain.handle('account:explain', (_e, id: string) => service.explainFailure(String(id)))
  ipcMain.handle('settings', () => ({ ...service.settings(), keychainAvailable }))
  ipcMain.handle('settings:save', (_e, raw: { notifications?: boolean; autoLaunch?: boolean; ai?: Record<string, unknown> }) => {
    const ai = raw.ai ? { ...AIProviderConfigSchema.partial().parse(raw.ai), ...(typeof raw.ai.enabled === 'boolean' ? { enabled: raw.ai.enabled } : {}) } : undefined
    const result = service.saveSettings({ notifications: raw.notifications, autoLaunch: raw.autoLaunch, ai })
    if (typeof raw.autoLaunch === 'boolean') applyAutoLaunch(raw.autoLaunch)
    return result
  })
  ipcMain.handle('open-external', (_e, url: string) => { if (/^https:\/\//.test(String(url))) return shell.openExternal(String(url)) })

  const tick = (): void => { void service.tick().catch((error) => console.error('调度失败', error)) }
  timer = setInterval(tick, 60_000); tick()
  powerMonitor.on('resume', tick)
  try {
    tray = createAppTray({
      open: showMainWindow, checkNow: tick, quit: () => { allowQuit = true; app.quit() },
      autoLaunch: () => store.settings().autoLaunch,
      setAutoLaunch: (enabled) => { service.saveSettings({ autoLaunch: enabled }); applyAutoLaunch(enabled) },
      status: () => `AutoCheckin · ${store.accounts().length} 个账号`,
    })
  } catch { tray = null }
  if (!process.argv.includes('--hidden') || !tray) showMainWindow()
}

if (process.platform === 'win32') app.setAppUserModelId('com.autocheckin.desktop')
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', showMainWindow)
  app.whenReady().then(start).catch((error) => { console.error('启动失败', error); app.quit() })
}
app.on('activate', showMainWindow)
app.on('window-all-closed', () => { if (!tray && process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { allowQuit = true; if (timer) clearInterval(timer); tray?.destroy(); tray = null })
