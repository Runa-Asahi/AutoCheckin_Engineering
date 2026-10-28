import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store, type Cipher } from '../src/main/core/store.js'
import { filePersistence } from '../src/main/core/filePersistence.js'

export const fakeCipher: Cipher = { encrypt: (p) => `x:${Buffer.from(p).toString('base64')}`, decrypt: (c) => Buffer.from(c.slice(2), 'base64').toString() }
export function tempStore(): { store: Store; path: string } {
  const path = join(mkdtempSync(join(tmpdir(), 'ac-')), 'data.json')
  return { store: new Store(filePersistence(path), fakeCipher), path }
}
export const noSleep = async (): Promise<void> => undefined
