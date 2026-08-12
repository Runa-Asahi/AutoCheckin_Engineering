import { contextBridge, ipcRenderer } from 'electron'
import type { AppNotification, AutoCheckinApi, BrowserProgress, Task } from '../shared/types.js'

const api: AutoCheckinApi = {
  task: {
    create: (input) => ipcRenderer.invoke('task:create', input),
    list: (query) => ipcRenderer.invoke('task:list', query),
    get: (id) => ipcRenderer.invoke('task:get', id),
    update: (id, input) => ipcRenderer.invoke('task:update', { id, input }),
    delete: (id) => ipcRenderer.invoke('task:delete', id),
    execute: (id) => ipcRenderer.invoke('task:execute', id),
    promptManualLogin: (id) => ipcRenderer.invoke('task:manual-login', id),
    onStatusChange: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, task: Task): void => callback(task)
      ipcRenderer.on('task:status', listener)
      return () => ipcRenderer.removeListener('task:status', listener)
    },
    onBrowserProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: BrowserProgress): void => callback(progress)
      ipcRenderer.on('browser:progress', listener)
      return () => ipcRenderer.removeListener('browser:progress', listener)
    },
  },
  adapter: { list: () => ipcRenderer.invoke('adapter:list') },
  statistics: { overview: () => ipcRenderer.invoke('statistics:overview') },
  notification: {
    list: () => ipcRenderer.invoke('notification:list'),
    markRead: (id) => ipcRenderer.invoke('notification:read', id),
    clear: () => ipcRenderer.invoke('notification:clear'),
    onNew: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, notification: AppNotification): void => callback(notification)
      ipcRenderer.on('notification:new', listener)
      return () => ipcRenderer.removeListener('notification:new', listener)
    },
  },
  backup: {
    chooseExportPath: () => ipcRenderer.invoke('backup:choose-export'),
    chooseImportPath: () => ipcRenderer.invoke('backup:choose-import'),
    export: (path, password) => ipcRenderer.invoke('backup:export', { path, password }),
    import: (path, password) => ipcRenderer.invoke('backup:import', { path, password }),
  },
  ai: {
    listModels: (config) => ipcRenderer.invoke('ai:list-models', config),
    analyze: (url) => ipcRenderer.invoke('ai:analyze', url),
    generate: (input) => ipcRenderer.invoke('ai:generate', input),
    inspect: (adapter) => ipcRenderer.invoke('ai:inspect-adapter', adapter),
    diagnoseTask: (input) => ipcRenderer.invoke('ai:diagnose-task', input),
    refineDiagnosis: (input) => ipcRenderer.invoke('ai:refine-diagnosis', input),
    saveAdapter: (adapter) => ipcRenderer.invoke('ai:save-adapter', adapter),
  },
  config: {
    get: (key) => ipcRenderer.invoke('config:get', key),
    set: (key, value, category = 'general', isEncrypted = false) => ipcRenderer.invoke('config:set', { key, value, category, isEncrypted }),
  },
  system: {
    getPlatform: () => ipcRenderer.invoke('system:platform'),
    getDetectedBrowsers: () => ipcRenderer.invoke('system:getDetectedBrowsers'),
    openExternal: (url) => ipcRenderer.invoke('system:open-external', url),
    getAppVersion: () => ipcRenderer.invoke('system:version'),
  },
}

contextBridge.exposeInMainWorld('api', api)
