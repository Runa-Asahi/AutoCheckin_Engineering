# 贡献指南

## 开发流程

1. 使用 Node.js 22 和 pnpm 10 安装依赖：`pnpm install --frozen-lockfile`。
2. 从 `main` 创建功能分支并保持改动聚焦。
3. 提交前运行 `pnpm run typecheck`、`pnpm test`、`pnpm run build` 和 `pnpm test:e2e`。
4. Pull Request 中说明行为变化、验证方式和相关 Issue。

## 适配器要求

- 适配器只能执行签到所必需的操作。
- 禁止实现验证码、反自动化、风控或账户安全措施的绕过。
- 不得提交真实 Cookie、Token、密码、API Key 或个人数据。
- 优先使用稳定的 URL、表单字段和语义选择器，并同时处理“已签到”状态。

## 代码约定

- 保持 TypeScript 类型完整，并复用 `src/shared/` 中的跨进程类型与 Schema。
- 新功能应提供与风险相称的单元、集成或端到端测试。
- 不提交 `dist/`、`out/`、测试报告、浏览器档案或本地数据库。
