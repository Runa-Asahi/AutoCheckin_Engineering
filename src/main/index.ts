import { app, BrowserWindow, Notification, ipcMain, nativeImage, powerMonitor } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppDatabase } from './database/index.js'
import { CredentialEncryptor, DatabaseKeyDeriver, MasterPasswordManager } from './security/crypto.js'
import { AdapterRegistry } from './adapters/adapterRegistry.js'
import { TaskService } from './services/taskService.js'
import { TaskScheduler } from './services/taskScheduler.js'
import { ScheduleStore } from './services/scheduleStore.js'
import { isSilentLaunch, loginItemOptions, shouldKeepRunningWhenWindowsClose, unlockRequirement } from './services/lifecyclePolicy.js'
import { registerIpc } from './ipc/register.js'
import { StatisticsService } from './services/statisticsService.js'
import { NotificationService } from './services/notificationService.js'
import { BackupService } from './services/backupService.js'
import { AIGuideService } from './ai/aiGuideService.js'
import { createAppTray, resourcePath, type TrayController } from './tray.js'

const currentDir = dirname(fileURLToPath(import.meta.url))

function windowIconPath(): string | undefined {
  return resourcePath('icon.png')
}

function brandDataUrl(): string {
  const path = windowIconPath()
  if (!path) return ''
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) return ''
  return image.resize({ width: 128, height: 128, quality: 'best' }).toDataURL()
}

let database: AppDatabase | undefined
let scheduler: TaskScheduler | undefined
let bootstrapping = true
let allowQuit = false
let launchSilently = false
let tray: TrayController | null = null
let mainWindow: BrowserWindow | null = null
let unlockWindow: BrowserWindow | null = null

