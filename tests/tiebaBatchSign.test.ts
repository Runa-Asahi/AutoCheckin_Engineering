import { describe, expect, it } from 'vitest'
import { classifyTiebaSignResponse, decodeTiebaHtml } from '../src/main/browser/tiebaBatchSign.js'

describe('classifyTiebaSignResponse', () => {
  it('recognizes a successful sign response', () => expect(classifyTiebaSignResponse(200, { no: 0 })).toBe('signed'))
  it('recognizes an already signed response', () => expect(classifyTiebaSignResponse(200, { no: 1101, error: '您今天已经签到过了' })).toBe('already'))
  it('recognizes Baidu wording for a previous sign', () => expect(classifyTiebaSignResponse(200, { no: 1101, error: '亲，你之前已经签过了' })).toBe('already'))
  it('skips forums without membership eligibility', () => expect(classifyTiebaSignResponse(200, { no: 1102, error: '您还未加入此吧或等级不够' })).toBe('skipped'))
  it('keeps risk-control responses as failures', () => expect(classifyTiebaSignResponse(200, { no: 2150040, error: '操作频繁，请完成安全验证' })).toBe('failed'))
  it('decodes legacy GB18030 forum-directory pages', () => { const bytes = Buffer.from([0xbc, 0xaa, 0xc1, 0xd6, 0xb4, 0xf3, 0xd1, 0xa7]); expect(decodeTiebaHtml(bytes, 'text/html; charset=gbk')).toBe('吉林大学') })
})
