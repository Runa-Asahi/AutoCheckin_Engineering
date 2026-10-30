import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const launch = async (locale: string) => {
  const profile = await mkdtemp(join(tmpdir(), 'autocheckin-e2e-'))
  const executablePath = process.env.AUTOCHECKIN_EXECUTABLE
  const env = { ...process.env, LC_ALL: locale, LC_MESSAGES: locale, LANG: locale } as Record<string, string>
  return electron.launch(executablePath ? { executablePath, env, args: [`--user-data-dir=${profile}`] } : { env, args: ['.', `--user-data-dir=${profile}`] })
}

test('English UI outside Chinese locales', async () => {
  const app = await launch('en_US.UTF-8')
  try {
    const window = await app.firstWindow()
    await expect(window).toHaveTitle('AutoCheckin')
    await expect(window.getByText('No accounts yet')).toBeVisible()
    await window.getByRole('button', { name: '+ Add an account' }).click()
    await expect(window.getByRole('button', { name: /Bilibili/ })).toBeVisible()
  } finally { await app.close() }
})

test('启动后显示扫码添加账号入口', async () => {
  const app = await launch('zh_CN.UTF-8')
  try {
    const window = await app.firstWindow()
    await expect(window).toHaveTitle('AutoCheckin')
    await expect(window.getByText('还没有账号')).toBeVisible()
    await window.getByRole('button', { name: '＋ 扫码添加账号' }).click()
    await expect(window.getByRole('button', { name: /网易云音乐/ })).toBeVisible()
    await expect(window.getByRole('button', { name: /哔哩哔哩/ })).toBeVisible()
    await expect(window.getByRole('button', { name: /百度贴吧/ })).toBeVisible()
  } finally { await app.close() }
})
