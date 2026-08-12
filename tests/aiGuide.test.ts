import { describe, expect, it } from 'vitest'
import { buildPrompt, sanitizeDom } from '../src/main/ai/aiGuideService.js'

describe('AI guide privacy', () => {
  it('removes scripts, input values and token-like data attributes', () => {
    const clean = sanitizeDom(`<html><script>secret()</script><input value="password" data-token="abc"><button>签到</button></html>`)
    expect(clean).not.toContain('secret()')
    expect(clean).not.toContain('password')
    expect(clean).not.toContain('abc')
    expect(clean).toContain('签到')
  })
  it('adds explicit safety boundaries to prompts', () => {
    const prompt = buildPrompt('https://example.com', '<button>Sign</button>')
    expect(prompt).toContain('Never bypass CAPTCHA')
    expect(prompt).toContain('Return one JSON object only')
    expect(prompt).toContain('body_includes, body_regex, json_path')
  })
})
