import { app } from 'electron'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AdapterSchema, type Adapter } from '../../shared/schemas.js'
import type { AdapterSummary } from '../../shared/types.js'

export class AdapterRegistry {
  private readonly adapters = new Map<string, Adapter>()

  async load(): Promise<void> {
    this.adapters.clear()
    const builtInRoot = app.isPackaged ? join(process.resourcesPath, 'adapters') : join(process.cwd(), 'resources', 'adapters')
    await this.loadDirectory(builtInRoot)
    await this.loadDirectory(join(app.getPath('userData'), 'adapters'), true)
  }

  get(id: string): Adapter {
    const adapter = this.adapters.get(id)
    if (!adapter) throw new Error(`Adapter not found: ${id}`)
    return adapter
  }

  list(): AdapterSummary[] {
    return [...this.adapters.values()].map((adapter) => ({
      id: adapter.site_id, siteId: adapter.site_id, siteName: adapter.site_name, siteUrl: adapter.site_url,
      engineType: adapter.engine_type, loginType: adapter.login_type,
    }))
  }

  async saveCustom(raw: unknown): Promise<AdapterSummary> {
    const adapter = AdapterSchema.parse(raw), root = join(app.getPath('userData'), 'adapters')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, `${adapter.site_id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`), JSON.stringify(adapter, null, 2), 'utf8')
    this.adapters.set(adapter.site_id, adapter)
    return { id: adapter.site_id, siteId: adapter.site_id, siteName: adapter.site_name, siteUrl: adapter.site_url, engineType: adapter.engine_type, loginType: adapter.login_type }
  }

  private async loadDirectory(root: string, optional = false): Promise<void> {
    let files: string[]
    try { files = await readdir(root) } catch (error) { if (optional) return; throw error }
    for (const filename of files) {
      if (!filename.endsWith('.json')) continue
      const parsed = AdapterSchema.parse(JSON.parse(await readFile(join(root, filename), 'utf8')))
      this.adapters.set(parsed.site_id, upgradeAdapterForRuntime(parsed))
    }
  }
}

/** Luogu's visible menu changed, but its check-in endpoint remains stable. */
export function upgradeAdapterForRuntime(adapter: Adapter): Adapter {
  if (adapter.site_id === 'openasi' || new URL(adapter.site_url).hostname === 'app.openasi.bitmiracle.cn') return AdapterSchema.parse({
    ...adapter,
    site_id: 'openasi',
    site_name: 'OpenASI',
    site_url: 'https://app.openasi.bitmiracle.cn/dashboard',
    engine_type: 'browser',
    login_type: 'local_browser',
    steps: [
      { type: 'goto', url: 'https://app.openasi.bitmiracle.cn/dashboard' },
      { type: 'wait_for', selector: 'body', state: 'visible', timeout_ms: 30_000 },
      { type: 'wait_for_text', value: '仪表盘|签到|登录|密码|邮箱', timeout_ms: 20_000 },
      {
        type: 'condition',
        check: { login_page: true },
        then: [{ type: 'log', result: true, message: '登录状态已失效或当前页面仍要求登录，请重新点击“引导登录并完成首次签到”。' }],
        else: [
          {
            type: 'condition',
            check: { selector_text: '已签到' },
            then: [{ type: 'log', message: '今日已经签到，无需重复操作。' }],
            else: [
              { type: 'click', selector: 'button.h-8:text-is("签到"), button:has-text("签到"):not(:has-text("已签到"))', timeout_ms: 8_000 },
              { type: 'click', selector: 'button.w-full:text-is("签到")', timeout_ms: 8_000 },
              { type: 'wait_for_text', value: '签到成功|今日已签到|已签到', timeout_ms: 15_000 },
            ],
          },
        ],
      },
    ],
    success_rules: [{ type: 'body_regex', value: '签到成功|签到完成|已签到|今日已签' }],
    success_logic: 'or',
    cookie_domains: ['app.openasi.bitmiracle.cn'],
  })
  if (adapter.site_id === 'baidu_tieba') return AdapterSchema.parse({
    ...adapter,
    site_name: '百度贴吧',
    site_url: 'https://tieba.baidu.com/',
    engine_type: 'browser',
    login_type: adapter.login_type === 'manual' ? 'local_browser' : adapter.login_type,
    steps: [{ type: 'goto', url: 'https://tieba.baidu.com/' }, { type: 'tieba_batch_sign' }],
    success_rules: [{ type: 'json_path', value: { path: 'code', equals: 0 } }],
    success_logic: 'or',
    cookie_domains: ['tieba.baidu.com', '.baidu.com'],
  })
  if (adapter.site_id !== 'luogu') return adapter
  return AdapterSchema.parse({
    ...adapter,
    site_name: '洛谷',
    site_url: 'https://www.luogu.com.cn/',
    engine_type: adapter.engine_type === 'browser' ? 'hybrid' : adapter.engine_type,
    login_type: adapter.login_type === 'manual' ? 'local_browser' : adapter.login_type,
    request: {
      method: 'GET',
      url: 'https://www.luogu.com.cn/index/ajax_punch',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://www.luogu.com.cn/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132 Safari/537.36',
      },
      timeout_ms: 30_000,
    },
    steps: [{ type: 'goto', url: 'https://www.luogu.com.cn/' }, { type: 'request', method: 'GET', url: 'https://www.luogu.com.cn/index/ajax_punch', headers: { Accept: 'application/json, text/plain, */*', Referer: 'https://www.luogu.com.cn/' } }],
    success_rules: [
      { type: 'json_path', value: { path: 'code', equals: 200 } },
      { type: 'json_path', value: { path: 'code', equals: 201 } },
    ],
    success_logic: 'or',
    cookie_domains: ['luogu.com.cn', '.luogu.com.cn'],
  })
}
