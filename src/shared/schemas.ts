import { z } from 'zod'

export const AIProviderSchema = z.enum(['openai', 'deepseek', 'custom-openai', 'ollama', 'anthropic', 'gemini'])
export const AIProviderConfigSchema = z.object({
  provider: AIProviderSchema,
  baseUrl: z.string().trim().url(),
  apiKey: z.string().default(''),
  model: z.string().trim().min(1).max(200),
})
export type AIProvider = z.infer<typeof AIProviderSchema>
export type AIProviderConfig = z.infer<typeof AIProviderConfigSchema>

export const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const UpdateAccountSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().optional(),
  time: TimeSchema.optional(),
  tasks: z.record(z.string(), z.boolean()).optional(),
})
export type UpdateAccountInput = z.infer<typeof UpdateAccountSchema>
