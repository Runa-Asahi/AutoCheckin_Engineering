# Changelog

## [2.0.1] - 2026-10-30

- 电脑版界面语言跟随系统：中文环境显示中文，其他环境默认英文（Linux 按 LC_ALL → LC_MESSAGES → LANG，其次系统语言）；设置里可手动切换。新增英文说明 README.en.md
- Desktop UI now follows the system locale: Chinese in zh* locales, English everywhere else (on Linux: LC_ALL → LC_MESSAGES → LANG, then the OS language), with a manual switch in Settings. Adds an English README (README.en.md)

## [2.0.0] - 2026-10-28

v2 正式版（全新重写，取代 v1）。内容同 2.0.0-alpha.1 ~ alpha.3：
- 支持网易云音乐、哔哩哔哩（扫码登录）、百度贴吧（官方登录页）；每项任务执行后再查询平台状态，确认成功才显示成功
- 零配置界面；电脑版（Windows / macOS / Linux）与安卓版共用同一套签到核心
- 安全：只在本机、HTTPS 官方域名白名单、登录信息加密保存（系统钥匙串 / Android Keystore）、不记录 Cookie、AI 只收脱敏结果

## 2.0.0-alpha.3（预发布）

- 修复：百度贴吧登录校验失败「已拦截跳转到白名单外的地址」。原因是 `https://tieba.baidu.com/dc/common/tbs` 会 301 降级到 `http://`，被 HTTPS-only 策略拦截；现改为从 HTTPS 的 `/mo/q/newmoindex` 读取 tbs 与登录状态，白名单无需放宽
- 拦截提示中写明被拦截的协议与主机名（不含路径、参数或 Cookie），便于排查
- 移除洛谷模块（代码、界面、测试、白名单 `luogu.com.cn`）；升级后自动删除旧的洛谷账号及其登录信息
- 安卓：全新手机界面（Material 3 风格、深色模式）；B 站 / 网易云手机端改为扫码 + 「在官方 App 中确认」/「保存二维码到相册」
- README / 文档更新

## 2.0.0-alpha.2（预发布）

- 新增百度贴吧、洛谷签到；网络域名白名单；Linux 无钥匙串时的本地密钥加密
- 首个安卓版（Capacitor，复用同一套核心）

## 2.0.0-alpha.1（预发布）

- 全新重写：扫码登录，简单界面，每项任务都在执行后确认结果
- 网易云音乐：采用与 NeteaseCloudMusicApi 一致的 eapi / weapi 加密，签到后查询 `mobileSign` / `pcSign` 确认结果
- 哔哩哔哩：扫码登录；观看、分享、投币、漫画签到，执行后查询任务状态确认
- 移除主密码、适配器 JSON、浏览器自动化和 AI 生成适配器；AI 只保留“解释失败原因”


本项目遵循 [Semantic Versioning](https://semver.org/)。

## [1.1.1] - 2026-10-16

### Security

- 执行记录中的日志脱敏覆盖 JSON 键值、`Authorization: Bearer/Basic` 认证头和 `access_token=` 等查询参数，凭据不再原样写入日志
- 主密码校验改为常量时间比较

### Changed

- 运行环境要求 Node.js 22.5 及以上（`node:sqlite`）
- 新增 Linux CI（类型检查、单元测试、lint），Windows 专用路径测试在其他平台跳过

## [1.1.0] - 2026-10-14

### Fixed

- OpenASI 签到改为点击仪表盘弹窗里的签到按钮；登录页或按钮缺失时给出可操作的失败说明，不再把选择器超时当成网络重试
- 通知按钮不再挡住页头上的「添加任务」等操作

### Added

- 开机后在系统托盘静默运行，关闭主窗口不再退出调度器
- 启动、定时触发和睡眠恢复共用补偿判断，只补当前签到周期
- 签到结果区分尚未开放、临时故障、登录失效和人工验证，并按有限退避重试
- 调度状态写入 SQLite，重启后可以恢复重试进度和当日成功记录
- 主密码加密保存在当前系统账户中，开机自启动不再重复询问
- 窗口、任务栏和托盘使用同一枚签到徽章图标

## [1.0.1] - 2026-10-13

### Fixed

- OpenASI 旧适配器自动升级为持久浏览器登录模式
- 签到操作仅点击可见按钮，避免命中页面标题或导航文字
- 已签到状态识别、点击重试和成功提示等待更加稳定

## [1.0.0] - 2026-08-13

首个正式发布版本。

### Added

- 本地加密的签到任务、凭据、执行日志和统计数据管理
- HTTP/API、浏览器自动化与混合执行引擎
- Cron 调度、系统通知及加密备份导入导出
- 五个内置网站适配器和自定义适配器管理
- 多供应商 AI 适配器向导、安全页面分析及失败诊断
- Windows、macOS 与 Linux 的持续集成和发布构建
