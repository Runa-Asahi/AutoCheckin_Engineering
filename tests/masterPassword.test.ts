import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MasterPasswordManager } from '../src/main/security/crypto.js'
import { SessionController, unlockRequirement } from '../src/main/services/lifecyclePolicy.js'

describe('remembered master password', () => {
  const directories: string[] = []
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('remembers the password when the system keychain rejects it, so a silent relaunch stays unlocked', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'autocheckin-master-'))
    directories.push(directory)
    const memory = new Map<string, string>()
    const remembered = {
      get: async () => memory.get('master') ?? null,
      set: async (password: string) => { memory.set('master', password) },
    }
    const keytar = {
      getPassword: async () => null,
      setPassword: async () => { throw new Error('keychain unavailable') },
    }
    const password = 'remember-this-password'
    const first = new MasterPasswordManager(directory, keytar, remembered)
    await first.setMasterPassword(password)
    const verifier = await readFile(join(directory, 'master.verify'))
    expect(verifier.includes(Buffer.from(password))).toBe(false)
    const restarted = new MasterPasswordManager(directory, keytar, remembered)
    expect(await restarted.getMasterPassword()).toBe(password)
    expect(unlockRequirement({ keychainPassword: await restarted.getMasterPassword(), masterConfigured: await restarted.isSet() })).toBe('unlocked')
    const session = new SessionController({ trayAvailable: true, silentLaunch: true, unlock: 'unlocked' })
    session.start()
    expect(session.snapshot).toMatchObject({ phase: 'running', background: true, mainVisible: false, unlockVisible: false })
  })

  it('asks again on startup when nothing can store the password, including a hidden login launch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'autocheckin-master-'))
    directories.push(directory)
    const manager = new MasterPasswordManager(directory, null, null)
    await manager.setMasterPassword('type-again')
    expect(await manager.getMasterPassword()).toBeNull()
    expect(await manager.isSet()).toBe(true)
    expect(await manager.verifyMasterPassword('type-again')).toBe(true)
    expect(await manager.verifyMasterPassword('wrong-password')).toBe(false)
    expect(unlockRequirement({ keychainPassword: await manager.getMasterPassword(), masterConfigured: true })).toBe('prompt')
    const session = new SessionController({ trayAvailable: true, silentLaunch: true, unlock: 'prompt' })
    session.start()
    expect(session.snapshot).toMatchObject({ phase: 'locked', background: false, unlockVisible: true, mainVisible: false })
  })
})
