import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface KeytarLike { getPassword(service: string, account: string): Promise<string | null>; setPassword(service: string, account: string, password: string): Promise<void> }
interface RememberedSecret { get(): Promise<string | null>; set(password: string): Promise<void> }

export class MasterPasswordManager {
  constructor(private readonly dataDir: string, private readonly keytarOverride?: KeytarLike | null, private readonly rememberedOverride?: RememberedSecret | null) {}

  private keytarService(): string {
    return process.env.AUTOCHECKIN_KEYTAR_SERVICE || 'AutoCheckin'
  }

  private async keytar(): Promise<KeytarLike | null> {
    if (this.keytarOverride !== undefined) return this.keytarOverride
    try {
      const module = await import('keytar') as unknown as { default?: KeytarLike } & Partial<KeytarLike>
      const candidate = module.default ?? module
      return typeof candidate.getPassword === 'function' && typeof candidate.setPassword === 'function' ? candidate as KeytarLike : null
    } catch { return null }
  }

  private async rememberedSecret(): Promise<RememberedSecret | null> {
    if (this.rememberedOverride !== undefined) return this.rememberedOverride
    if (!process.versions.electron) return null
    try {
      const { safeStorage } = await import('electron')
      if (!safeStorage.isEncryptionAvailable()) return null
      const path = join(this.dataDir, 'master.secret')
      return {
        get: async () => {
          const payload = await readFile(path)
          const password = safeStorage.decryptString(payload)
          return password || null
        },
        set: async (password: string) => {
          await mkdir(this.dataDir, { recursive: true })
          await writeFile(path, safeStorage.encryptString(password), { mode: 0o600 })
        },
      }
    } catch { return null }
  }

  async setMasterPassword(password: string): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    const keytar = await this.keytar()
    if (keytar) { try { await keytar.setPassword(this.keytarService(), 'master', password) } catch { /* the encrypted file below still remembers it */ } }
    const remembered = await this.rememberedSecret()
    if (remembered) { try { await remembered.set(password) } catch { /* verifier still lets the user type the password next time */ } }
    const salt = randomBytes(32)
    const derived = pbkdf2Sync(password, salt, 100_000, 32, 'sha512')
    const hash = createHash('sha256').update(derived).digest()
    await writeFile(join(this.dataDir, 'master.verify'), Buffer.concat([salt, hash]), { mode: 0o600 })
  }

  async getMasterPassword(): Promise<string | null> {
    const remembered = await this.rememberedSecret()
    try {
      const stored = await remembered?.get()
      if (stored) return stored
    } catch { /* try the system keychain */ }
    const keytar = await this.keytar()
    try { return await keytar?.getPassword(this.keytarService(), 'master') ?? null } catch { return null }
  }

  async verifyMasterPassword(password: string): Promise<boolean> {
    const stored = await this.getMasterPassword()
    if (stored !== null) return stored === password
    try {
      const payload = await readFile(join(this.dataDir, 'master.verify'))
      const actual = createHash('sha256').update(pbkdf2Sync(password, payload.subarray(0, 32), 100_000, 32, 'sha512')).digest()
      return timingSafeEqual(actual, payload.subarray(32))
    } catch { return false }
  }

  async isSet(): Promise<boolean> {
    if (await this.getMasterPassword()) return true
    try { await readFile(join(this.dataDir, 'master.verify')); return true } catch { return false }
  }
}

export class DatabaseKeyDeriver {
  constructor(private readonly dataDir: string) {}
  async deriveKey(masterPassword: string): Promise<Buffer> {
    await mkdir(this.dataDir, { recursive: true })
    const saltPath = join(this.dataDir, 'salt.bin')
    let salt: Buffer
    try { salt = await readFile(saltPath) } catch { salt = randomBytes(32); await writeFile(saltPath, salt, { mode: 0o600 }) }
    return pbkdf2Sync(masterPassword, salt, 100_000, 32, 'sha512')
  }
}

export class CredentialEncryptor {
  constructor(private readonly masterKey: Buffer) {
    if (masterKey.length !== 32) throw new Error('AES-256-GCM requires a 32-byte key')
  }
  encrypt(plaintext: string): { ciphertext: Buffer; iv: Buffer } {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return { ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]), iv }
  }
  decrypt(ciphertext: Buffer, iv: Buffer): string {
    const body = ciphertext.subarray(0, -16)
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv)
    decipher.setAuthTag(ciphertext.subarray(-16))
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  }
}
