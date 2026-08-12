import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalBrowserScanner } from '../src/main/browser/localBrowserScanner.js'

const created: string[] = []
afterEach(async () => { await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('LocalBrowserScanner', () => {
  it('detects Windows Chrome and Edge user data directories in priority order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autocheckin-browser-scan-')); created.push(root)
    await mkdir(join(root, 'Google', 'Chrome', 'User Data'), { recursive: true })
    await mkdir(join(root, 'Microsoft', 'Edge', 'User Data'), { recursive: true })
    const found = await new LocalBrowserScanner({ platform: 'win32', homeDir: root, env: { LOCALAPPDATA: root, APPDATA: root } }).detectBrowserPaths()
    expect(found.chrome).toBe(join(root, 'Google', 'Chrome', 'User Data'))
    expect(found.edge).toBe(join(root, 'Microsoft', 'Edge', 'User Data'))
    expect(Object.keys(found)[0]).toBe('chrome')
  })

  it('returns only verified paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autocheckin-browser-scan-')); created.push(root)
    expect(await new LocalBrowserScanner({ platform: 'linux', homeDir: root }).detectBrowserPaths()).toEqual({})
  })

  it('returns native executable paths and profiles for a detected browser', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autocheckin-browser-scan-')); created.push(root)
    await mkdir(join(root, 'Google', 'Chrome', 'User Data', 'Default'), { recursive: true })
    await mkdir(join(root, 'Google', 'Chrome', 'User Data', 'Profile 1'), { recursive: true })
    const executable = join(root, 'bin', 'Google', 'Chrome', 'Application', 'chrome.exe'); await mkdir(join(root, 'bin', 'Google', 'Chrome', 'Application'), { recursive: true }); await (await import('node:fs/promises')).writeFile(executable, '')
    const found = await new LocalBrowserScanner({ platform: 'win32', homeDir: root, env: { LOCALAPPDATA: root, APPDATA: root, ProgramFiles: join(root, 'bin') } }).detectBrowsers()
    expect(found[0]).toMatchObject({ channel: 'chrome', executablePath: executable, profiles: ['Default', 'Profile 1'] })
  })
})
