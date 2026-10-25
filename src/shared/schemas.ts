import { z } from 'zod'

export const EngineTypeSchema = z.enum(['http', 'browser', 'api', 'hybrid', 'native'])
export const LoginTypeSchema = z.enum(['password', 'cookie', 'manual', 'local_browser'])

export const CreateTaskSchema = z.object({
  siteId: z.string().min(1),
  siteName: z.string().min(1),
  engineType: EngineTypeSchema,
  loginType: LoginTypeSchema,
  schedule: z.string().default('0 8 * * *'),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(0),
  adapterId: z.string().min(1),
  accountLabel: z.string().max(80).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  credentials: z.record(z.string(), z.string()).optional(),
  cookies: z.string().optional(),
})

export const UpdateTaskSchema = CreateTaskSchema.partial().omit({ credentials: true, cookies: true })
export const TaskListQuerySchema = z.object({
  status: z.enum(['all', 'success', 'failed', 'pending']).default('all'),
  search: z.string().default(''),
  sortBy: z.enum(['last_run_at', 'consecutive_days', 'created_at']).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
}).default({ status: 'all', search: '', sortBy: 'created_at', sortOrder: 'desc' })
export const GetSettingSchema = z.object({ key: z.string().min(1) })
export const SetSettingSchema = z.object({ key: z.string().min(1), value: z.string(), category: z.string().default('general'), isEncrypted: z.boolean().default(false) })
export const ExecuteTaskSchema = z.object({ id: z.string().uuid() })
export const BackupExportSchema = z.object({ password: z.string().min(8), path: z.string().min(1) })
export const BackupImportSchema = z.object({ password: z.string().min(8), path: z.string().min(1) })
export const NotificationIdSchema = z.object({ id: z.string().uuid() })

export const AIProviderSchema = z.enum(['openai', 'deepseek', 'custom-openai', 'ollama', 'anthropic', 'gemini'])
export const AIProviderConfigSchema = z.object({
  provider: AIProviderSchema,
  baseUrl: z.string().trim().url(),
  apiKey: z.string().default(''),
  model: z.string().trim().min(1).max(200),
})
export const AIAnalyzeSchema = z.object({ url: z.string().url() })
export const AIGenerateSchema = z.object({
  url: z.string().url(),
  domSummary: z.string().min(1).max(120_000),
  ...AIProviderConfigSchema.shape,
})
export const AIListModelsSchema = AIProviderConfigSchema
export const AISaveAdapterSchema = z.object({ adapter: z.unknown() })
export const AIDiagnoseTaskSchema = z.object({ id: z.string().uuid(), ...AIProviderConfigSchema.shape })
export const AIRefineDiagnosisSchema = z.object({
  adapter: z.unknown(),
  inspection: z.object({
    valid: z.boolean(), score: z.number(), checkedAt: z.string(),
    issues: z.array(z.object({ code: z.string(), severity: z.enum(['error', 'warning', 'info']), path: z.string(), message: z.string(), suggestion: z.string() })),
  }),
  ...AIProviderConfigSchema.shape,
})

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>
export type AIProvider = z.infer<typeof AIProviderSchema>
export type AIProviderConfig = z.infer<typeof AIProviderConfigSchema>

const RequestSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  /** body 为对象时以 application/x-www-form-urlencoded 编码发送。 */
  form: z.boolean().optional(),
  timeout_ms: z.number().int().positive().default(30000),
})

export const AdapterSchema = z.object({
  site_id: z.string(),
  site_name: z.string(),
  site_url: z.string().url(),
  engine_type: EngineTypeSchema,
  login_type: LoginTypeSchema,
  description: z.string().max(500).optional(),
  /** 给用户看的 Cookie 获取提示，例如需要哪些 Cookie 名。 */
  cookie_hint: z.string().max(500).optional(),
  /** engine_type=native 时使用的内置代码插件（如 netease_music、bilibili）。 */
  plugin: z.object({ id: z.string().min(1), options: z.record(z.string(), z.unknown()).default({}) }).optional(),
  /** 主请求之前依次执行的请求，可用 extract 把 JSON 字段提取为模板变量，供后续请求使用。 */
  pre_requests: z.array(RequestSchema.extend({
    extract: z.record(z.string(), z.string()).optional(),
  })).max(5).optional(),
  request: RequestSchema.optional(),
  steps: z.array(z.record(z.string(), z.unknown())).optional(),
  success_rules: z.array(z.object({
    type: z.enum(['status', 'body_includes', 'body_regex', 'json_path']),
    value: z.unknown(),
  })).default([]),
  success_logic: z.enum(['and', 'or']).default('or'),
  failure_rules: z.array(z.object({
    type: z.enum(['body_includes', 'body_regex']),
    value: z.string().min(1).max(200),
    outcome: z.enum(['not_ready', 'retryable_error', 'authentication_required', 'manual_action_required', 'permanent_failure']),
  })).max(20).optional(),
  cookie_domains: z.array(z.string()).default([]),
}).superRefine((adapter, ctx) => {
  if (adapter.engine_type === 'native') {
    if (!adapter.plugin) ctx.addIssue({ code: 'custom', path: ['plugin'], message: 'native 引擎需要 plugin.id' })
  } else if (!adapter.success_rules.length) ctx.addIssue({ code: 'custom', path: ['success_rules'], message: '至少需要一条 success_rules' })
})

export type Adapter = z.infer<typeof AdapterSchema>
