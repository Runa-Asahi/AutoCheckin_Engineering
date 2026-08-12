import { renderTemplate } from '../engine/variableTemplate.js'

export type CompiledStep = Record<string, unknown> & { type: string }
const simpleTypes = new Set(['goto', 'click', 'fill', 'wait', 'wait_for', 'extract', 'log', 'screenshot'])

export function compileAdapterSteps(rawSteps: Array<Record<string, unknown>>, variables: Record<string, string>): CompiledStep[] {
  return rawSteps.map((raw, index) => compileStep(renderTemplate(raw, variables) as Record<string, unknown>, `steps[${index}]`))
}

function compileStep(step: Record<string, unknown>, path: string): CompiledStep {
  const type = String(step.type ?? '')
  if (simpleTypes.has(type)) return { ...step, type }
  if (type === 'condition') return { ...step, type, then: compileAdapterSteps(asSteps(step.then, `${path}.then`), {}), else: compileAdapterSteps(asSteps(step.else ?? [], `${path}.else`), {}) }
  if (type === 'retry') {
    const maxAttempts = Number(step.max_attempts ?? 3)
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error(`${path}.max_attempts 必须在 1-10 之间`)
    return { ...step, type, max_attempts: maxAttempts, steps: compileAdapterSteps(asSteps(step.steps, `${path}.steps`), {}) }
  }
  if (type === 'try_catch') return { ...step, type, try: compileAdapterSteps(asSteps(step.try, `${path}.try`), {}), catch: compileAdapterSteps(asSteps(step.catch ?? [], `${path}.catch`), {}) }
  throw new Error(`${path} 包含不支持的步骤类型：${type}`)
}
function asSteps(value: unknown, path: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error(`${path} 必须是步骤数组`)
  return value as Array<Record<string, unknown>>
}
