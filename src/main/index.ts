import { app, BrowserWindow, Notification, ipcMain, powerMonitor, safeStorage, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Store, type Cipher } from './core/store.js'
import { CheckinService } from './core/service.js'
import { AIProviderConfigSchema, UpdateAccountSchema } from '../shared/schemas.js'
import { createAppTray, resourcePath, type TrayController } from './tray.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
let tray: TrayController | null = null
let mainWindow: BrowserWindow | null = null
let allowQuit = false
let timer: NodeJS.Timeout | undefined

/** 使用操作系统钥匙串加密（Windows DPAPI / macOS Keychain / Linux libsecret）。不可用时退化为明文并在日志中提示。 */
const cipher: Cipher = {
  encrypt: (plain) => safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(plain).toString('base64')}` : `raw:${Buffer.from(plain).toString('base64')}`,
  decrypt: (value) => value.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(value.slice(4), 'base64')) : Buffer.from(value.replace(/^raw:/, ''), 'base64').toString('utf8'),
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
  if (!safeStorage.isEncryptionAvailable()) console.warn('系统钥匙串不可用，登录信息将仅做编码保存')
  const store = new Store(join(app.getPath('userData'), 'autocheckin-v2.json'), cipher)
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
  ipcMain.handle('qr:cancel', (_e, id: string) => service.cancelQrLogin(String(id)))
  ipcMain.handle('account:update', (_e, input: unknown) => service.update(UpdateAccountSchema.parse(input)))
  ipcMain.handle('account:remove', (_e, id: string) => service.remove(String(id)))
  ipcMain.handle('account:run', (_e, id: string) => service.runNow(String(id)))
  ipcMain.handle('account:explain', (_e, id: string) => service.explainFailure(String(id)))
  ipcMain.handle('settings', () => service.settings())
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
