import { AdapterSchema, type Adapter } from '../../shared/schemas.js'

export type AdapterIssueSeverity = 'error' | 'warning' | 'info'
export interface AdapterInspectionIssue { code: string; severity: AdapterIssueSeverity; path: string; message: string; suggestion: string }
export interface AdapterInspectionReport { valid: boolean; score: number; issues: AdapterInspectionIssue[]; checkedAt: string }

const BUILTIN_STEP_TYPES = new Set(['goto', 'click', 'fill', 'input', 'wait', 'wait_for', 'wait_text', 'extract', 'log', 'screenshot', 'condition', 'retry', 'try_catch', 'request', 'tieba_batch_sign'])

export function inspectAdapter(input: unknown): AdapterInspectionReport {
  const issues: AdapterInspectionIssue[] = []
  const parsed = AdapterSchema.safeParse(input)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) add(issues, 'schema_invalid', 'error', issue.path.join('.') || 'root', issue.message, '修正字段后重新运行 Schema 校验。')
    return report(issues)
  }
  const adapter = parsed.data
  inspectEngine(adapter, issues)
  inspectUrls(adapter, issues)
  inspectRules(adapter, issues)
  inspectSteps(adapter.steps ?? [], 'steps', issues)
  inspectBehavior(adapter, issues)
  return report(issues)
}

function inspectEngine(adapter: Adapter, issues: AdapterInspectionIssue[]): void {
  if (['http', 'api', 'hybrid'].includes(adapter.engine_type) && !adapter.request) add(issues, 'request_missing', 'error', 'request', `${adapter.engine_type} 引擎缺少 request 配置。`, '补充 HTTP 方法、URL、请求头和超时。')
  if (['browser', 'hybrid'].includes(adapter.engine_type) && !(adapter.steps?.length)) add(issues, 'steps_missing', 'error', 'steps', `${adapter.engine_type} 引擎缺少浏览器步骤。`, '至少添加 goto 和实际签到操作。')
  if (adapter.login_type === 'password' && !hasCredentialFill(adapter.steps ?? [])) add(issues, 'password_flow_missing', 'warning', 'steps', '密码登录任务没有可识别的用户名/密码填写步骤，Cookie 过期后无法自动恢复。', '补充登录步骤，或改为 manual/local_browser。')
}

function inspectUrls(adapter: Adapter, issues: AdapterInspectionIssue[]): void {
  const site = new URL(adapter.site_url)
  const urls = [adapter.request?.url, ...(adapter.steps ?? []).flatMap(collectStepUrls)].filter((value): value is string => typeof value === 'string')
  for (const [index, raw] of urls.entries()) {
    if (raw.includes('{{')) continue
    try {
      const url = new URL(raw, adapter.site_url)
      if (!['http:', 'https:'].includes(url.protocol)) add(issues, 'unsafe_url', 'error', `urls.${index}`, `不允许的 URL 协议：${url.protocol}`, '仅使用 HTTP/HTTPS 地址。')
      if (url.hostname !== site.hostname && !adapter.cookie_domains.some((domain) => sameDomain(url.hostname, domain))) add(issues, 'cross_domain', 'warning', `urls.${index}`, `请求跳转到未声明域名 ${url.hostname}。`, '确认该域名可信，并加入 cookie_domains 或改用同站接口。')
    } catch { add(issues, 'url_invalid', 'error', `urls.${index}`, `无效 URL：${raw}`, '使用绝对 URL 或可安全解析的相对地址。') }
  }
}

function inspectRules(adapter: Adapter, issues: AdapterInspectionIssue[]): void {
  for (const [index, rule] of adapter.success_rules.entries()) {
    if (rule.type === 'status' && Number(rule.value) === 200 && adapter.engine_type === 'browser') add(issues, 'weak_status_rule', 'warning', `success_rules.${index}`, '浏览器任务仅用 HTTP 200 判定成功，可能把普通首页误判为签到成功。', '增加签到结果文本、JSON 字段或专用接口规则。')
    if (rule.type === 'body_regex') {
      try { new RegExp(String(rule.value), 'i') } catch { add(issues, 'regex_invalid', 'error', `success_rules.${index}.value`, '成功规则包含无效正则表达式。', '修正正则语法。') }
    }
    if (rule.type === 'json_path') {
      const spec = rule.value as { path?: unknown; equals?: unknown }
      if (!spec || typeof spec.path !== 'string' || !spec.path) add(issues, 'json_path_invalid', 'error', `success_rules.${index}.value`, 'json_path 规则缺少 path。', '使用 {"path":"data.success","equals":true}。')
    }
  }
}

