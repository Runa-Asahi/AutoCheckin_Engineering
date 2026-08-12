import axios from 'axios'
import { normalizeBaseUrl } from '../../../shared/aiProviders.js'
import type { AIProviderConfig } from '../../../shared/schemas.js'
import type { AIProviderAdapter } from './types.js'

export class GeminiAdapter implements AIProviderAdapter {
  async listModels(config: AIProviderConfig): Promise<string[]> {
    const response = await axios.get(`${normalizeBaseUrl(config.baseUrl)}/models`, { params: { key: config.apiKey.trim() }, timeout: 30_000 })
    const models = Array.isArray(response.data?.models) ? response.data.models : []
    return models.map((item: { name?: unknown }) => String(item.name ?? '').replace(/^models\//, '')).filter(Boolean).sort()
  }

  async generate(config: AIProviderConfig, prompt: string): Promise<string> {
    const model = config.model.replace(/^models\//, '')
    const response = await axios.post(`${normalizeBaseUrl(config.baseUrl)}/models/${encodeURIComponent(model)}:generateContent`, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }, { params: { key: config.apiKey.trim() }, timeout: 90_000 })
    const content = response.data?.candidates?.[0]?.content?.parts?.map?.((item: { text?: unknown }) => typeof item.text === 'string' ? item.text : '').join('')
    if (typeof content !== 'string' || !content.trim()) throw new Error('接口返回成功，但没有找到模型输出内容。')
    return content
  }
}
