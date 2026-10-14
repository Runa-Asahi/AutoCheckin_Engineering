import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import type { AppDatabase } from '../database/index.js'

const tables = ['tasks', 'credentials', 'execution_logs', 'site_cookies', 'settings', 'schedule_states'] as const
interface BackupEnvelope { version: 1; salt: string; iv: string; ciphertext: string }

export class BackupService {
  constructor(private readonly db: AppDatabase) {}
  async export(path: string, password: string): Promise<void> {
    const data = Object.fromEntries(tables.map((table) => [table, encode(this.db.sqlite.prepare(`SELECT * FROM ${table}`).all())]))
    const salt = randomBytes(32), iv = randomBytes(12), key = pbkdf2Sync(password, salt, 150_000, 32, 'sha512')
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ format: 'AutoCheckin', version: 1, exportedAt: new Date().toISOString(), data }), 'utf8'), cipher.final(), cipher.getAuthTag()])
    const envelope: BackupEnvelope = { version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), ciphertext: encrypted.toString('base64') }
    await writeFile(path, JSON.stringify(envelope), { mode: 0o600 })
  }
  async import(path: string, password: string): Promise<void> {
    const envelope = JSON.parse(await readFile(path, 'utf8')) as BackupEnvelope
    if (envelope.version !== 1) throw new Error('不支持的备份版本')
    const salt = Buffer.from(envelope.salt, 'base64'), iv = Buffer.from(envelope.iv, 'base64'), encrypted = Buffer.from(envelope.ciphertext, 'base64')
    const key = pbkdf2Sync(password, salt, 150_000, 32, 'sha512'), decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(encrypted.subarray(-16))
    const payload = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8')) as { format: string; version: number; data: Record<string, unknown[]> }
    if (payload.format !== 'AutoCheckin' || payload.version !== 1) throw new Error('备份文件格式无效')
    this.db.sqlite.transaction(() => {
      this.db.sqlite.exec('PRAGMA foreign_keys = OFF')
      try {
        for (const table of [...tables].reverse()) this.db.sqlite.prepare(`DELETE FROM ${table}`).run()
        for (const table of tables) for (const encodedRow of payload.data[table] ?? []) {
          const row = decode(encodedRow) as Record<string, unknown>, columns = Object.keys(row)
          if (!columns.length) continue
          this.db.sqlite.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map((column) => row[column]))
        }
      } finally { this.db.sqlite.exec('PRAGMA foreign_keys = ON') }
    })()
  }
}

function encode(value: unknown): unknown {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { __buffer: Buffer.from(value).toString('base64') }
  if (Array.isArray(value)) return value.map(encode)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]))
  return value
}
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode)
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (typeof object.__buffer === 'string') return Buffer.from(object.__buffer, 'base64')
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, decode(item)]))
  }
  return value
}
