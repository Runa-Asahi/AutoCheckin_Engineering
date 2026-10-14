export type UnlockGate = 'unlocked' | 'setup' | 'prompt'

export function unlockRequirement(input: { keychainPassword: string | null; masterConfigured: boolean }): UnlockGate {
  if (input.keychainPassword) return 'unlocked'
  return input.masterConfigured ? 'prompt' : 'setup'
}

export function isSilentLaunch(input: { argv: string[]; wasOpenedAtLogin: boolean; wasOpenedAsHidden: boolean }): boolean {
  return input.argv.includes('--hidden') || input.wasOpenedAtLogin || input.wasOpenedAsHidden
}

export function loginItemOptions(enabled: boolean): { openAtLogin: boolean; openAsHidden: boolean; args: string[] } {
  return { openAtLogin: enabled, openAsHidden: enabled, args: enabled ? ['--hidden'] : [] }
}

export function shouldKeepRunningWhenWindowsClose(input: { trayAvailable: boolean; explicitQuit: boolean }): boolean {
  return input.trayAvailable && !input.explicitQuit
}

export interface SessionSnapshot {
  phase: 'locked' | 'running' | 'stopped'
  background: boolean
  mainVisible: boolean
  unlockVisible: boolean
  quitReason: string | null
}

/** Mirrors the main-process window, tray and unlock decisions so they can be tested without Electron. */
export class SessionController {
  private explicitQuit = false
  readonly snapshot: SessionSnapshot = { phase: 'locked', background: false, mainVisible: false, unlockVisible: false, quitReason: null }

  constructor(private readonly options: { trayAvailable: boolean; silentLaunch: boolean; unlock: UnlockGate }) {}

  start(): void {
    if (this.options.unlock === 'unlocked') this.finishStart()
    else {
      this.snapshot.unlockVisible = true
      this.snapshot.background = false
      this.snapshot.mainVisible = false
    }
  }

  submitUnlock(): void {
    if (!this.snapshot.unlockVisible) return
    this.snapshot.unlockVisible = false
    this.finishStart()
  }

  openMainWindow(): void {
    if (this.snapshot.phase !== 'running') return
    this.snapshot.mainVisible = true
  }

  closeMainWindow(): void {
    if (shouldKeepRunningWhenWindowsClose({ trayAvailable: this.options.trayAvailable, explicitQuit: this.explicitQuit })) {
      this.snapshot.mainVisible = false
      this.snapshot.background = true
      return
    }
    this.stop('windows-closed')
  }

  requestQuit(): void {
    this.explicitQuit = true
    this.stop('quit')
  }

  private finishStart(): void {
    this.snapshot.phase = 'running'
    this.snapshot.background = true
    this.snapshot.mainVisible = !this.options.silentLaunch
  }

  private stop(reason: string): void {
    this.snapshot.phase = 'stopped'
    this.snapshot.background = false
    this.snapshot.mainVisible = false
    this.snapshot.unlockVisible = false
    this.snapshot.quitReason = reason
  }
}
