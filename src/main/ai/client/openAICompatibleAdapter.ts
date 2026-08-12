import axios from 'axios'
import { normalizeBaseUrl } from '../../../shared/aiProviders.js'
import type { AIProviderConfig } from '../../../shared/schemas.js'
import type { AIProviderAdapter } from './types.js'

export class OpenAICompatibleAdapter implements AIProviderAdapter {
  async listModels(config: AIProviderConfig): Promise<string[]> {
    const response = await axios.get(`${normalizeBaseUrl(config.baseUrl)}/models`, {
      headers: authorizationHeaders(config),
      timeout: 30_000,
    })
    return normalizeModels(response.data)
  }

  async generate(config: AIProviderConfig, prompt: string): Promise<string> {
    const response = await axios.post(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
      model: config.model,
      messages: [
        { role: 'system', content: 'Return valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    }, { headers: authorizationHeaders(config), timeout: 90_000 })
    const content = response.data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('接口返回成功，但没有找到模型输出内容。')
    return content
  }
}

function authorizationHeaders(config: AIProviderConfig): Record<string, string> {
  return config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {}
}

function normalizeModels(payload: unknown): string[] {
  const data = payload as { data?: unknown; models?: unknown }
  const source = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(payload) ? payload : []
  return [...new Set(source.map((item) => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      return String(record.id ?? record.name ?? record.model ?? '')
    }
    return ''
  }).filter(Boolean))].sort()
}