async function requestMasterPassword(manager: MasterPasswordManager): Promise<string> {
  const stored = await manager.getMasterPassword()
  if (stored) return stored
  const setup = !(await manager.isSet())
  return new Promise((resolve, reject) => {
    let completed = false
    const window = new BrowserWindow({ width: 470, height: 560, resizable: false, maximizable: false, minimizable: false, show: true, title: setup ? '设置主密码' : '解锁 AutoCheckin', backgroundColor: '#101a2d', autoHideMenuBar: true, icon: windowIconPath(), webPreferences: { preload: join(currentDir, '../preload/security.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false, webSecurity: true } })
    unlockWindow = window
    const title = setup ? '创建主密码' : '解锁 AutoCheckin', subtitle = setup ? '主密码用于派生数据库和凭据加密密钥，并会保存在当前系统账户中。请妥善保管，遗失后无法恢复本地数据。解锁完成前不会执行签到。' : '请输入主密码。本次通过后会记住它，开机自启动不再询问。解锁完成前不会读取凭据或执行签到。'
    const logoUrl = brandDataUrl()
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>*{box-sizing:border-box}body{margin:0;background:#101a2d;color:#eaf0ff;font-family:'Segoe UI','Microsoft YaHei',sans-serif;display:grid;place-items:center;height:100vh}.card{width:370px}.logo{width:55px;height:55px;display:block;margin:0 0 25px;filter:drop-shadow(0 12px 24px #09101f)}h1{font-size:25px;margin:0 0 10px}p{font-size:12px;color:#8897b4;line-height:1.65;margin:0 0 26px}label{display:block;font-size:11px;color:#adbad0;margin:15px 0 7px}input{width:100%;height:44px;border:1px solid #2b3b58;border-radius:10px;background:#16243b;color:#fff;padding:0 13px;outline:0}input:focus{border-color:#5d83ef;box-shadow:0 0 0 3px #29467955}button{width:100%;height:44px;border:0;border-radius:10px;background:#416ee8;color:#fff;font-weight:650;margin-top:22px;cursor:pointer}button:disabled{opacity:.5}.error{min-height:18px;color:#ff8588;font-size:10px;margin-top:10px}.hint{display:flex;gap:8px;align-items:flex-start;background:#142139;border:1px solid #223553;border-radius:10px;padding:11px;margin-top:19px;font-size:9px;color:#7f90ad;line-height:1.5}</style></head><body><main class="card"><img class="logo" src="${logoUrl}" alt=""><h1>${title}</h1><p>${subtitle}</p><form id="form"><label>主密码</label><input id="password" type="password" minlength="8" required autofocus autocomplete="current-password">${setup ? '<label>确认主密码</label><input id="confirm" type="password" minlength="8" required autocomplete="new-password">' : ''}<div id="error" class="error"></div><button id="submit" type="submit">${setup ? '设置并进入' : '解锁'}</button></form><div class="hint">🔒 主密码不会上传。凭据使用 AES-256-GCM 加密，数据库密钥由 PBKDF2-SHA512 派生。</div></main><script>const form=document.getElementById('form'),button=document.getElementById('submit'),error=document.getElementById('error');form.addEventListener('submit',async e=>{e.preventDefault();const password=document.getElementById('password').value,confirmation=document.getElementById('confirm')?.value||'';if(password.length<8){error.textContent='主密码至少 8 位';return}if(${setup}&&password!==confirmation){error.textContent='两次输入不一致';return}button.disabled=true;error.textContent='';try{const result=await window.security.submit(password,confirmation);if(result?.error)error.textContent=result.error}catch(e){error.textContent=String(e.message||e)}finally{button.disabled=false}})</script></body></html>`
    const cleanup = (): void => { ipcMain.removeHandler('security:submit') }
    ipcMain.handle('security:submit', async (_event, raw: { password?: unknown; confirmation?: unknown }) => {
      const password = String(raw?.password ?? ''), confirmation = String(raw?.confirmation ?? '')
      if (password.length < 8) return { error: '主密码至少 8 位' }
      if (setup) {
        if (password !== confirmation) return { error: '两次输入不一致' }
        await manager.setMasterPassword(password)
      } else if (!(await manager.verifyMasterPassword(password))) return { error: '主密码错误' }
      else await manager.setMasterPassword(password)
      completed = true; cleanup(); unlockWindow = null; resolve(password); window.close(); return { ok: true }
    })
    window.on('closed', () => { if (unlockWindow === window) unlockWindow = null; cleanup(); if (!completed) reject(new Error('用户取消解锁')) })
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  })
}

function showMainWindow(): void {
  if (allowQuit) return
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }
  mainWindow = createWindow()
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 640, show: false,
    backgroundColor: '#f4f7fb', title: 'AutoCheckin', autoHideMenuBar: true, icon: windowIconPath(),
    webPreferences: {
      preload: join(currentDir, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
    },
  })
  window.once('ready-to-show', () => { if (!allowQuit) window.show() })
  window.on('close', (event) => {
    if (shouldKeepRunningWhenWindowsClose({ trayAvailable: Boolean(tray), explicitQuit: allowQuit })) {
      event.preventDefault()
      window.hide()
    }
  })
  window.on('closed', () => { if (mainWindow === window) mainWindow = null })
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) void import('electron').then(({ shell }) => shell.openExternal(url)); return { action: 'deny' } })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(currentDir, '../renderer/index.html'))
  return window
}

function writeSetting(key: string, value: string, category = 'general'): void {
  database?.sqlite.prepare(`INSERT INTO settings(key,value,is_encrypted,category,updated_at) VALUES(?,?,0,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,category=excluded.category,updated_at=excluded.updated_at`).run(key, value, category, new Date().toISOString())
}

function applyAutoLaunch(enabled: boolean): void {
  try { app.setLoginItemSettings(loginItemOptions(enabled)) }
  catch (error) { console.error('无法更新开机自启动', error instanceof Error ? error.message : error) }
  tray?.rebuild()
}

