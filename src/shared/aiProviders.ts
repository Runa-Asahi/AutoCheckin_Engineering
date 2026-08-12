import type { AIProvider } from './schemas.js'

export interface AIProviderPreset {
  id: AIProvider
  label: string
  description: string
  baseUrl: string
  defaultModel: string
  protocol: 'openai-compatible' | 'anthropic' | 'gemini'
  apiKeyOptional?: boolean
}

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', description: 'OpenAI 官方 API', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4.1-mini', protocol: 'openai-compatible' },
  { id: 'deepseek', label: 'DeepSeek（官方）', description: 'DeepSeek 官方 OpenAI 兼容接口', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', protocol: 'openai-compatible' },
  { id: 'custom-openai', label: '兼容 / 中转站（Custom OpenAI）', description: '适用于 DeepSeek 中转、聚合 API 和其他 OpenAI 兼容服务', baseUrl: '', defaultModel: 'deepseek-reasoner', protocol: 'openai-compatible' },
  { id: 'ollama', label: 'Ollama（本地）', description: '本机 Ollama OpenAI 兼容接口', baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'qwen2.5', protocol: 'openai-compatible', apiKeyOptional: true },
  { id: 'anthropic', label: 'Anthropic', description: 'Claude 官方 Messages API', baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-haiku-latest', protocol: 'anthropic' },
  { id: 'gemini', label: 'Google Gemini', description: 'Google Gemini 原生 generateContent API', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.0-flash', protocol: 'gemini' },
]

export function getProviderPreset(provider: AIProvider): AIProviderPreset {
  return AI_PROVIDER_PRESETS.find((item) => item.id === provider) ?? AI_PROVIDER_PRESETS[0]
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function needsV1Reminder(provider: AIProvider, baseUrl: string): boolean {
  if (provider !== 'custom-openai') return false
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return false
  try { return !new URL(normalized).pathname.split('/').filter(Boolean).includes('v1') } catch { return false }
}
