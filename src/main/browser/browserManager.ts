import { app } from 'electron'
import type { Dirent } from 'node:fs'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { BrowserProgress } from '../../shared/types.js'
import { resolvePlaywrightCli } from './playwrightPaths.js'

export class PlaywrightBrowserManager {
  private readonly browsersDir: string
  constructor(private readonly onProgress: (progress: BrowserProgress) => void = () => undefined) {
    this.browsersDir = join(app.getPath('userData'), 'browsers')
  }

  async ensureBrowser(): Promise<string> {
    this.onProgress({ phase: 'checking', percent: 5, message: '正在检查 Chromium 运行环境' })
    await mkdir(this.browsersDir, { recursive: true })
    process.env.PLAYWRIGHT_BROWSERS_PATH = this.browsersDir
    const { chromium } = await import('playwright')
    const current = await findChromiumExecutable(this.browsersDir, chromium.executablePath())
    if (current) {
      this.onProgress({ phase: 'ready', percent: 100, message: 'Chromium 已就绪' })
      return current
    }
    await this.downloadChromium()
    const installed = await findChromiumExecutable(this.browsersDir, chromium.executablePath())
    if (!installed) throw new Error(`Chromium 下载完成后仍未找到可执行文件。下载目录：${this.browsersDir}`)
    this.onProgress({ phase: 'ready', percent: 100, message: 'Chromium 安装完成' })
    return installed
  }

  async getVersion(): Promise<string> {
    const require = createRequire(import.meta.url)
    return (require('playwright/package.json') as { version: string }).version
  }

  private downloadChromium(): Promise<void> {
    return new Promise((resolve, reject) => {
      const require = createRequire(import.meta.url)
      const cli = resolvePlaywrightCli(require.resolve('playwright/package.json'), app.isPackaged)
      if (!existsSync(cli)) return reject(new Error('未找到 Playwright 安装程序，请重新安装或更新 AutoCheckin。'))
      const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: this.browsersDir },
        windowsHide: true,
      })
      let output = ''
      const update = (chunk: Buffer): void => {
        const text = chunk.toString(); output += text
        const match = text.match(/(\d{1,3})%/)
        this.onProgress({ phase: 'downloading', percent: match ? Math.min(99, Number(match[1])) : 20, message: '首次使用，正在下载 Chromium' })
      }
      child.stdout.on('data', update); child.stderr.on('data', update)
      child.once('error', reject)
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Chromium 安装失败：${output.slice(-1200)}`)))
    })
  }
}

async function findChromiumExecutable(root: string, preferred: string): Promise<string | null> {
  if (existsSync(preferred)) return preferred
  const names = process.platform === 'win32' ? new Set(['chrome.exe', 'headless_shell.exe']) : new Set(['chrome', 'headless_shell'])
  const visit = async (directory: string): Promise<string | null> => {
    let entries: Dirent<string>[]
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return null }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isFile() && names.has(entry.name)) return path
      if (entry.isDirectory()) { const found = await visit(path); if (found) return found }
    }
    return null
  }
  return visit(root)
}
