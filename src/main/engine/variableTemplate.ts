export function renderTemplate(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === 'string') return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => variables[key] ?? '')
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, variables))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderTemplate(item, variables)]))
  return value
}

export function buildVariables(userValues: Record<string, string>, now = new Date()): Record<string, string> {
  return {
    date: now.toISOString().slice(0, 10),
    datetime: now.toISOString(),
    timestamp: String(now.getTime()),
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, '0'),
    day: String(now.getDate()).padStart(2, '0'),
    random: Math.random().toString(36).slice(2),
    ...userValues,
  }
}
