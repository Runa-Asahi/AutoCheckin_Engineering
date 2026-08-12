import axios from 'axios'
import { normalizeBaseUrl } from '../../../shared/aiProviders.js'
import type { AIProviderConfig } from '../../../shared/schemas.js'
import type { AIProviderAdapter } from './types.js'

export class AnthropicAdapter implements AIProviderAdapter {
  async listModels(config: AIProviderConfig): Promise<string[]> {
    const response = await axios.get(`${normalizeBaseUrl(config.baseUrl)}/models`, { headers: headers(config), timeout: 30_000 })
    const models = Array.isArray(response.data?.data) ? response.data.data : []
    return models.map((item: { id?: unknown }) => String(item.id ?? '')).filter(Boolean).sort()
  }

  async generate(config: AIProviderConfig, prompt: string): Promise<string> {
    const response = await axios.post(`${normalizeBaseUrl(config.baseUrl)}/messages`, {
      model: config.model,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    }, { headers: headers(config), timeout: 90_000 })
    const content = response.data?.content?.find?.((item: { type?: string }) => item.type === 'text')?.text
    if (typeof content !== 'string' || !content.trim()) throw new Error('接口返回成功，但没有找到模型输出内容。')
    return content
  }
}

function headers(config: AIProviderConfig): Record<string, string> {
  return { 'x-api-key': config.apiKey.trim(), 'anthropic-version': '2023-06-01' }
}
