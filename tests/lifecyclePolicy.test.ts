import { describe, expect, it } from 'vitest'
import { SessionController, isSilentLaunch, loginItemOptions, shouldKeepRunningWhenWindowsClose, unlockRequirement } from '../src/main/services/lifecyclePolicy.js'

describe('launch, unlock and tray lifecycle', () => {
  it('recognizes a hidden login-item launch and a normal manual launch', () => {
    expect(isSilentLaunch({ argv: ['AutoCheckin.exe', '--hidden'], wasOpenedAtLogin: false, wasOpenedAsHidden: false })).toBe(true)
    expect(isSilentLaunch({ argv: ['AutoCheckin.exe'], wasOpenedAtLogin: true, wasOpenedAsHidden: false })).toBe(true)
    expect(isSilentLaunch({ argv: ['AutoCheckin.exe'], wasOpenedAtLogin: false, wasOpenedAsHidden: false })).toBe(false)
    expect(loginItemOptions(true)).toEqual({ openAtLogin: true, openAsHidden: true, args: ['--hidden'] })
    expect(loginItemOptions(false).args).toEqual([])
  })

  it('keeps background work when the window closes and stops it on an explicit quit', () => {
    expect(shouldKeepRunningWhenWindowsClose({ trayAvailable: true, explicitQuit: false })).toBe(true)
    expect(shouldKeepRunningWhenWindowsClose({ trayAvailable: true, explicitQuit: true })).toBe(false)
    expect(shouldKeepRunningWhenWindowsClose({ trayAvailable: false, explicitQuit: false })).toBe(false)
    const session = new SessionController({ trayAvailable: true, silentLaunch: true, unlock: 'unlocked' })
    session.start()
    expect(session.snapshot).toMatchObject({ phase: 'running', background: true, mainVisible: false })
    session.openMainWindow()
    expect(session.snapshot.mainVisible).toBe(true)
    expect(session.snapshot.background).toBe(true)
    session.closeMainWindow()
    expect(session.snapshot).toMatchObject({ phase: 'running', background: true, mainVisible: false })
    session.requestQuit()
    expect(session.snapshot).toMatchObject({ phase: 'stopped', background: false, quitReason: 'quit' })
  })

  it('shows the unlock window and does not start background work before the password is accepted', () => {
    expect(unlockRequirement({ keychainPassword: 'stored', masterConfigured: true })).toBe('unlocked')
    expect(unlockRequirement({ keychainPassword: null, masterConfigured: true })).toBe('prompt')
    expect(unlockRequirement({ keychainPassword: null, masterConfigured: false })).toBe('setup')
    const blocked = new SessionController({ trayAvailable: true, silentLaunch: true, unlock: 'prompt' })
    blocked.start()
    expect(blocked.snapshot).toMatchObject({ phase: 'locked', background: false, mainVisible: false, unlockVisible: true })
    blocked.openMainWindow()
    expect(blocked.snapshot.mainVisible).toBe(false)
    blocked.submitUnlock()
    expect(blocked.snapshot).toMatchObject({ phase: 'running', background: true, mainVisible: false, unlockVisible: false })
    const manual = new SessionController({ trayAvailable: false, silentLaunch: false, unlock: 'setup' })
    manual.start()
    manual.submitUnlock()
    expect(manual.snapshot.mainVisible).toBe(true)
    manual.closeMainWindow()
    expect(manual.snapshot).toMatchObject({ phase: 'stopped', quitReason: 'windows-closed' })
  })
})
