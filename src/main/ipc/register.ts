import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { AIAnalyzeSchema, AIDiagnoseTaskSchema, AIGenerateSchema, AIListModelsSchema, AIRefineDiagnosisSchema, AISaveAdapterSchema, BackupExportSchema, BackupImportSchema, CreateTaskSchema, ExecuteTaskSchema, GetSettingSchema, NotificationIdSchema, SetSettingSchema, TaskListQuerySchema, UpdateTaskSchema } from '../../shared/schemas.js'
import type { AppDatabase } from '../database/index.js'
import type { AdapterRegistry } from '../adapters/adapterRegistry.js'
import type { TaskService } from '../services/taskService.js'
import type { TaskScheduler } from '../services/taskScheduler.js'
import type { StatisticsService } from '../services/statisticsService.js'
import type { NotificationService } from '../services/notificationService.js'
import type { BackupService } from '../services/backupService.js'
import type { AIGuideService } from '../ai/aiGuideService.js'
import type { CredentialEncryptor } from '../security/crypto.js'
import { LocalBrowserScanner } from '../browser/localBrowserScanner.js'

export function registerIpc(db: AppDatabase, tasks: TaskService, adapters: AdapterRegistry, scheduler: TaskScheduler, statistics: StatisticsService, notifications: NotificationService, backup: BackupService, ai: AIGuideService, encryptor: CredentialEncryptor, hooks?: { onAutoLaunch?: (enabled: boolean) => void }): void {
  ipcMain.handle('task:create', (_event, raw) => { const result = tasks.create(CreateTaskSchema.parse(raw)); scheduler.refresh(); return result })
  ipcMain.handle('task:list', (_event, raw) => tasks.list(TaskListQuerySchema.parse(raw ?? {})))
  ipcMain.handle('task:get', (_event, id) => tasks.get(ExecuteTaskSchema.parse({ id }).id))
  ipcMain.handle('task:update', (_event, raw) => { const id = ExecuteTaskSchema.parse({ id: raw?.id }).id; const result = tasks.update(id, UpdateTaskSchema.parse(raw?.input)); scheduler.refresh(); return result })
  ipcMain.handle('task:delete', (_event, id) => { tasks.delete(ExecuteTaskSchema.parse({ id }).id); scheduler.refresh() })
  ipcMain.handle('task:execute', async (_event, id) => {
    const taskId = ExecuteTaskSchema.parse({ id }).id
    const result = await scheduler.runManual(taskId)
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('task:status', tasks.get(taskId).task)
    return result
  })
  ipcMain.handle('task:manual-login', (_event, id) => tasks.promptManualLogin(ExecuteTaskSchema.parse({ id }).id))
  ipcMain.handle('adapter:list', () => adapters.list())
  ipcMain.handle('statistics:overview', () => statistics.overview())
  ipcMain.handle('notification:list', () => notifications.list())
  ipcMain.handle('notification:read', (_event, id) => notifications.markRead(NotificationIdSchema.parse({ id }).id))
  ipcMain.handle('notification:clear', () => notifications.clear())
  ipcMain.handle('backup:choose-export', async () => (await dialog.showSaveDialog({ title: '导出 AutoCheckin 加密备份', defaultPath: `AutoCheckin-${new Date().toISOString().slice(0, 10)}.acbackup`, filters: [{ name: 'AutoCheckin Backup', extensions: ['acbackup'] }] })).filePath ?? null)
  ipcMain.handle('backup:choose-import', async () => (await dialog.showOpenDialog({ title: '导入 AutoCheckin 加密备份', properties: ['openFile'], filters: [{ name: 'AutoCheckin Backup', extensions: ['acbackup'] }] })).filePaths[0] ?? null)
  ipcMain.handle('backup:export', (_event, raw) => { const input = BackupExportSchema.parse(raw); return backup.export(input.path, input.password) })
  ipcMain.handle('backup:import', async (_event, raw) => { const input = BackupImportSchema.parse(raw); await backup.import(input.path, input.password); scheduler.refresh() })
  ipcMain.handle('ai:analyze', (_event, url) => ai.analyzeUrl(AIAnalyzeSchema.parse({ url }).url))
  ipcMain.handle('ai:list-models', (_event, raw) => ai.listModels(AIListModelsSchema.parse(raw)))
  ipcMain.handle('ai:generate', (_event, raw) => ai.generate(AIGenerateSchema.parse(raw)))
  ipcMain.handle('ai:inspect-adapter', (_event, adapter) => ai.inspectAdapter(AISaveAdapterSchema.parse({ adapter }).adapter))
  ipcMain.handle('ai:diagnose-task', (_event, raw) => {
    const input = AIDiagnoseTaskSchema.parse(raw)
    const data = tasks.get(input.id), log = data.logs[0]
    if (!log || log.status !== 'failed') throw new Error('没有可用于 AI 诊断的失败日志。')
    return ai.diagnoseFailure(adapters.get(data.task.adapter_id), data.logs.slice(0, 10), input)
  })
  ipcMain.handle('ai:refine-diagnosis', (_event, raw) => { const input = AIRefineDiagnosisSchema.parse(raw); return ai.refineDiagnosis(input.adapter, input.inspection, input) })
  ipcMain.handle('ai:save-adapter', (_event, adapter) => ai.saveAdapter(AISaveAdapterSchema.parse({ adapter }).adapter))
  ipcMain.handle('config:get', (_event, key) => {
    const parsed = GetSettingSchema.parse({ key })
    const row = db.sqlite.prepare('SELECT value,is_encrypted FROM settings WHERE key=?').get(parsed.key) as { value: string; is_encrypted: number } | undefined
    if (!row) return null
    if (!row.is_encrypted) return row.value
    try {
      const payload = JSON.parse(row.value) as { ciphertext: string; iv: string }
      return encryptor.decrypt(Buffer.from(payload.ciphertext, 'base64'), Buffer.from(payload.iv, 'base64'))
    } catch { throw new Error('加密设置无法解密，请重新配置') }
  })
  ipcMain.handle('config:set', (_event, raw) => {
    const input = SetSettingSchema.parse(raw)
    let storedValue = input.value
    if (input.isEncrypted) {
      const encrypted = encryptor.encrypt(input.value)
      storedValue = JSON.stringify({ ciphertext: encrypted.ciphertext.toString('base64'), iv: encrypted.iv.toString('base64') })
    }
    db.sqlite.prepare(`INSERT INTO settings(key,value,is_encrypted,category,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,is_encrypted=excluded.is_encrypted,category=excluded.category,updated_at=excluded.updated_at`).run(input.key, storedValue, input.isEncrypted ? 1 : 0, input.category, new Date().toISOString())
    if (input.key === 'auto_launch') hooks?.onAutoLaunch?.(input.value === 'true')
    if (input.key === 'timezone') scheduler.refresh()
  })
  ipcMain.handle('system:platform', () => process.platform)
  ipcMain.handle('system:getDetectedBrowsers', () => new LocalBrowserScanner().detectBrowsers())
  ipcMain.handle('system:version', () => app.getVersion())
  ipcMain.handle('system:open-external', async (_event, raw) => { const url = new URL(String(raw)); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL scheme'); await shell.openExternal(url.toString()) })
}
