import { app, BrowserWindow, Notification, ipcMain, powerMonitor } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppDatabase } from './database/index.js'
import { CredentialEncryptor, DatabaseKeyDeriver, MasterPasswordManager } from './security/crypto.js'
import { AdapterRegistry } from './adapters/adapterRegistry.js'
import { TaskService } from './services/taskService.js'
import { TaskScheduler } from './services/taskScheduler.js'
import { registerIpc } from './ipc/register.js'
import { StatisticsService } from './services/statisticsService.js'
import { NotificationService } from './services/notificationService.js'
import { BackupService } from './services/backupService.js'
import { AIGuideService } from './ai/aiGuideService.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
let database: AppDatabase | undefined
let scheduler: TaskScheduler | undefined
let bootstrapping = true

async function requestMasterPassword(manager: MasterPasswordManager): Promise<string> {
  const stored = await manager.getMasterPassword()
  if (stored) return stored
  const setup = !(await manager.isSet())
  return new Promise((resolve, reject) => {
    let completed = false
    const window = new BrowserWindow({ width: 470, height: 560, resizable: false, maximizable: false, minimizable: false, title: setup ? '设置主密码' : '解锁 AutoCheckin', backgroundColor: '#101a2d', autoHideMenuBar: true, webPreferences: { preload: join(currentDir, '../preload/security.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false, webSecurity: true } })
    const title = setup ? '创建主密码' : '解锁 AutoCheckin', subtitle = setup ? '主密码用于派生数据库和凭据加密密钥。请妥善保管，遗失后无法恢复本地数据。' : '系统钥匙串不可用，请输入主密码解锁本地数据。'
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>*{box-sizing:border-box}body{margin:0;background:#101a2d;color:#eaf0ff;font-family:'Segoe UI','Microsoft YaHei',sans-serif;display:grid;place-items:center;height:100vh}.card{width:370px}.logo{width:55px;height:55px;border-radius:17px;background:linear-gradient(145deg,#5d88ff,#3155d4);display:grid;place-items:center;font-size:28px;font-weight:800;box-shadow:0 12px 30px #09101f;margin-bottom:25px}h1{font-size:25px;margin:0 0 10px}p{font-size:12px;color:#8897b4;line-height:1.65;margin:0 0 26px}label{display:block;font-size:11px;color:#adbad0;margin:15px 0 7px}input{width:100%;height:44px;border:1px solid #2b3b58;border-radius:10px;background:#16243b;color:#fff;padding:0 13px;outline:0}input:focus{border-color:#5d83ef;box-shadow:0 0 0 3px #29467955}button{width:100%;height:44px;border:0;border-radius:10px;background:#416ee8;color:#fff;font-weight:650;margin-top:22px;cursor:pointer}button:disabled{opacity:.5}.error{min-height:18px;color:#ff8588;font-size:10px;margin-top:10px}.hint{display:flex;gap:8px;align-items:flex-start;background:#142139;border:1px solid #223553;border-radius:10px;padding:11px;margin-top:19px;font-size:9px;color:#7f90ad;line-height:1.5}</style></head><body><main class="card"><div class="logo">A</div><h1>${title}</h1><p>${subtitle}</p><form id="form"><label>主密码</label><input id="password" type="password" minlength="8" required autofocus autocomplete="current-password">${setup ? '<label>确认主密码</label><input id="confirm" type="password" minlength="8" required autocomplete="new-password">' : ''}<div id="error" class="error"></div><button id="submit" type="submit">${setup ? '设置并进入' : '解锁'}</button></form><div class="hint">🔒 主密码不会上传。凭据使用 AES-256-GCM 加密，数据库密钥由 PBKDF2-SHA512 派生。</div></main><script>const form=document.getElementById('form'),button=document.getElementById('submit'),error=document.getElementById('error');form.addEventListener('submit',async e=>{e.preventDefault();const password=document.getElementById('password').value,confirmation=document.getElementById('confirm')?.value||'';if(password.length<8){error.textContent='主密码至少 8 位';return}if(${setup}&&password!==confirmation){error.textContent='两次输入不一致';return}button.disabled=true;error.textContent='';try{const result=await window.security.submit(password,confirmation);if(result?.error)error.textContent=result.error}catch(e){error.textContent=String(e.message||e)}finally{button.disabled=false}})</script></body></html>`
    const cleanup = (): void => { ipcMain.removeHandler('security:submit') }
    ipcMain.handle('security:submit', async (_event, raw: { password?: unknown; confirmation?: unknown }) => {
      const password = String(raw?.password ?? ''), confirmation = String(raw?.confirmation ?? '')
      if (password.length < 8) return { error: '主密码至少 8 位' }
      if (setup) {
        if (password !== confirmation) return { error: '两次输入不一致' }
        await manager.setMasterPassword(password)
      } else if (!(await manager.verifyMasterPassword(password))) return { error: '主密码错误' }
      completed = true; cleanup(); resolve(password); window.close(); return { ok: true }
    })
    window.on('closed', () => { cleanup(); if (!completed) reject(new Error('用户取消解锁')) })
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 640, show: false,
    backgroundColor: '#f4f7fb', title: 'AutoCheckin', autoHideMenuBar: true,
    webPreferences: {
      preload: join(currentDir, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
    },
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) void import('electron').then(({ shell }) => shell.openExternal(url)); return { action: 'deny' } })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(currentDir, '../renderer/index.html'))
  return window
}

app.whenReady().then(async () => {
  const dataDir = app.getPath('userData')
  const masterPassword = await requestMasterPassword(new MasterPasswordManager(dataDir))
  const key = await new DatabaseKeyDeriver(dataDir).deriveKey(masterPassword)
  database = new AppDatabase(join(dataDir, 'autocheckin.db'), key)
  const adapters = new AdapterRegistry(); await adapters.load()
  const broadcast = (channel: string, payload: unknown): void => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload) }
  const encryptor = new CredentialEncryptor(key)
  const tasks = new TaskService(database, encryptor, adapters, dataDir, (progress) => broadcast('browser:progress', progress))
  const notifications = new NotificationService(database, (notification) => {
    broadcast('notification:new', notification)
    const setting = database?.sqlite.prepare('SELECT value FROM settings WHERE key=?').get('notifications') as { value: string } | undefined
    if (setting?.value !== 'false' && Notification.isSupported()) {
      const canLogin = notification.level === 'error' && Boolean(notification.taskId)
      const nativeNotification = new Notification({ title: notification.title, body: canLogin ? `${notification.message}；点击可打开登录窗口` : notification.message })
      if (canLogin) nativeNotification.on('click', () => { void tasks.promptManualLogin(notification.taskId!).catch((error) => notifications.add({ taskId: notification.taskId, title: '手动登录未完成', message: error instanceof Error ? error.message : String(error), level: 'warning' })) })
      nativeNotification.show()
    }
  })
  const getSetting = (key: string, fallback: string): string => (database?.sqlite.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)?.value ?? fallback
  tasks.cleanupLogs(Number(getSetting('log_retention_days', '90')))
  scheduler = new TaskScheduler(tasks, (task) => {
    broadcast('task:status', task)
    notifications.add({ taskId: task.id, title: `${task.site_name} 签到`, message: task.last_status === 'success' ? '执行成功' : '执行失败，请查看日志', level: task.last_status === 'success' ? 'success' : 'error' })
  }, () => getSetting('timezone', 'Asia/Shanghai'))
  const ai = new AIGuideService(adapters, (progress) => broadcast('browser:progress', progress))
  registerIpc(database, tasks, adapters, scheduler, new StatisticsService(database), notifications, new BackupService(database), ai, encryptor)
  scheduler.refresh()
  powerMonitor.on('resume', () => void scheduler?.resume())
  createWindow()
  bootstrapping = false
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (!bootstrapping && process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { scheduler?.stop(); database?.close() })
