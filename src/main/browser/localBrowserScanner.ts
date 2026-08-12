import { homedir } from 'node:os'
import { join } from 'node:path'
import { access } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'

export interface DetectedBrowser {
  id: string
  name: string
  channel: 'chrome' | 'msedge'
  userDataDir: string
  executablePath: string
  profiles: string[]
}

export class LocalBrowserScanner {
  constructor(private readonly options: { platform?: NodeJS.Platform; homeDir?: string; env?: NodeJS.ProcessEnv } = {}) {}

  async detectBrowserPaths(): Promise<Record<string, string>> {
    const candidates = this.candidates()
    const found: Record<string, string> = {}
    for (const [browser, paths] of Object.entries(candidates)) {
      for (const path of paths) {
        if (await exists(path)) { found[browser] = path; break }
      }
    }
    return found
  }

  async detectBrowsers(): Promise<DetectedBrowser[]> {
    const paths = await this.detectBrowserPaths()
    const metadata: Array<[string, string, 'chrome' | 'msedge']> = [
      ['chrome', 'Google Chrome', 'chrome'], ['edge', 'Microsoft Edge', 'msedge'],
    ]
    const browsers: DetectedBrowser[] = []
    for (const [id, name, channel] of metadata) {
      const userDataDir = paths[id]
      const executablePath = await this.findExecutable(id)
      if (!userDataDir || !executablePath) continue
      browsers.push({ id, name, channel, userDataDir, executablePath, profiles: await this.profiles(userDataDir) })
    }
    return browsers
  }

  private async findExecutable(id: string): Promise<string> {
    const home = this.options.homeDir ?? homedir(), platform = this.options.platform ?? process.platform, env = this.options.env ?? process.env
    let candidates: string[] = []
    if (platform === 'win32') {
      const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), programFiles = env.ProgramFiles ?? 'C:\\Program Files', programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
      candidates = id === 'chrome' ? [join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe')] : [join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]
    } else if (platform === 'darwin') candidates = id === 'chrome' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    else candidates = id === 'chrome' ? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'] : ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable']
    for (const path of candidates) if (await exists(path)) return path
    return ''
  }

  private async profiles(userDataDir: string): Promise<string[]> {
    try {
      const entries = await readdir(userDataDir, { withFileTypes: true })
      const profiles = entries.filter((entry) => entry.isDirectory() && (entry.name === 'Default' || /^Profile \d+$/.test(entry.name))).map((entry) => entry.name)
      return profiles.sort((a, b) => a === 'Default' ? -1 : b === 'Default' ? 1 : a.localeCompare(b, undefined, { numeric: true }))
    } catch { return [] }
  }

  private candidates(): Record<string, string[]> {
    const home = this.options.homeDir ?? homedir(), platform = this.options.platform ?? process.platform, env = this.options.env ?? process.env
    if (platform === 'win32') {
      const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
      const roaming = env.APPDATA ?? join(home, 'AppData', 'Roaming')
      return {
        chrome: [join(local, 'Google', 'Chrome', 'User Data')],
        edge: [join(local, 'Microsoft', 'Edge', 'User Data')],
        chromium: [join(local, 'Chromium', 'User Data')],
        brave: [join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')],
        firefox: [join(roaming, 'Mozilla', 'Firefox', 'Profiles')],
      }
    }
    if (platform === 'darwin') return {
      chrome: [join(home, 'Library', 'Application Support', 'Google', 'Chrome')],
      edge: [join(home, 'Library', 'Application Support', 'Microsoft Edge')],
      chromium: [join(home, 'Library', 'Application Support', 'Chromium')],
      brave: [join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')],
      firefox: [join(home, 'Library', 'Application Support', 'Firefox', 'Profiles')],
    }
    return {
      chrome: [join(home, '.config', 'google-chrome')],
      edge: [join(home, '.config', 'microsoft-edge')],
      chromium: [join(home, '.config', 'chromium')],
      brave: [join(home, '.config', 'BraveSoftware', 'Brave-Browser')],
      firefox: [join(home, '.mozilla', 'firefox')],
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}
