import CryptoJS from 'crypto-js'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import type { Cipher, Persistence } from '../../src/main/core/store'
import { randomHex } from '../../src/main/core/portable'

const DATA_KEY = 'data-v2'
const FIELD_KEY = 'field-key'

/**
 * 整份数据存进 Android Keystore 保护的存储（AES-GCM，密钥不可导出，卸载即清除）。
 * 写入是异步的：内存里保留最新内容，按顺序落盘。
 */
export async function keystorePersistence(): Promise<Persistence & { flush(): Promise<void> }> {
  await SecureStorage.setKeyPrefix('autocheckin_')
  let current = (await SecureStorage.get(DATA_KEY, false, false)) as string | null
  let chain: Promise<void> = Promise.resolve()
  return {
    read: () => current,
    write: (text) => { current = text; chain = chain.then(() => SecureStorage.set(DATA_KEY, text, false, false)).catch((error) => console.error('保存失败', (error as Error).message)) },
    flush: () => chain,
  }
}

/** Cookie / API Key 字段再加一层：AES-256-CBC + HMAC-SHA256，密钥本身也存在 Keystore 存储里。 */
export async function fieldCipher(): Promise<Cipher> {
  let hex = (await SecureStorage.get(FIELD_KEY, false, false)) as string | null
  if (!hex || hex.length !== 128) { hex = randomHex(64); await SecureStorage.set(FIELD_KEY, hex, false, false) }
  const key: string = hex
  const encKey = CryptoJS.enc.Hex.parse(key.slice(0, 64)), macKey = CryptoJS.enc.Hex.parse(key.slice(64))
  return {
    encrypt(plain: string): string {
      const iv = CryptoJS.enc.Hex.parse(randomHex(16))
      const data = CryptoJS.AES.encrypt(plain, encKey, { iv }).ciphertext
      const body = iv.clone().concat(data)
      return `cjs:${CryptoJS.enc.Base64.stringify(body)}.${CryptoJS.HmacSHA256(body, macKey).toString()}`
    },
    decrypt(value: string): string {
      if (!value.startsWith('cjs:')) throw new Error('无法识别的加密格式')
      const [b64, mac] = value.slice(4).split('.')
      const body = CryptoJS.enc.Base64.parse(b64)
      if (CryptoJS.HmacSHA256(body, macKey).toString() !== mac) throw new Error('数据被篡改或密钥不匹配')
      const iv = CryptoJS.lib.WordArray.create(body.words.slice(0, 4), 16)
      const data = CryptoJS.lib.WordArray.create(body.words.slice(4), body.sigBytes - 16)
      return CryptoJS.AES.decrypt(CryptoJS.lib.CipherParams.create({ ciphertext: data }), encKey, { iv }).toString(CryptoJS.enc.Utf8)
    },
  }
}
