# AutoCheckin

AutoCheckin 是一款本地优先的自动签到桌面应用。它在用户设备上保存任务、凭据和执行记录，支持 HTTP/API、浏览器自动化以及混合执行模式。

> 当前正式版本：**V1.0.0**

## 功能

- 管理签到任务、Cron 计划、执行记录和 30 天统计
- 支持 HTTP/API、Playwright 浏览器和失败回退的混合引擎
- 内置百度贴吧、HiFiNi、HostLoc、洛谷和 V2EX 适配器
- 支持 Cookie、独立浏览器档案及本地 Chrome/Edge Profile
- 使用 OpenAI、Anthropic、Gemini、DeepSeek、GLM 或兼容接口生成适配器
- 导入、导出 AES-256-GCM 加密的 `.acbackup` 备份
- 提供系统通知、日志脱敏和任务失败诊断

## 安全设计

- 首次启动需设置至少 8 位主密码
- 优先使用系统钥匙串；不可用时以 PBKDF2-SHA512 派生密钥
- 凭据与 Cookie 使用 AES-256-GCM 字段级加密
- Renderer 禁用 Node.js，通过 `contextBridge` 暴露最小 API
- IPC 输入使用 Zod 校验，日志会移除密码、Cookie、Token 和 API Key
- 页面分析拒绝本机、局域网、链路本地地址及非 HTTP(S) URL
- 不提供验证码、风控、反爬机制或账户安全措施的绕过能力

## 系统要求

### 使用发布版

- Windows 10/11、macOS 或主流 Linux 发行版
- 浏览器任务首次运行时需要网络连接，以下载匹配版本的 Chromium
- 复用本地浏览器档案时需要已安装 Chrome 或 Edge

### 从源码开发

- Node.js 20 或更高版本（CI 使用 Node.js 22）
- pnpm 10
- 原生依赖编译所需的系统构建工具（仅在没有预编译包时需要）

## 快速开始

从 GitHub Releases 下载对应平台的安装包。首次启动后设置主密码，然后添加任务并选择内置适配器或 AI 引导。

浏览器任务建议使用 AutoCheckin 专用档案。首次执行时在隔离窗口完成登录和一次手动签到，关闭窗口后，后续任务会复用已保存的登录状态。

## 本地开发

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

运行完整的静态检查、测试与构建：

```powershell
pnpm run typecheck
pnpm test
pnpm run build
pnpm test:e2e
```

生成当前平台安装包：

```powershell
pnpm run dist
```

构建结果位于 `dist/`，该目录不纳入版本控制。

## 项目结构

```text
AutoCheckin/
├─ .github/workflows/   GitHub Actions 验证与发布
├─ docs/                工程实现说明
├─ drizzle/             数据库迁移与元数据
├─ e2e/                 Electron 端到端测试
├─ resources/adapters/  内置签到适配器
├─ src/main/            Electron 主进程、引擎与服务
├─ src/preload/         安全的 Renderer 桥接层
├─ src/renderer/        Vue 3 用户界面
├─ src/shared/          跨进程类型和校验 Schema
└─ tests/               单元与集成测试
```

## 技术栈

Electron、Vue 3、TypeScript、Element Plus、Pinia、Drizzle ORM、SQLite、Playwright、Vitest 和 electron-builder。

数据库优先加载 `better-sqlite3`。当当前 Electron ABI 没有可用原生模块时，应用使用 Electron 内置的 `node:sqlite` 兼容后端；两种后端采用相同的 Schema、迁移、WAL、外键和字段级加密策略。

## 发布

推送 `v*` 标签会触发 GitHub Actions，在 Windows、macOS 和 Linux 上构建安装包并创建 GitHub Release。版本发布约定见 [CHANGELOG.md](CHANGELOG.md)。

## 合规提示

自动化访问可能违反目标网站的用户协议。请仅为自己有权使用的账户配置签到任务，并自行评估使用风险。

## 参与贡献

提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请勿在公开 Issue 中披露，请通过仓库维护者提供的私密渠道报告。
