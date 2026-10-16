const SENSITIVE_KEY = String.raw`(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|pwd|access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|api[_-]?key|x-api-key)`

const VALUE_KEY = String.raw`(?:password|passwd|pwd|access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|api[_-]?key|x-api-key)`

const sensitivePatterns: RegExp[] = [
  // JSON-style: "password":"hunter2" / "Cookie": "a=1; b=2"
  new RegExp(String.raw`("${SENSITIVE_KEY}"\s*:\s*")((?:[^"\\]|\\.)*)(")`, 'gi'),
  // Authorization header with a scheme: keep the scheme, drop the credential
  /(authorization\s*[:=]\s*)(?:(bearer|basic|token)\s+)?([^\s,;"]+)/gi,
  // Cookie header lines run until the end of the line
  /((?:set-)?cookie\s*[:=]\s*)([^\n"]+)/gi,
  // key=value / key: value (authorization/cookie are handled above)
  new RegExp(String.raw`(\b${VALUE_KEY}\s*[:=]\s*["']?)([^"'\s,}&]+)`, 'gi'),
]

export function sanitizeLog(value: unknown): string {
  let output = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
  output = output.replace(sensitivePatterns[0], '$1***$3')
  output = output.replace(sensitivePatterns[1], (_m, prefix: string, scheme?: string) => `${prefix}${scheme ? `${scheme} ` : ''}***`)
  output = output.replace(sensitivePatterns[2], (m, prefix: string, rest: string) => rest.startsWith('***') ? m : `${prefix}***`)
  output = output.replace(sensitivePatterns[3], (m, prefix: string, rest: string) => rest.startsWith('***') ? m : `${prefix}***`)
  return output.slice(0, 4000)
}
