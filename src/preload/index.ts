import { contextBridge, ipcRenderer } from 'electron'
import type { AccountView, AutoCheckinApi } from '../shared/types.js'

const api: AutoCheckinApi = {
  platforms: () => ipcRenderer.invoke('platforms'),
  accounts: () => ipcRenderer.invoke('accounts'),
  startQrLogin: (platform) => ipcRenderer.invoke('qr:start', platform),
  pollQrLogin: (id) => ipcRenderer.invoke('qr:poll', id),
  cancelQrLogin: (id) => ipcRenderer.invoke('qr:cancel', id),
  webLogin: (platform) => ipcRenderer.invoke('web:login', platform),
  updateAccount: (input) => ipcRenderer.invoke('account:update', input),
  removeAccount: (id) => ipcRenderer.invoke('account:remove', id),
  runNow: (id) => ipcRenderer.invoke('account:run', id),
  explainFailure: (id) => ipcRenderer.invoke('account:explain', id),
  settings: () => ipcRenderer.invoke('settings'),
  saveSettings: (input) => ipcRenderer.invoke('settings:save', input),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onAccountsChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, accounts: AccountView[]): void => callback(accounts)
    ipcRenderer.on('accounts:changed', listener)
    return () => ipcRenderer.removeListener('accounts:changed', listener)
  },
}
contextBridge.exposeInMainWorld('api', api)
