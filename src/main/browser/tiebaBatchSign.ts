import type { APIRequestContext, Page } from 'playwright'

interface TiebaForum { name: string; href: string }
export interface TiebaBatchResult { code: number; total: number; signed: number; already: number; skipped: number; failed: number; failures: Array<{ forum: string; reason: string }> }

export async function signAllTiebaForums(page: Page, request: APIRequestContext): Promise<TiebaBatchResult> {
  const tbsResponse = await request.get('https://tieba.baidu.com/dc/common/tbs', { headers: { Referer: 'https://tieba.baidu.com/' } })
  const tbsText = await tbsResponse.text()
  const tbsPayload = parseJson(tbsText) as { is_login?: number; tbs?: string; no?: number; error?: string }
  if (!tbsResponse.ok() || tbsPayload.is_login !== 1 || !tbsPayload.tbs) {
    const reason = tbsPayload.error || '贴吧登录状态已失效，请重新执行可见登录验证。'
    return { code: 401, total: 0, signed: 0, already: 0, skipped: 0, failed: 1, failures: [{ forum: '登录状态', reason }] }
  }

  const forums = await fetchLikedForums(page, request)
  if (!forums.length) return { code: 404, total: 0, signed: 0, already: 0, skipped: 0, failed: 1, failures: [{ forum: '关注列表', reason: '没有读取到已关注的贴吧，请确认账号至少关注了一个吧。' }] }

  const result: TiebaBatchResult = { code: 0, total: forums.length, signed: 0, already: 0, skipped: 0, failed: 0, failures: [] }
  for (const forum of forums) {
    try {
      const response = await request.post('https://tieba.baidu.com/sign/add', {
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Referer: forum.href,
          'X-Requested-With': 'XMLHttpRequest',
        },
        form: { ie: 'utf-8', kw: forum.name, tbs: tbsPayload.tbs },
      })
      const payload = parseJson(await response.text()) as { no?: number; error?: string; error_code?: string | number; data?: { finfo?: { current_rank_info?: { sign_count?: number } } } }
      const classification = classifyTiebaSignResponse(response.status(), payload)
      if (classification === 'signed') result.signed++
      else if (classification === 'already') result.already++
      else if (classification === 'skipped') result.skipped++
      else {
        result.failed++
        result.failures.push({ forum: forum.name, reason: payload.error || `签到接口返回 ${response.status()}` })
        if (isVerificationRequired(payload.error ?? '')) break
      }
    } catch (error) {
      result.failed++
      result.failures.push({ forum: forum.name, reason: error instanceof Error ? error.message : String(error) })
    }
    await page.waitForTimeout(350 + Math.floor(Math.random() * 350))
  }
  result.code = result.failed === 0 ? 0 : 206
  return result
}

async function fetchLikedForums(page: Page, request: APIRequestContext): Promise<TiebaForum[]> {
  const forums = new Map<string, TiebaForum>()
  for (let pageNumber = 1; pageNumber <= 50; pageNumber++) {
    const url = `https://tieba.baidu.com/f/like/mylike?pn=${pageNumber}`
    const response = await request.get(url, { headers: { Referer: 'https://tieba.baidu.com/' } })
    if (!response.ok()) break
    const html = decodeTiebaHtml(await response.body(), response.headers()['content-type'])
    const parsed = await page.evaluate((source) => {
      const document = new DOMParser().parseFromString(source, 'text/html')
      const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/f?"]')]
      const items = links.map((link) => {
        const href = new URL(link.getAttribute('href') ?? '', 'https://tieba.baidu.com/').toString()
        const url = new URL(href)
        const kw = url.searchParams.get('kw')
        // Link text comes from the correctly decoded GB18030 document and is
        // more reliable than legacy query strings that may use GBK escaping.
        const text = (link.textContent ?? '').replace(/吧$/, '').trim()
        const name = text || (kw ?? '').replace(/吧$/, '').trim()
        return { name, href }
      }).filter((item) => item.name)
      const hasNext = [...document.querySelectorAll('a')].some((link) => /下一页|下一頁/.test(link.textContent ?? ''))
      return { items, hasNext }
    }, html)
    const before = forums.size
    for (const forum of parsed.items) forums.set(forum.name, forum)
    if (!parsed.hasNext || forums.size === before) break
  }
  return [...forums.values()]
}

export function classifyTiebaSignResponse(status: number, payload: { no?: number; error?: string; error_code?: string | number }): 'signed' | 'already' | 'skipped' | 'failed' {
  const error = String(payload.error ?? '')
  if (status === 200 && (payload.no === 0 || String(payload.error_code ?? '') === '0')) return 'signed'
  if (/已经签到|已签到|已经签过|签过了|重复签到|请勿重复/.test(error)) return 'already'
  if (/未加入此吧|还未加入|等级不够|无签到资格/.test(error)) return 'skipped'
  return 'failed'
}

export function decodeTiebaHtml(buffer: Buffer, contentType = ''): string {
  const charset = /charset\s*=\s*([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase()
  const encoding = charset && !['utf-8', 'utf8'].includes(charset) ? charset : 'gb18030'
  try { return new TextDecoder(encoding).decode(buffer) } catch { return new TextDecoder('gb18030').decode(buffer) }
}

function isVerificationRequired(message: string): boolean {
  return /验证码|安全验证|访问过于频繁|操作频繁|风控|异常请求/.test(message)
}

function parseJson(text: string): Record<string, unknown> {
  try { const parsed = JSON.parse(text) as unknown; return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {} } catch { return {} }
}
