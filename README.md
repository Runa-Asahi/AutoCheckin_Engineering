# AutoCheckin

扫码即用的自动签到桌面应用。不用复制 Cookie，也不用写配置。

## 怎么用

1. 打开 AutoCheckin，点 **＋ 添加账号**
2. 选平台，用手机 App 扫屏幕上的二维码，然后在手机上确认登录
3. 勾选要做的任务，选好每天几点执行
4. 点 **立即签到** 试一次，每项任务都会显示 ✔ 成功 / ✔ 已完成 / ✘ 失败及原因

关掉窗口后程序会继续在托盘运行，每天按时自动执行。失败的任务会每隔 30 分钟重试，每天最多 3 次。登录过期时会提示你重新扫码。

## 支持的平台

| 平台 | 任务 |
| --- | --- |
| 网易云音乐 | 手机端每日签到（领云贝）、电脑端每日签到 |
| 哔哩哔哩 | 每日观看视频、每日分享视频、每日投 1 枚硬币（默认关闭）、漫画签到 |

**只有确认过的结果才算成功**：每个任务执行完后都会再查一次平台的状态接口。网易云查 `mobileSign` / `pcSign`，B 站查每日任务状态和漫画签到状态。平台确认已完成才显示成功；接口说成功但平台状态没变，会显示失败。

## 隐私

登录信息只保存在本机，用系统钥匙串加密（Windows DPAPI / macOS 钥匙串 / Linux libsecret）。

“高级设置”里有一个可选的 AI 功能，可以用大白话解释失败原因。开启后只发送脱敏后的结果文字，不发送登录信息。

## 开发

需要 Node.js 22、pnpm 10。

```bash
pnpm install
pnpm dev          # 开发模式
pnpm test         # 单元测试（HTTP 全部模拟）
pnpm run typecheck && pnpm run build
```

### 新增一个平台

1. 在 `src/main/core/platforms/` 下新建文件，实现 `Platform` 接口（`src/main/core/platform.ts`）：
   - `qrStart` / `qrPoll`：扫码登录。`HttpSession` 会自动收集 Set-Cookie
   - `profile`：校验登录。登录失效时抛 `LoginExpiredError`
   - `run`：执行任务。**执行完必须查询平台状态确认**，确认后才能返回 `success` / `already`
2. 在 `platforms/index.ts` 的 `PLATFORMS` 里加一行
3. 用 nock 写测试，参考 `tests/netease.test.ts`

界面会自动显示新平台和它的任务开关，不需要改界面代码。
