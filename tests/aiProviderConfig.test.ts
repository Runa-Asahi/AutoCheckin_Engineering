import { describe, expect, it } from 'vitest'
import { getProviderPreset, needsV1Reminder, normalizeBaseUrl } from '../src/shared/aiProviders.js'

describe('AI provider config', () => {
  it('removes whitespace and all trailing slashes', () => expect(normalizeBaseUrl(' https://relay.example.com/v1/// ')).toBe('https://relay.example.com/v1'))
  it('reminds only custom OpenAI endpoints that do not contain v1', () => {
    expect(needsV1Reminder('custom-openai', 'https://relay.example.com')).toBe(true)
    expect(needsV1Reminder('custom-openai', 'https://relay.example.com/v1')).toBe(false)
    expect(needsV1Reminder('deepseek', 'https://api.deepseek.com')).toBe(false)
  })
  it('contains official DeepSeek defaults', () => {
    expect(getProviderPreset('deepseek')).toMatchObject({ baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', protocol: 'openai-compatible' })
  })
})