function inspectSteps(steps: Array<Record<string, unknown>>, base: string, issues: AdapterInspectionIssue[]): void {
  for (const [index, step] of steps.entries()) {
    const path = `${base}.${index}`
    const type = String(step.type ?? step.action ?? '')
    if (!BUILTIN_STEP_TYPES.has(type)) { add(issues, 'step_unsupported', 'error', `${path}.type`, `不支持的步骤类型：${type || '空'}`, '改用文档规定的步骤类型。'); continue }
    if (['goto', 'request'].includes(type) && !step.url) add(issues, 'step_url_missing', 'error', `${path}.url`, `${type} 步骤缺少 URL。`, '补充目标 URL。')
    if (['click', 'fill', 'input', 'wait_for', 'extract'].includes(type) && !step.selector) add(issues, 'selector_missing', 'error', `${path}.selector`, `${type} 步骤缺少 selector。`, '补充稳定的 CSS/文本选择器。')
    if (type === 'condition') {
      if (!step.check && !step.if) add(issues, 'condition_missing', 'error', path, 'condition 缺少 check/if 条件。', '使用 selector_text、selector 或变量匹配。')
      inspectSteps(asSteps(step.then), `${path}.then`, issues); inspectSteps(asSteps(step.else), `${path}.else`, issues)
    } else if (type === 'retry') {
      if (!asSteps(step.steps).length) add(issues, 'retry_empty', 'error', `${path}.steps`, 'retry 内没有步骤。', '添加需要重试的实际操作。')
      inspectSteps(asSteps(step.steps), `${path}.steps`, issues)
    } else if (type === 'try_catch') {
      inspectSteps(asSteps(step.try), `${path}.try`, issues); inspectSteps(asSteps(step.catch), `${path}.catch`, issues)
    }
  }
}

function inspectBehavior(adapter: Adapter, issues: AdapterInspectionIssue[]): void {
  const flat = flattenSteps(adapter.steps ?? [])
  const actions = flat.filter((step) => ['click', 'fill', 'input', 'request', 'tieba_batch_sign'].includes(String(step.type ?? step.action ?? '')))
  if (['browser', 'hybrid'].includes(adapter.engine_type) && !actions.length) add(issues, 'no_checkin_action', 'error', 'steps', '浏览器流程没有任何点击、填写或请求操作，只会打开页面，无法完成签到。', '增加签到按钮点击或签到接口请求。')
  if (flat.some((step) => String(step.type ?? step.action) === 'log' && /手动完成.*签到|请手动.*签到/.test(String(step.message ?? '')))) add(issues, 'manual_only_adapter', 'error', 'steps', '适配器只要求用户手动签到，不具备自动签到能力。', '分析真实按钮或公开签到接口，并生成可执行步骤。')
  const captchaAutomation = flat.some((step) => /captcha|verify|验证码/i.test(`${step.selector ?? ''} ${step.url ?? ''}`) && ['click', 'fill', 'input', 'request'].includes(String(step.type ?? step.action ?? '')))
  if (captchaAutomation) add(issues, 'captcha_automation', 'error', 'steps', '检测到可能自动操作验证码或安全验证的步骤。', '删除绕过逻辑，改为通知用户进行可见验证。')
}

function flattenSteps(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> { return steps.flatMap((step) => [step, ...flattenSteps(asSteps(step.then)), ...flattenSteps(asSteps(step.else)), ...flattenSteps(asSteps(step.steps)), ...flattenSteps(asSteps(step.try)), ...flattenSteps(asSteps(step.catch))]) }
function collectStepUrls(step: Record<string, unknown>): string[] { return [typeof step.url === 'string' ? step.url : '', ...asSteps(step.then).flatMap(collectStepUrls), ...asSteps(step.else).flatMap(collectStepUrls), ...asSteps(step.steps).flatMap(collectStepUrls), ...asSteps(step.try).flatMap(collectStepUrls), ...asSteps(step.catch).flatMap(collectStepUrls)].filter(Boolean) }
function hasCredentialFill(steps: Array<Record<string, unknown>>): boolean { return flattenSteps(steps).some((step) => ['fill', 'input'].includes(String(step.type ?? step.action)) && /password|username|email|account/i.test(`${step.selector ?? ''} ${step.value ?? ''}`)) }
function asSteps(value: unknown): Array<Record<string, unknown>> { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [] }
function sameDomain(host: string, domain: string): boolean { const value = domain.replace(/^\./, '').toLowerCase(); return host === value || host.endsWith(`.${value}`) }
function add(issues: AdapterInspectionIssue[], code: string, severity: AdapterIssueSeverity, path: string, message: string, suggestion: string): void { issues.push({ code, severity, path, message, suggestion }) }
function report(issues: AdapterInspectionIssue[]): AdapterInspectionReport { const score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + (issue.severity === 'error' ? 25 : issue.severity === 'warning' ? 8 : 2), 0)); return { valid: !issues.some((issue) => issue.severity === 'error'), score, issues, checkedAt: new Date().toISOString() } }
