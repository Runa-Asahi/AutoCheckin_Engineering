const sensitivePatterns = [
  /(authorization\s*[:=]\s*)([^\s,;]+)/gi,
  /(cookie\s*[:=]\s*)([^\n]+)/gi,
  /((?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*["']?)([^"'\s,}]+)/gi,
]

export function sanitizeLog(value: unknown): string {
  let output = typeof value === 'string' ? value : JSON.stringify(value)
  for (const pattern of sensitivePatterns) output = output.replace(pattern, '$1***')
  return output.slice(0, 4000)
}
