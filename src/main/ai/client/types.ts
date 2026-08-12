import type { AIProviderConfig } from '../../../shared/schemas.js'

export interface AIProviderAdapter {
  listModels(config: AIProviderConfig): Promise<string[]>
  generate(config: AIProviderConfig, prompt: string): Promise<string>
}
