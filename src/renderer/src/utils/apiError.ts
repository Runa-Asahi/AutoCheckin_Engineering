export function friendlyIpcMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '').replace(/^Error:\s*/i, '')
}
