import nock from 'nock'
import { afterEach, describe, expect, it } from 'vitest'
import { UnifiedAIClient } from '../src/main/ai/client/unifiedAIClient.js'

afterEach(() => nock.cleanAll())

describe('UnifiedAIClient', () => {
  it('lists models from a custom OpenAI relay and removes trailing slashes', async () => {
    nock('https://relay.example.com').get('/v1/models').matchHeader('authorization', 'Bearer relay-key').reply(200, { data: [{ id: 'deepseek-reasoner' }, { id: 'gpt-4o' }] })
    const models = await new UnifiedAIClient().listModels({ provider: 'custom-openai', baseUrl: 'https://relay.example.com/v1///', apiKey: 'relay-key', model: 'manual-model' })
    expect(models).toEqual(['deepseek-reasoner', 'gpt-4o'])
  })

  it('uses OpenAI compatible chat completions for DeepSeek', async () => {
    nock('https://api.deepseek.com').post('/v1/chat/completions', (body) => body.model === 'deepseek-chat').reply(200, { choices: [{ message: { content: '{"ok":true}' } }] })
    const content = await new UnifiedAIClient().generate({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'key', model: 'deepseek-chat' }, 'prompt')
    expect(content).toBe('{"ok":true}')
  })

  it('uses the Anthropic messages format', async () => {
    nock('https://api.anthropic.com').post('/v1/messages').matchHeader('x-api-key', 'key').reply(200, { content: [{ type: 'text', text: '{"provider":"anthropic"}' }] })
    const content = await new UnifiedAIClient().generate({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'key', model: 'claude-test' }, 'prompt')
    expect(content).toContain('anthropic')
  })

  it('lists Gemini native models without the models prefix', async () => {
    nock('https://generativelanguage.googleapis.com').get('/v1beta/models').query({ key: 'key' }).reply(200, { models: [{ name: 'models/gemini-2.0-flash' }] })
    const models = await new UnifiedAIClient().listModels({ provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'key', model: 'gemini-2.0-flash' })
    expect(models).toEqual(['gemini-2.0-flash'])
  })
})
