import { createCipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * 网易云音乐 weapi 加密，与 NeteaseCloudMusicApi（util/crypto.js）一致：
 *   params    = AES-128-CBC(AES-128-CBC(JSON, presetKey), secretKey) 的 Base64
 *   encSecKey = RSA(reverse(secretKey))，无填充，十六进制 256 位
 */
const PRESET_KEY = '0CoJUm6Qyw8W8jud'
const IV = '0102030405060708'
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const MODULUS = BigInt('0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7')
const EXPONENT = 0x10001n

function aesCbcBase64(text: string, key: string): string {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(IV))
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64')
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n; base %= mod
  while (exp > 0n) { if (exp & 1n) result = (result * base) % mod; base = (base * base) % mod; exp >>= 1n }
  return result
}

export function rsaNoPadding(text: string): string {
  const reversed = [...text].reverse().join('')
  const value = BigInt(`0x${Buffer.from(reversed).toString('hex')}`)
  return modPow(value, EXPONENT, MODULUS).toString(16).padStart(256, '0')
}

export function weapi(data: object, secretKey?: string): { params: string; encSecKey: string } {
  const key = secretKey ?? [...randomBytes(16)].map((byte) => BASE62[byte % 62]).join('')
  return { params: aesCbcBase64(aesCbcBase64(JSON.stringify(data), PRESET_KEY), key), encSecKey: rsaNoPadding(key) }
}

const EAPI_KEY = 'e82ckenh8dichen8'

/**
 * 网易云音乐 eapi 加密（客户端接口），与 NeteaseCloudMusicApi 一致：
 *   params = HEX(AES-128-ECB(`${uri}-36cd479b6b5-${json}-36cd479b6b5-${md5("nobody"+uri+"use"+json+"md5forencrypt")}`))
 * uri 形如 /api/point/dailyTask。
 */
export function eapi(uri: string, data: object): { params: string } {
  const text = JSON.stringify(data)
  const digest = createHash('md5').update(`nobody${uri}use${text}md5forencrypt`).digest('hex')
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(EAPI_KEY), null)
  const payload = `${uri}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  return { params: Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]).toString('hex').toUpperCase() }
}
