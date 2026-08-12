import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import * as schema from './schema.js'

const migrationSql = `
CREATE TABLE IF NOT EXISTS tasks (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL, site_name TEXT NOT NULL, engine_type TEXT NOT NULL,
 login_type TEXT NOT NULL, schedule TEXT DEFAULT '0 8 * * *', enabled INTEGER DEFAULT 1, priority INTEGER DEFAULT 0,
 config_json TEXT NOT NULL, adapter_id TEXT NOT NULL, account_label TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 last_run_at TEXT, last_status TEXT, consecutive_days INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS credentials (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, cred_type TEXT NOT NULL,
 cred_key TEXT NOT NULL, cred_value_enc BLOB NOT NULL, cred_iv BLOB NOT NULL, expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS execution_logs (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, run_id TEXT NOT NULL,
 status TEXT NOT NULL, engine_used TEXT NOT NULL, duration_ms INTEGER NOT NULL, request_summary TEXT, response_summary TEXT,
 error_message TEXT, screenshot_path TEXT, retry_count INTEGER DEFAULT 0, executed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS site_cookies (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, domain TEXT NOT NULL, path TEXT DEFAULT '/',
 name TEXT NOT NULL, value_enc BLOB NOT NULL, value_iv BLOB NOT NULL, expires_at TEXT, secure INTEGER DEFAULT 0,
 httponly INTEGER DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
 key TEXT PRIMARY KEY, value TEXT NOT NULL, is_encrypted INTEGER DEFAULT 0, category TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(last_status);
CREATE INDEX IF NOT EXISTS idx_tasks_enabled ON tasks(enabled, priority);
CREATE INDEX IF NOT EXISTS idx_tasks_site_account ON tasks(site_id, account_label);
CREATE INDEX IF NOT EXISTS idx_logs_task_time ON execution_logs(task_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_run_id ON execution_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_creds_task ON credentials(task_id, cred_type);
CREATE INDEX IF NOT EXISTS idx_cookies_task_domain ON site_cookies(task_id, domain);
CREATE TABLE IF NOT EXISTS __migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
INSERT OR IGNORE INTO __migrations(version, applied_at) VALUES (1, datetime('now'));
`

export class AppDatabase {
  readonly sqlite: SqliteFacade
  readonly schema = schema
  readonly backend: 'better-sqlite3' | 'node:sqlite'

  constructor(path: string, encryptionKey?: Buffer) {
    let native: NativeDatabase
    try {
      const require = createRequire(import.meta.url)
      const BetterSqlite3 = require('better-sqlite3') as new (filename: string) => NativeDatabase
      native = new BetterSqlite3(path)
      this.backend = 'better-sqlite3'
    } catch {
      native = new DatabaseSync(path) as unknown as NativeDatabase
      this.backend = 'node:sqlite'
    }
    this.sqlite = new SqliteFacade(native)
    if (encryptionKey) this.sqlite.pragma(`key = \"x'${encryptionKey.toString('hex')}'\"`)
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.pragma('foreign_keys = ON')
    this.sqlite.pragma('busy_timeout = 5000')
    this.sqlite.exec(migrationSql)
  }

  close(): void { this.sqlite.close() }
}

interface NativeStatement {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}
interface NativeDatabase {
  exec(sql: string): void
  prepare(sql: string): NativeStatement
  close(): void
  pragma?: (statement: string) => unknown
}

class SqliteFacade {
  constructor(private readonly native: NativeDatabase) {}
  exec(sql: string): void { this.native.exec(sql) }
  prepare(sql: string): NativeStatement { return this.native.prepare(sql) }
  pragma(statement: string): unknown { return this.native.pragma ? this.native.pragma(statement) : this.native.exec(`PRAGMA ${statement}`) }
  transaction<T>(operation: () => T): () => T {
    return () => {
      this.native.exec('BEGIN IMMEDIATE')
      try { const result = operation(); this.native.exec('COMMIT'); return result }
      catch (error) { this.native.exec('ROLLBACK'); throw error }
    }
  }
  close(): void { this.native.close() }
}
