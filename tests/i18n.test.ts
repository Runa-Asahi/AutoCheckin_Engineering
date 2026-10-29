import { describe, expect, it } from 'vitest'
import { detectLang, langFromLocale, translate, trMessage, trName } from '../src/shared/i18n.js'

describe('locale detection', () => {
  it('maps zh* to Chinese and everything else to English', () => {
    expect(langFromLocale('zh_CN.UTF-8')).toBe('zh')
    expect(langFromLocale('zh-Hant-TW')).toBe('zh')
    expect(langFromLocale('zh')).toBe('zh')
    expect(langFromLocale('en_US.UTF-8')).toBe('en')
    expect(langFromLocale('de_DE@euro')).toBe('en')
    expect(langFromLocale('C')).toBe('en')
    expect(langFromLocale('')).toBeNull()
  })
  it('follows LC_ALL > LC_MESSAGES > LANG > OS locale', () => {
    expect(detectLang({ LC_ALL: 'en_US.UTF-8', LANG: 'zh_CN.UTF-8' })).toBe('en')
    expect(detectLang({ LC_MESSAGES: 'zh_CN.UTF-8', LANG: 'en_US.UTF-8' })).toBe('zh')
    expect(detectLang({ LANG: 'zh_TW.UTF-8' })).toBe('zh')
    expect(detectLang({ LANG: 'fr_FR.UTF-8' }, 'zh-CN')).toBe('en')
    expect(detectLang({}, 'zh-CN')).toBe('zh')
    expect(detectLang({}, 'ja')).toBe('en')
    expect(detectLang({})).toBe('en')
  })
})

describe('translations', () => {
  it('interpolates and translates', () => {
    expect(translate('en', 'trayStatus', { count: 2 })).toBe('AutoCheckin · 2 account(s)')
    expect(translate('zh', 'trayStatus', { count: 2 })).toBe('AutoCheckin · 2 个账号')
    expect(trName('en', '哔哩哔哩')).toBe('Bilibili')
    expect(trName('zh', '哔哩哔哩')).toBe('哔哩哔哩')
    expect(trMessage('en', '共 3 个吧：新签到 2，原本已签 1，未成功 0')).toBe('3 forums: 2 newly checked in, 1 already done, 0 failed')
    expect(trMessage('en', 'B 站登录已过期，请重新扫码')).toBe('Bilibili login expired. Please sign in again')
    expect(trMessage('en', '未知消息')).toBe('未知消息')
  })
})
