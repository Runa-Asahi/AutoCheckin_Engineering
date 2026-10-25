// 渲染手机界面截图（412x915，Pixel 级别屏幕），用法：node scripts/mobile-screens.mjs <输出目录>
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const out = process.argv[2] ?? 'screens'
const server = await createServer({ configFile: false, root: 'mobile/demo', plugins: [vue()], server: { port: 5199 }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch()
const shots = []
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, colorScheme: scheme, locale: 'zh-CN', isMobile: true, hasTouch: true })
  const shot = async (name) => { const file = `${out}/${name}${scheme === 'dark' ? '-dark' : ''}.png`; await page.waitForTimeout(350); await page.screenshot({ path: file }); shots.push(file) }
  await page.goto('http://localhost:5199/?scene=empty'); await page.getByText('每天自动签到').waitFor(); await shot('01-home-empty')
  await page.goto('http://localhost:5199/'); await page.getByText('晴天的小鹿').waitFor(); await shot('02-home-accounts')
  await page.getByRole('button', { name: '添加账号' }).click(); await shot('03-add-sheet')
  await page.getByRole('dialog').getByText('哔哩哔哩', { exact: true }).click(); await page.locator('.qr-frame img').waitFor(); await shot('04-login-qr')
  await page.getByLabel('返回').click(); await page.getByRole('button', { name: '添加账号' }).click(); await page.getByRole('dialog').getByText('百度贴吧', { exact: true }).click(); await shot('05-login-web')
  await page.getByLabel('返回').click(); await page.getByText('晴天的小鹿').click(); await shot('06-results')
  await page.getByLabel('返回').click(); await page.getByLabel('设置').click(); await shot('07-settings')
  await page.close()
}
await browser.close(); await server.close()
console.log(shots.join('\n'))
