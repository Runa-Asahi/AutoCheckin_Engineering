import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('启动后显示扫码添加账号入口', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'autocheckin-e2e-'))
  const executablePath = process.env.AUTOCHECKIN_EXECUTABLE
  const app = await electron.launch(executablePath ? { executablePath, args: [`--user-data-dir=${profile}`] } : { args: ['.', `--user-data-dir=${profile}`] })
  try {
    const window = await app.firstWindow()
    await expect(window).toHaveTitle('AutoCheckin')
    await expect(window.getByText('还没有账号')).toBeVisible()
    await window.getByRole('button', { name: '＋ 扫码添加账号' }).click()
    await expect(window.getByRole('button', { name: /网易云音乐/ })).toBeVisible()
    await expect(window.getByRole('button', { name: /哔哩哔哩/ })).toBeVisible()
    await expect(window.getByRole('button', { name: /百度贴吧/ })).toBeVisible()
    await expect(window.getByRole('button', { name: /洛谷/ })).toBeVisible()
  } finally { await app.close() }
})
