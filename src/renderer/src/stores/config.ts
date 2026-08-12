import { defineStore } from 'pinia'
export const useConfigStore = defineStore('config', {
  state: () => ({ values: {} as Record<string, string> }),
  actions: {
    async getSetting(key: string, fallback = ''): Promise<string> { const value = await window.api.config.get(key) ?? fallback; this.values[key] = value; return value },
    async setSetting(key: string, value: string, category = 'general', isEncrypted = false): Promise<void> { await window.api.config.set(key, value, category, isEncrypted); this.values[key] = value },
  },
})
