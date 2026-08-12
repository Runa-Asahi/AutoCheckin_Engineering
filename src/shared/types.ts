import type { AIProvider, AIProviderConfig, CreateTaskInput, TaskListQuery, UpdateTaskInput } from './schemas.js'

export interface DetectedBrowser { id: string; name: string; channel: 'chrome' | 'msedge'; userDataDir: string; executablePath: string; profiles: string[] }

export type TaskStatus = 'success' | 'failed' | 'pending' | 'running'

export interface Task {
  id: string
  site_id: string
  site_name: string
  engine_type: 'http' | 'browser' | 'api' | 'hybrid'
  login_type: 'password' | 'cookie' | 'manual' | 'local_browser'
  schedule: string
  enabled: number
  priority: number
  config_json: string
  adapter_id: string
  account_label: string | null
  created_at: string
  updated_at: string
  last_run_at: string | null
  last_status: TaskStatus | null
  consecutive_days: number
}

export interface ExecutionLog {
  id: string
  task_id: string
  run_id: string
  status: TaskStatus
  engine_used: string
  duration_ms: number
  request_summary: string | null
  response_summary: string | null
  error_message: string | null
  screenshot_path: string | null
  retry_count: number
  executed_at: string
}

export interface ExecutionResult {
  success: boolean
  status: TaskStatus
  message: string
  durationMs: number
  engineUsed: string
}

export interface BrowserProgress { phase: 'checking' | 'downloading' | 'ready' | 'executing' | 'completed' | 'failed'; percent: number; message: string }

export interface StatisticsOverview {
  totalRuns: number
  successRuns: number
  successRate: number
  activeTasks: number
  trends: Array<{ date: string; success: number; failed: number }>
  taskRates: Array<{ taskId: string; siteName: string; accountLabel: string | null; total: number; success: number; rate: number }>
  leaderboard: Array<{ taskId: string; siteName: string; accountLabel: string | null; consecutiveDays: number }>
}

export interface AppNotification {
  id: string
  taskId: string | null
  title: string
  message: string
  level: 'success' | 'warning' | 'error' | 'info'
  read: boolean
  createdAt: string
}

export interface AIAnalysis { url: string; title: string; domSummary: string; estimatedInputTokens: number }
export interface AdapterInspectionIssue { code: string; severity: 'error' | 'warning' | 'info'; path: string; message: string; suggestion: string }
export interface AdapterInspectionReport { valid: boolean; score: number; issues: AdapterInspectionIssue[]; checkedAt: string }
export interface AIGeneration { adapter: unknown; raw: string; estimatedCostUsd: number; inputTokens: number; outputTokens: number; provider: AIProvider; model: string; inspection: AdapterInspectionReport; autoRepaired: boolean }
export interface AIFailureDiagnosis {
  summary: string
  category: 'network' | 'authentication' | 'selector' | 'success_rule' | 'site_change' | 'risk_control' | 'unknown'
  confidence: number
  evidence: string[]
  changes: string[]
  requiresManualAction: boolean
  adapter: unknown
  inspection: AdapterInspectionReport
  provider: AIProvider
  model: string
  autoRepaired: boolean
}

export interface AdapterSummary {
  id: string
  siteId: string
  siteName: string
  siteUrl: string
  engineType: Task['engine_type']
  loginType: Task['login_type']
}

export interface AutoCheckinApi {
  task: {
    create(input: CreateTaskInput): Promise<Task>
    list(query?: Partial<TaskListQuery>): Promise<Task[]>
    get(id: string): Promise<{ task: Task; logs: ExecutionLog[] }>
    update(id: string, input: UpdateTaskInput): Promise<Task>
    delete(id: string): Promise<void>
    execute(id: string): Promise<ExecutionResult>
    promptManualLogin(id: string): Promise<{ count: number }>
    onStatusChange(callback: (task: Task) => void): () => void
    onBrowserProgress(callback: (progress: BrowserProgress) => void): () => void
  }
  adapter: { list(): Promise<AdapterSummary[]> }
  statistics: { overview(): Promise<StatisticsOverview> }
  notification: {
    list(): Promise<AppNotification[]>
    markRead(id: string): Promise<void>
    clear(): Promise<void>
    onNew(callback: (notification: AppNotification) => void): () => void
  }
  backup: {
    chooseExportPath(): Promise<string | null>
    chooseImportPath(): Promise<string | null>
    export(path: string, password: string): Promise<void>
    import(path: string, password: string): Promise<void>
  }
  ai: {
    analyze(url: string): Promise<AIAnalysis>
    listModels(config: AIProviderConfig): Promise<string[]>
    generate(input: { url: string; domSummary: string } & AIProviderConfig): Promise<AIGeneration>
    inspect(adapter: unknown): Promise<AdapterInspectionReport>
    diagnoseTask(input: { id: string } & AIProviderConfig): Promise<AIFailureDiagnosis>
    refineDiagnosis(input: { adapter: unknown; inspection: AdapterInspectionReport } & AIProviderConfig): Promise<AIFailureDiagnosis>
    saveAdapter(adapter: unknown): Promise<AdapterSummary>
  }
  config: { get(key: string): Promise<string | null>; set(key: string, value: string, category?: string, isEncrypted?: boolean): Promise<void> }
  system: { getPlatform(): Promise<string>; getDetectedBrowsers(): Promise<DetectedBrowser[]>; openExternal(url: string): Promise<void>; getAppVersion(): Promise<string> }
}
