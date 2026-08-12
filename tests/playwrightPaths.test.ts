import { describe, expect, it } from 'vitest'
import { resolvePlaywrightCli } from '../src/main/browser/playwrightPaths.js'

describe('resolvePlaywrightCli', () => {
  it('uses the package root in development', () => {
    expect(resolvePlaywrightCli('C:\\project\\node_modules\\playwright\\package.json', false)).toBe('C:\\project\\node_modules\\playwright\\cli.js')
  })

  it('maps packaged ASAR paths to the executable unpacked copy', () => {
    expect(resolvePlaywrightCli('C:\\app\\resources\\app.asar\\node_modules\\playwright\\package.json', true)).toBe('C:\\app\\resources\\app.asar.unpacked\\node_modules\\playwright\\cli.js')
  })
})
