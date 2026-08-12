# 工程文档落实矩阵

| 阶段 | 文档要求 | 实现位置 | 状态 |
|---|---|---|---|
| P0 | 五张核心表、索引、WAL、外键、迁移 | `src/main/database/` | 完成 |
| P0 | 主密码、keytar 回退、PBKDF2、AES-256-GCM | `src/main/security/crypto.ts`、安全解锁窗口 | 完成 |
| P0 | Zod IPC、contextBridge、安全 BrowserWindow | `src/shared/schemas.ts`、`src/preload/`、`src/main/ipc/` | 完成 |
| P1 | HTTP 签到、变量模板、结果解析、Cookie 维护 | `src/main/engine/`、`TaskService` | 完成 |
| P1 | 三份内置适配器与基础任务 UI | `resources/adapters/`、`src/renderer/src/views/` | 完成 |
| P2 | BrowserEngine、Chromium 管理、独立 runner | `src/main/browser/` | 完成 |
| P2 | condition、retry、try_catch | `adapterScriptParser.ts`、`runner.ts` | 完成 |
| P2 | 混合引擎 HTTP 失败回退浏览器 | `TaskService.executeWithEngine` | 完成 |
| P3 | 统计面板与连续签到排行 | `StatisticsService`、`StatisticsView.vue` | 完成 |
| P3 | 应用内/系统通知 | `NotificationService`、`App.vue` | 完成 |
| P3 | AES-256-GCM 加密备份 | `BackupService`、`SettingsView.vue` | 完成 |
| P4 | DOM 分析、脱敏、Prompt、三供应商调用 | `src/main/ai/`、`AIGuideView.vue` | 完成 |
| P4 | 成本估算、Schema 校验、自定义适配器 | `AIGuideService`、`AdapterRegistry` | 完成 |
| P5 | 单元与 HTTP 集成测试 | `tests/` | 完成 |
| P5 | Electron E2E、CI、多平台打包 | `e2e/`、`.github/workflows/ci.yml`、`package.json` | 完成 |

## 有意保留的兼容策略

工程文档指定 `better-sqlite3 + SQLCipher`。桌面运行时优先加载 `better-sqlite3`，但部分 Electron ABI 或系统没有可用的原生构建工具，因此实现了 `node:sqlite` 兼容后端，避免应用无法启动。无论使用哪种后端，凭据和 Cookie 都保持 AES-256-GCM 字段级加密；若发行环境提供 SQLCipher 构建，`PRAGMA key` 会在数据库打开前应用。
