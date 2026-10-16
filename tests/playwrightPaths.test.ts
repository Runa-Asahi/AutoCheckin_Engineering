import { describe, expect, it } from 'vitest'
import { resolvePlaywrightCli } from '../src/main/browser/playwrightPaths.js'

// These cases use Windows paths; node:path only parses them on Windows.
const onWindows = it.runIf(process.platform === 'win32')

describe('resolvePlaywrightCli', () => {
  onWindows('uses the package root in development', () => {
    expect(resolvePlaywrightCli('C:\\project\\node_modules\\playwright\\package.json', false)).toBe('C:\\project\\node_modules\\playwright\\cli.js')
  })

  onWindows('maps packaged ASAR paths to the executable unpacked copy', () => {
    expect(resolvePlaywrightCli('C:\\app\\resources\\app.asar\\node_modules\\playwright\\package.json', true)).toBe('C:\\app\\resources\\app.asar.unpacked\\node_modules\\playwright\\cli.js')
  })
})
