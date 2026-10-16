import { describe, expect, it } from 'vitest'
import { normalizeProfilePath } from '../src/main/browser/localBrowserManager.js'

// These cases use Windows paths; node:path only parses them on Windows.
const onWindows = it.runIf(process.platform === 'win32')

describe('normalizeProfilePath', () => {
  it('accepts a User Data root', () => expect(normalizeProfilePath('C:\\Users\\demo\\Chrome\\User Data', 'Profile 1')).toEqual({ userDataDir: 'C:\\Users\\demo\\Chrome\\User Data', profileName: 'Profile 1' }))
  onWindows('splits a Profile child directory automatically', () => expect(normalizeProfilePath('C:\\Users\\demo\\Chrome\\User Data\\Profile 1')).toEqual({ userDataDir: 'C:\\Users\\demo\\Chrome\\User Data', profileName: 'Profile 1' }))
  onWindows('normalizes compact profile folder names', () => expect(normalizeProfilePath('C:\\Users\\demo\\Chrome\\User Data\\profile1')).toEqual({ userDataDir: 'C:\\Users\\demo\\Chrome\\User Data', profileName: 'Profile 1' }))
  it('selects the first real profile when Default does not exist', () => expect(normalizeProfilePath('C:\\Users\\demo\\Chrome\\User Data', 'Default', ['Profile 1'])).toEqual({ userDataDir: 'C:\\Users\\demo\\Chrome\\User Data', profileName: 'Profile 1' }))
})
