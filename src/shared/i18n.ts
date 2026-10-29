/**
 * Minimal i18n: Chinese for zh* locales, English everywhere else.
 * Desktop (Electron main): locale comes from LC_ALL → LC_MESSAGES → LANG (POSIX order), then app.getLocale().
 * Renderer: asks main via IPC; a manual override ('zh' | 'en') can be stored in localStorage.
 */
export type Lang = 'zh' | 'en'
export type LangPref = Lang | 'auto'

/** Map any locale tag (zh_CN.UTF-8, zh-Hant-TW, en_US, C, POSIX…) to a UI language. */
export function langFromLocale(locale: string | undefined | null): Lang | null {
  if (!locale) return null
  const tag = locale.trim().split(/[.@:]/)[0].toLowerCase()
  if (!tag) return null
  if (tag === 'c' || tag === 'posix') return 'en'
  return /^zh([-_]|$)/.test(tag) ? 'zh' : 'en'
}

/** POSIX precedence: the first non-empty of LC_ALL, LC_MESSAGES, LANG decides; otherwise the OS locale (e.g. Electron app.getLocale()). */
export function detectLang(env: Record<string, string | undefined>, fallbackLocale?: string): Lang {
  for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANG']) { const l = langFromLocale(env[key]); if (l) return l }
  return langFromLocale(fallbackLocale) ?? 'en'
}

const zh = {
  appTitle: 'AutoCheckin 自动签到', settings: '设置', addAccount: '＋ 添加账号',
  emptyTitle: '还没有账号', emptyBody: '点“添加账号”，扫一下二维码或在官方登录窗口里登录就好，不需要复制任何东西。', emptyCta: '＋ 扫码添加账号',
  autoCheckin: '自动签到', running: '正在签到…', runNow: '立即签到', remove: '移除', cancel: '取消',
  expired: '登录已过期，需要重新扫码一次。', rescan: '重新扫码',
  everyDay: '每天', scheduleHint: '自动执行（电脑开着、软件在托盘里时生效）',
  lastRun: '最近一次：', manual: '手动', auto: '自动', noTasks: '没有勾选任何任务。', explainAi: '用 AI 帮我看看为什么失败',
  removeTitle: '移除账号', removeConfirm: '确定移除 {platform}「{name}」吗？本机保存的登录信息会一起删除。',
  qrAlt: '登录二维码', reopenWindow: '重新打开登录窗口', refreshQr: '刷新二维码', otherPlatform: '换一个平台',
  webOpened: '已打开{platform}官方登录窗口，{hint}', loginFailed: '登录失败：{error}', fetchingQr: '正在获取二维码…', qrFailed: '获取二维码失败：{error}',
  keychainTitle: '系统钥匙串不可用', keychainBody: '登录信息已改用本机密钥文件加密（AES-256-GCM）。这比系统钥匙串弱：拿到你整个用户目录的人可以解密。建议安装并启用系统钥匙串（如 GNOME Keyring / KWallet）。',
  notifyAfter: '签到完成后弹出系统通知',
  mobileTitle: '手机版的定时说明', mobileBody: '到设定时间会弹出提醒；点提醒（或任何时候打开 App）会自动完成当天还没做的签到。安卓系统限制后台联网，App 不会在你完全不打开的情况下偷偷运行。',
  autoLaunch: '开机自动启动（在托盘里静默运行）', aiSection: '高级：AI 解释失败原因（可选）',
  aiIntro: '开启后，签到失败时可以让 AI 用大白话解释原因。只会发送脱敏后的结果文字，不会发送登录信息。', aiEnable: '开启 AI 解释',
  provider: '服务商', baseUrl: '接口地址', model: '模型', apiKeySaved: 'API Key（已保存，留空不修改）', save: '保存', saved: '已保存',
  language: '界面语言', langAuto: '跟随系统',
  status_success: '✔ 成功', status_already: '✔ 已完成', status_failed: '✘ 失败', status_login_expired: '⚠ 需登录', status_skipped: '– 跳过',
  // tray / main process
  trayOpen: '打开 AutoCheckin', trayCheck: '立即检查未完成签到', trayRecent: '查看最近执行', trayAutoLaunch: '开机自动启动', trayQuit: '退出 AutoCheckin',
  trayStatus: 'AutoCheckin · {count} 个账号', loginWindow: '登录', noWebLogin: '该平台不支持网页登录', loginWindowClosed: '登录窗口已关闭',
}
export type MessageKey = keyof typeof zh

