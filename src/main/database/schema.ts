import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(), siteId: text('site_id').notNull(), siteName: text('site_name').notNull(),
  engineType: text('engine_type').notNull(), loginType: text('login_type').notNull(), schedule: text('schedule').default('0 8 * * *'),
  enabled: integer('enabled').default(1), priority: integer('priority').default(0), configJson: text('config_json').notNull(),
  adapterId: text('adapter_id').notNull(), accountLabel: text('account_label'), createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(), lastRunAt: text('last_run_at'), lastStatus: text('last_status'),
  consecutiveDays: integer('consecutive_days').default(0),
}, (table) => [index('idx_tasks_status').on(table.lastStatus), index('idx_tasks_enabled').on(table.enabled, table.priority), index('idx_tasks_site_account').on(table.siteId, table.accountLabel)])

export const credentials = sqliteTable('credentials', {
  id: text('id').primaryKey(), taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  credType: text('cred_type').notNull(), credKey: text('cred_key').notNull(), credValueEnc: blob('cred_value_enc').notNull(),
  credIv: blob('cred_iv').notNull(), expiresAt: text('expires_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_creds_task').on(table.taskId, table.credType)])

export const executionLogs = sqliteTable('execution_logs', {
  id: text('id').primaryKey(), taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  runId: text('run_id').notNull(), status: text('status').notNull(), engineUsed: text('engine_used').notNull(), durationMs: integer('duration_ms').notNull(),
  requestSummary: text('request_summary'), responseSummary: text('response_summary'), errorMessage: text('error_message'),
  screenshotPath: text('screenshot_path'), retryCount: integer('retry_count').default(0), executedAt: text('executed_at').notNull(),
}, (table) => [index('idx_logs_task_time').on(table.taskId, table.executedAt), index('idx_logs_run_id').on(table.runId)])

export const siteCookies = sqliteTable('site_cookies', {
  id: text('id').primaryKey(), taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull(), path: text('path').default('/'), name: text('name').notNull(), valueEnc: blob('value_enc').notNull(),
  valueIv: blob('value_iv').notNull(), expiresAt: text('expires_at'), secure: integer('secure').default(0), httpOnly: integer('httponly').default(0), createdAt: text('created_at').notNull(),
}, (table) => [index('idx_cookies_task_domain').on(table.taskId, table.domain)])

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(), value: text('value').notNull(), isEncrypted: integer('is_encrypted').default(0), category: text('category'), updatedAt: text('updated_at').notNull(),
})
