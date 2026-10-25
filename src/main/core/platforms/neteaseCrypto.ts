import CryptoJS from 'crypto-js'
import { randomBytesArray } from '../portable.js'

/**
 * 网易云音乐 weapi / eapi 加密，与 NeteaseCloudMusicApi（util/crypto.js）一致。
 * 使用纯 JS 的 crypto-js，桌面端（Node）与手机端（WebView）共用同一份代码。
 *   weapi: params = AES-128-CBC(AES-128-CBC(JSON, presetKey), secretKey) 的 Base64；encSecKey = RSA(reverse(secretKey)) 无填充
 *   eapi : params = HEX(AES-128-ECB(`${uri}-36cd479b6b5-${json}-36cd479b6b5-${md5}`))
 */
const PRESET_KEY = '0CoJUm6Qyw8W8jud'
const IV = '0102030405060708'
const EAPI_KEY = 'e82ckenh8dichen8'
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const MODULUS = BigInt('0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7')
const EXPONENT = 0x10001n

function aesCbcBase64(text: string, key: string): string {
  return CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(text), CryptoJS.enc.Utf8.parse(key), { iv: CryptoJS.enc.Utf8.parse(IV), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString()
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n; base %= mod
  while (exp > 0n) { if (exp & 1n) result = (result * base) % mod; base = (base * base) % mod; exp >>= 1n }
  return result
}

function utf8Hex(text: string): string { return [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, '0')).join('') }

export function rsaNoPadding(text: string): string {
  const reversed = [...text].reverse().join('')
  return modPow(BigInt(`0x${utf8Hex(reversed)}`), EXPONENT, MODULUS).toString(16).padStart(256, '0')
}

export function weapi(data: object, secretKey?: string): { params: string; encSecKey: string } {
  const key = secretKey ?? [...randomBytesArray(16)].map((byte) => BASE62[byte % 62]).join('')
  return { params: aesCbcBase64(aesCbcBase64(JSON.stringify(data), PRESET_KEY), key), encSecKey: rsaNoPadding(key) }
}

export function md5Hex(text: string): string { return CryptoJS.MD5(CryptoJS.enc.Utf8.parse(text)).toString(CryptoJS.enc.Hex) }

export function eapi(uri: string, data: object): { params: string } {
  const text = JSON.stringify(data)
  const digest = md5Hex(`nobody${uri}use${text}md5forencrypt`)
  const payload = `${uri}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  const encrypted = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(payload), CryptoJS.enc.Utf8.parse(EAPI_KEY), { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 })
  return { params: encrypted.ciphertext.toString(CryptoJS.enc.Hex).toUpperCase() }
}
