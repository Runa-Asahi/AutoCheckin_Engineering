import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Persistence } from './store.js'

/** 桌面端：写临时文件再原子替换，权限 0600。 */
export function filePersistence(path: string): Persistence {
  return {
    read: () => { try { return readFileSync(path, 'utf8') } catch { return null } },
    write: (text) => {
      mkdirSync(dirname(path), { recursive: true })
      const temp = `${path}.tmp`
      writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600 })
      renameSync(temp, path)
    },
  }
}
