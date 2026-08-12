import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('launches the production Electron shell', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'autocheckin-e2e-'))
  const executablePath = process.env.AUTOCHECKIN_EXECUTABLE
  const app = await electron.launch(executablePath ? { executablePath, args: [`--user-data-dir=${profile}`] } : { args: ['.', `--user-data-dir=${profile}`] })
  app.process().stderr?.on('data', (chunk) => process.stderr.write(`[electron] ${chunk}`))
  try {
    const security = await app.firstWindow()
    expect(await security.evaluate(() => typeof (window as unknown as { security?: unknown }).security)).toBe('object')
    await expect(security.getByText('创建主密码')).toBeVisible()
    const passwords = security.locator('input[type=password]')
    await passwords.nth(0).fill('AutoCheckin-Test-2026')
    await passwords.nth(1).fill('AutoCheckin-Test-2026')
    const windowPromise = app.waitForEvent('window', { predicate: page => page !== security })
    await security.getByRole('button', { name: '设置并进入' }).click()
    const window = await windowPromise
    const rendererErrors: string[] = []
    window.on('console', message => process.stderr.write(`[renderer:${message.type()}] ${message.text()}\n`))
    window.on('pageerror', error => { rendererErrors.push(error.message); process.stderr.write(`[renderer:error] ${error.stack ?? error.message}\n`) })
    await expect(window).toHaveTitle('AutoCheckin')
    await expect(window.getByText('签到任务', { exact: true }).first()).toBeVisible()
    await expect(window.getByRole('button', { name: /添加任务/ })).toBeVisible()
    await window.getByRole('link', { name: '设置' }).click()
    await expect(window.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
    await expect(window.getByRole('button', { name: '浏览器' })).toBeVisible()
    await expect(window.getByRole('heading', { name: '本地浏览器' })).toBeVisible()
    const settingsUrl = window.url()
    await window.getByRole('button', { name: 'AI API' }).click()
    expect(window.url()).toBe(settingsUrl)
    const apiSection = window.locator('#ai-api')
    await apiSection.locator('.el-select').first().click()
    await window.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: 'Custom OpenAI' }).click()
    const baseUrl = apiSection.getByPlaceholder('例如: https://api.deepseek.com/v1 或你的中转代理地址')
    await baseUrl.fill('https://relay.example.com///')
    await baseUrl.blur()
    await expect(baseUrl).toHaveValue('https://relay.example.com')
    await expect(apiSection.getByText('建议检查是否需要包含 /v1')).toBeVisible()
    const modelInput = apiSection.locator('.el-select').nth(1).locator('input')
    await modelInput.click()
    await modelInput.fill('deepseek-reasoner')
    await modelInput.press('Enter')
    const apiKey = window.locator('#ai-api input[type=password]')
    await apiKey.fill('sk-e2e-test-key-12345678')
    await window.getByRole('button', { name: '保存设置' }).click()
    await expect(window.getByText('已配置')).toBeVisible()
    await window.getByRole('link', { name: 'AI 向导' }).click()
    await expect(window.getByText('已从设置加载 API Key')).toBeVisible()
    expect(rendererErrors).toEqual([])
  } finally { await app.close() }
})
