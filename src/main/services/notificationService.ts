import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../database/index.js'
import type { AppNotification } from '../../shared/types.js'

export class NotificationService {
  private readonly key = 'notification_center'
  constructor(private readonly db: AppDatabase, private readonly onNew: (notification: AppNotification) => void = () => undefined) {}
  list(): AppNotification[] { return this.read() }
  add(input: Omit<AppNotification, 'id' | 'read' | 'createdAt'>): AppNotification {
    const item: AppNotification = { ...input, id: randomUUID(), read: false, createdAt: new Date().toISOString() }
    this.write([item, ...this.read()].slice(0, 50)); this.onNew(item); return item
  }
  markRead(id: string): void { this.write(this.read().map((item) => item.id === id ? { ...item, read: true } : item)) }
  clear(): void { this.write([]) }
  private read(): AppNotification[] {
    const row = this.db.sqlite.prepare('SELECT value FROM settings WHERE key=?').get(this.key) as { value: string } | undefined
    if (!row) return []
    try { const value = JSON.parse(row.value); return Array.isArray(value) ? value : [] } catch { return [] }
  }
  private write(items: AppNotification[]): void {
    this.db.sqlite.prepare(`INSERT INTO settings(key,value,is_encrypted,category,updated_at) VALUES(?,?,0,'notification',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(this.key, JSON.stringify(items), new Date().toISOString())
  }
}
