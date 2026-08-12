import type { Adapter } from '../../shared/schemas.js'

export interface HttpSnapshot { status: number; body: unknown }

function bodyText(body: unknown): string { return typeof body === 'string' ? body : JSON.stringify(body) }

export function parseResult(rules: Adapter['success_rules'], snapshot: HttpSnapshot, logic: 'and' | 'or' = 'or'): boolean {
  const results = rules.map((rule) => {
    if (rule.type === 'status') return snapshot.status === Number(rule.value)
    if (rule.type === 'body_includes') return bodyText(snapshot.body).includes(String(rule.value))
    if (rule.type === 'body_regex') return new RegExp(String(rule.value), 'i').test(bodyText(snapshot.body))
    if (rule.type === 'json_path') {
      const spec = rule.value as { path?: string; equals?: unknown }
      const value = spec.path?.split('.').reduce<unknown>((cursor, key) => cursor && typeof cursor === 'object' ? (cursor as Record<string, unknown>)[key] : undefined, snapshot.body)
      return value === spec.equals
    }
    return false
  })
  return logic === 'and' ? results.every(Boolean) : results.some(Boolean)
}
