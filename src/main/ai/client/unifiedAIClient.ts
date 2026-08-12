import { getProviderPreset, normalizeBaseUrl } from '../../../shared/aiProviders.js'
import type { AIProviderConfig } from '../../../shared/schemas.js'
import { toFriendlyApiError } from '../apiErrors.js'
import { AnthropicAdapter } from './anthropicAdapter.js'
import { GeminiAdapter } from './geminiAdapter.js'
import { OpenAICompatibleAdapter } from './openAICompatibleAdapter.js'
import type { AIProviderAdapter } from './types.js'

export class UnifiedAIClient {
  private readonly adapters = {
    'openai-compatible': new OpenAICompatibleAdapter(),
    anthropic: new AnthropicAdapter(),
    gemini: new GeminiAdapter(),
  } satisfies Record<string, AIProviderAdapter>

  async listModels(config: AIProviderConfig): Promise<string[]> {
    try {
      return await this.adapterFor(config).listModels(normalizeConfig(config))
    } catch (error) { throw toFriendlyApiError(error) }
  }

  async generate(config: AIProviderConfig, prompt: string): Promise<string> {
    try {
      return await this.adapterFor(config).generate(normalizeConfig(config), prompt)
    } catch (error) { throw toFriendlyApiError(error) }
  }

  private adapterFor(config: AIProviderConfig): AIProviderAdapter {
    return this.adapters[getProviderPreset(config.provider).protocol]
  }
}

function normalizeConfig(config: AIProviderConfig): AIProviderConfig {
  return { ...config, baseUrl: normalizeBaseUrl(config.baseUrl), apiKey: config.apiKey.trim(), model: config.model.trim() }
}
