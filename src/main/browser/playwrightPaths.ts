import { dirname, join } from 'node:path'

export function resolvePlaywrightCli(packageJsonPath: string, isPackaged: boolean): string {
  const cliPath = join(dirname(packageJsonPath), 'cli.js')
  if (!isPackaged) return cliPath
  return cliPath.replace(/([\\/])app\.asar\1/, '$1app.asar.unpacked$1')
}