const en: Record<MessageKey, string> = {
  appTitle: 'AutoCheckin', settings: 'Settings', addAccount: '+ Add account',
  emptyTitle: 'No accounts yet', emptyBody: 'Click “Add account”, then scan the QR code or sign in on the official login page. Nothing to copy or paste.', emptyCta: '+ Add an account',
  autoCheckin: 'Auto check-in', running: 'Checking in…', runNow: 'Check in now', remove: 'Remove', cancel: 'Cancel',
  expired: 'Your login has expired. Please scan the QR code again.', rescan: 'Scan again',
  everyDay: 'Every day at', scheduleHint: '(runs while the computer is on and the app is in the tray)',
  lastRun: 'Last run: ', manual: 'manual', auto: 'scheduled', noTasks: 'No tasks selected.', explainAi: 'Ask AI why it failed',
  removeTitle: 'Remove account', removeConfirm: 'Remove {platform} account “{name}”? The login data saved on this computer will be deleted too.',
  qrAlt: 'Login QR code', reopenWindow: 'Reopen login window', refreshQr: 'Refresh QR code', otherPlatform: 'Choose another platform',
  webOpened: 'Opened the official {platform} login window. {hint}', loginFailed: 'Login failed: {error}', fetchingQr: 'Getting QR code…', qrFailed: 'Could not get QR code: {error}',
  keychainTitle: 'System keychain unavailable', keychainBody: 'Login data is encrypted with a local key file instead (AES-256-GCM). This is weaker than the system keychain: anyone with access to your whole home directory could decrypt it. Consider installing and enabling a keychain (e.g. GNOME Keyring / KWallet).',
  notifyAfter: 'Show a system notification after each check-in',
  mobileTitle: 'Scheduling on mobile', mobileBody: 'At the scheduled time you get a reminder; tapping it (or opening the app any time) completes today’s pending check-ins. Android restricts background networking, so the app never runs without being opened.',
  autoLaunch: 'Launch at login (runs quietly in the tray)', aiSection: 'Advanced: AI explanation of failures (optional)',
  aiIntro: 'When enabled, AI can explain a failed check-in in plain language. Only the redacted result text is sent — never your login data.', aiEnable: 'Enable AI explanations',
  provider: 'Provider', baseUrl: 'Base URL', model: 'Model', apiKeySaved: 'API Key (saved — leave empty to keep)', save: 'Save', saved: 'Saved',
  language: 'Language', langAuto: 'Follow system',
  status_success: '✔ Done', status_already: '✔ Already done', status_failed: '✘ Failed', status_login_expired: '⚠ Login needed', status_skipped: '– Skipped',
  trayOpen: 'Open AutoCheckin', trayCheck: 'Run pending check-ins now', trayRecent: 'View recent runs', trayAutoLaunch: 'Launch at login', trayQuit: 'Quit AutoCheckin',
  trayStatus: 'AutoCheckin · {count} account(s)', loginWindow: 'Sign in', noWebLogin: 'This platform does not support web login', loginWindowClosed: 'The login window was closed',
}

const DICT: Record<Lang, Record<MessageKey, string>> = { zh, en }

export function translate(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  return DICT[lang][key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''))
}

/** Platform / task metadata in English (backend keeps Chinese as the source of truth). */
const EN_NAMES: Record<string, string> = {
  网易云音乐: 'NetEase Cloud Music', 哔哩哔哩: 'Bilibili', 百度贴吧: 'Baidu Tieba',
  手机端每日签到: 'Daily check-in (mobile)', 电脑端每日签到: 'Daily check-in (desktop)', 签到所有关注的吧: 'Check in to all followed forums',
  每日观看视频: 'Watch a video daily', 每日分享视频: 'Share a video daily', '每日投 1 枚硬币': 'Give 1 coin daily', 漫画签到: 'Bilibili Comics check-in',
  '领取每日云贝（等同在 App 里点“签到”）': 'Claim daily Cloud Shells (same as tapping “Check in” in the app)', '电脑客户端 / 网页端签到积分': 'Desktop / web check-in points',
  '逐个签到你关注的每一个吧，并逐个确认': 'Checks in to every forum you follow, one by one, and verifies each',
  '自动“看”一个热门视频，经验 +5': 'Automatically “watches” a trending video, +5 XP', '分享一个热门视频，经验 +5': 'Shares a trending video, +5 XP',
  '给热门视频投 1 枚硬币，经验 +10（会消耗硬币）': 'Gives 1 coin to a trending video, +10 XP (uses coins)', 哔哩哔哩漫画每日签到: 'Daily Bilibili Comics check-in',
  '打开网易云音乐 App，点左上角菜单 → 扫一扫': 'Open the NetEase Cloud Music app, tap the top-left menu → Scan',
  '打开哔哩哔哩 App，点右上角扫一扫': 'Open the Bilibili app and tap Scan in the top-right corner',
  '在打开的百度官方登录窗口里登录（可扫码或输入账号，验证码请自己完成）': 'Sign in in the official Baidu login window (QR code or account; complete any captcha yourself)',
  贴吧用户: 'Tieba user',
}
export function trName(lang: Lang, text: string): string { return lang === 'en' ? (EN_NAMES[text] ?? text) : text }

