type JsonRecord = Record<string, unknown>

const TYPE_ALIASES: Record<string, 'status' | 'body_includes' | 'body_regex' | 'json_path'> = {
  status: 'status', status_code: 'status', statuscode: 'status', http_status: 'status', httpstatus: 'status',
  body_includes: 'body_includes', body_contains: 'body_includes', contains: 'body_includes', text_contains: 'body_includes', content_contains: 'body_includes', body_text: 'body_includes', text: 'body_includes', message: 'body_includes',
  body_regex: 'body_regex', regex: 'body_regex', body_matches: 'body_regex', text_regex: 'body_regex', content_regex: 'body_regex', pattern: 'body_regex',
  json_path: 'json_path', jsonpath: 'json_path', json_value: 'json_path', json: 'json_path',
}

export function normalizeGeneratedAdapter(input: unknown, fallbackUrl: string): unknown {
  if (!isRecord(input)) return input
  const source = { ...input }
  alias(source, 'site_id', 'siteId')
  alias(source, 'site_name', 'siteName')
  alias(source, 'site_url', 'siteUrl')
  alias(source, 'engine_type', 'engineType')
  alias(source, 'login_type', 'loginType')
  alias(source, 'success_rules', 'successRules')
  alias(source, 'success_logic', 'successLogic')
  alias(source, 'cookie_domains', 'cookieDomains')
  if (!source.site_url) source.site_url = fallbackUrl

  const rules = Array.isArray(source.success_rules) ? source.success_rules.map(normalizeRule).filter(isRecord) : []
  source.success_rules = rules.length ? rules : [{ type: 'body_regex', value: '签到成功|已签到|check.?in (?:successful|completed)|already checked' }]
  source.success_logic = normalizeLogic(source.success_logic)
  if (!Array.isArray(source.cookie_domains)) {
    try { source.cookie_domains = [new URL(String(source.site_url)).hostname] } catch { source.cookie_domains = [] }
  }
  return source
}

function normalizeRule(input: unknown): JsonRecord | null {
  if (!isRecord(input)) return null
  const rawType = String(input.type ?? input.rule ?? input.kind ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  let type = TYPE_ALIASES[rawType]
  let value = input.value

  if (!type) {
    if (rawType.includes('status')) type = 'status'
    else if (rawType.includes('regex') || rawType.includes('pattern')) type = 'body_regex'
    else if (rawType.includes('json') || isRecord(value) && typeof value.path === 'string') type = 'json_path'
    else if (rawType.includes('body') || rawType.includes('text') || rawType.includes('contain') || rawType.includes('message') || typeof value === 'string') type = 'body_includes'
  }
  if (!type) return null

  if (value === undefined) {
    if (type === 'status') value = input.status ?? input.status_code ?? input.code ?? 200
    else if (type === 'body_includes') value = input.text ?? input.keyword ?? input.includes ?? input.contains ?? input.content ?? input.message
    else if (type === 'body_regex') value = input.pattern ?? input.regex ?? input.text
    else {
      const path = input.path ?? input.json_path
      if (typeof path === 'string' && path) value = { path, equals: input.equals ?? input.expected ?? input.expected_value ?? true }
    }
  }
  if (type === 'json_path' && typeof value === 'string') value = { path: value, equals: input.equals ?? input.expected ?? true }
  if (value === undefined || value === null || value === '') return null
  return { type, value }
}

function normalizeLogic(value: unknown): 'and' | 'or' {
  const logic = String(value ?? '').toLowerCase()
  return logic === 'and' || logic === 'all' || logic === 'every' ? 'and' : 'or'
}

function alias(target: JsonRecord, canonical: string, alternative: string): void {
  if (target[canonical] === undefined && target[alternative] !== undefined) target[canonical] = target[alternative]
}

function isRecord(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
