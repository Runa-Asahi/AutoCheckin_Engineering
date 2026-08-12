import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('security', { submit: (password: string, confirmation: string) => ipcRenderer.invoke('security:submit', { password, confirmation }) })
