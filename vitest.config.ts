import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], exclude: ['e2e/**'], coverage: { reporter: ['text', 'html'] } } })