/** Best-effort English rendering of common backend status messages; unknown text is returned unchanged. */
const EN_MESSAGES: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  [/^登录成功$/, 'Logged in'],
  [/^已添加 (.+)$/, (_, n) => `Added ${n}`],
  [/^请用(.+?) App 扫码$/, (_, a) => `Scan with the ${EN_NAMES[a] ?? a} app`],
  [/^已扫码(?:（(.+)）)?，请在手机上确认登录$/, (_, n) => `Scanned${n ? ` (${n})` : ''}. Confirm the login on your phone`],
  [/^二维码已(过期|失效)，请刷新$/, 'QR code expired. Please refresh'],
  [/^登录成功但没有拿到登录凭据，请重试$/, 'Logged in, but no credentials were received. Please try again'],
  [/^没有检测到登录完成，请在窗口里完成登录$/, 'Login was not completed. Please finish signing in in the window'],
  [/^该平台不支持(网页|扫码)登录$/, (_, k) => `This platform does not support ${k === '网页' ? 'web' : 'QR'} login`],
  [/^登录(窗口|页)已关闭$/, 'The login window was closed'],
  [/^今天已经签过了$/, 'Already checked in today'],
  [/^今天已经完成了$/, 'Already done today'],
  [/^签到成功$/, 'Checked in'],
  [/^签到成功，获得 (\d+) 积分$/, (_, p) => `Checked in, earned ${p} points`],
  [/^签到成功，状态已确认$/, 'Checked in (verified)'],
  [/^已完成，B 站任务状态已确认$/, 'Done (verified with Bilibili)'],
  [/^(.+?)登录已过期，请重新(扫码|登录)$/, (_, p) => `${EN_NAMES[p] ?? p.replace('B 站', 'Bilibili')} login expired. Please sign in again`],
  [/^登录已过期，请重新扫码登录$/, 'Login expired. Please scan the QR code again'],
  [/^关注的 (\d+) 个吧今天都已经签过了$/, (_, n) => `All ${n} followed forums are already checked in today`],
  [/^共 (\d+) 个吧：新签到 (\d+)，原本已签 (\d+)，未成功 (\d+)$/, (_, a, b, c, d) => `${a} forums: ${b} newly checked in, ${c} already done, ${d} failed`],
  [/^网络连接失败(?:（(.+)）)?，请检查网络$/, (_, c) => `Network connection failed${c ? ` (${c})` : ''}. Please check your network`],
  [/^服务器暂时不可用（HTTP (\d+)）$/, (_, s) => `Server temporarily unavailable (HTTP ${s})`],
  [/^请求被平台风控拦截（HTTP 412），请稍后再试$/, 'Blocked by the platform’s risk control (HTTP 412). Please try again later'],
  [/^硬币不足$/, 'Not enough coins'],
  [/^这个账号还没有运行记录$/, 'This account has not run yet'],
  [/^请先在“高级设置”里开启 AI 解释并填写 API Key$/, 'Enable AI explanations and enter an API key in Advanced settings first'],
  [/^获取二维码失败：(.+)$/, (_, e) => `Could not get QR code: ${e}`],
  [/^登录失败：(.+)$/, (_, e) => `Login failed: ${e}`],
  [/^登录校验失败：(.+)$/, (_, e) => `Login verification failed: ${e}`],
  [/^请求失败：(.+)$/, (_, e) => `Request failed: ${e}`],
]
export function trMessage(lang: Lang, text: string): string {
  if (lang !== 'en' || !text) return text
  for (const [re, out] of EN_MESSAGES) { const m = text.match(re); if (m) return typeof out === 'string' ? out : out(...m) }
  return text
}