async function startApplication(): Promise<void> {
  const dataDir = app.getPath('userData')
  const loginItem = app.getLoginItemSettings()
  launchSilently = isSilentLaunch({ argv: process.argv, wasOpenedAtLogin: loginItem.wasOpenedAtLogin, wasOpenedAsHidden: Boolean(loginItem.wasOpenedAsHidden) })
  const master = new MasterPasswordManager(dataDir)
  const keychainPassword = await master.getMasterPassword()
  const gate = unlockRequirement({ keychainPassword, masterConfigured: await master.isSet() })
  if (gate === 'unlocked') console.info('AutoCheckin 已使用已保存的主密码解锁')
  else console.info('AutoCheckin 正在等待主密码解锁，后台签到尚未开始')
  const masterPassword = gate === 'unlocked' && keychainPassword ? keychainPassword : await requestMasterPassword(master)
  const key = await new DatabaseKeyDeriver(dataDir).deriveKey(masterPassword)
  database = new AppDatabase(join(dataDir, 'autocheckin.db'), key)
  const adapters = new AdapterRegistry(); await adapters.load()
  const broadcast = (channel: string, payload: unknown): void => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(channel, payload) }
  const encryptor = new CredentialEncryptor(key)
  const getSetting = (keyName: string, fallback: string): string => (database?.sqlite.prepare('SELECT value FROM settings WHERE key=?').get(keyName) as { value: string } | undefined)?.value ?? fallback
  const tasks = new TaskService(database, encryptor, adapters, dataDir, (progress) => broadcast('browser:progress', progress), () => getSetting('timezone', 'Asia/Shanghai'))
  const notifications = new NotificationService(database, (notification) => {
    broadcast('notification:new', notification)
    if (getSetting('notifications', 'true') === 'false' || !Notification.isSupported()) return
    const canLogin = (notification.level === 'error' || notification.level === 'warning') && Boolean(notification.taskId)
    const nativeNotification = new Notification({ title: notification.title, body: canLogin ? `${notification.message}；点击可打开登录窗口` : notification.message })
    if (canLogin) nativeNotification.on('click', () => { showMainWindow(); void tasks.promptManualLogin(notification.taskId!).catch((error) => notifications.add({ taskId: notification.taskId, title: '手动登录未完成', message: error instanceof Error ? error.message : String(error), level: 'warning' })) })
    nativeNotification.show()
  })
  tasks.cleanupLogs(Number(getSetting('log_retention_days', '90')))
  scheduler = new TaskScheduler(tasks, new ScheduleStore(database), (event) => {
    broadcast('task:status', event.task)
    tray?.tooltip(scheduler?.summary() ?? 'AutoCheckin')
    if (event.notify === 'none') return
    const level = event.notify === 'success' ? 'success' : event.notify === 'manual' ? 'warning' : 'error'
    const title = event.notify === 'success' ? `${event.task.site_name} 签到成功` : event.notify === 'manual' ? `${event.task.site_name} 需要处理` : `${event.task.site_name} 签到失败`
    notifications.add({ taskId: event.taskId, title, message: event.message, level })
  }, () => getSetting('timezone', 'Asia/Shanghai'))
  const ai = new AIGuideService(adapters, (progress) => broadcast('browser:progress', progress))
  registerIpc(database, tasks, adapters, scheduler, new StatisticsService(database), notifications, new BackupService(database), ai, encryptor, { onAutoLaunch: applyAutoLaunch })
  applyAutoLaunch(getSetting('auto_launch', 'false') === 'true')
  scheduler.refresh()
  powerMonitor.on('resume', () => void scheduler?.resume())
  try {
    tray = createAppTray({
      open: showMainWindow,
      checkNow: () => scheduler?.checkNow() ?? Promise.resolve(),
      quit: () => { allowQuit = true; app.quit() },
      autoLaunch: () => getSetting('auto_launch', 'false') === 'true',
      setAutoLaunch: (enabled) => { writeSetting('auto_launch', String(enabled)); applyAutoLaunch(enabled) },
      status: () => scheduler?.summary() ?? 'AutoCheckin 尚未就绪',
    })
  } catch (error) {
    tray = null
    console.error('系统托盘不可用，改为显示主窗口', error instanceof Error ? error.message : error)
  }
  if (!launchSilently || !tray) showMainWindow()
  bootstrapping = false
}

if (process.platform === 'win32') app.setAppUserModelId('com.autocheckin.desktop')
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()
else {
  app.on('second-instance', () => {
    if (unlockWindow && !unlockWindow.isDestroyed()) { unlockWindow.show(); unlockWindow.focus(); return }
    if (!bootstrapping) showMainWindow()
  })
  app.whenReady().then(() => startApplication()).catch((error: unknown) => {
    bootstrapping = false
    console.error('AutoCheckin 启动失败', error instanceof Error ? error.message : error)
    app.quit()
  })
}

app.on('activate', () => { if (unlockWindow && !unlockWindow.isDestroyed()) { unlockWindow.show(); unlockWindow.focus() } else if (scheduler) showMainWindow() })
app.on('window-all-closed', () => {
  if (bootstrapping) return
  if (shouldKeepRunningWhenWindowsClose({ trayAvailable: Boolean(tray), explicitQuit: allowQuit })) return
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => {
  allowQuit = true
  scheduler?.stop()
  scheduler = undefined
  tray?.destroy()
  tray = null
  database?.close()
  database = undefined
})
