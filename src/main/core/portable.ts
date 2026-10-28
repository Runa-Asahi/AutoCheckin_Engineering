/** 与运行环境无关的小工具：Node 22 与 Android WebView 都提供 Web Crypto 的 getRandomValues / randomUUID。 */
export function randomBytesArray(length: number): Uint8Array {
  const out = new Uint8Array(length)
  globalThis.crypto.getRandomValues(out)
  return out
}
export function randomHex(length: number): string {
  return [...randomBytesArray(Math.ceil(length / 2))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, length)
}
export function randomInt(max: number): number { return randomBytesArray(4).reduce((acc, b) => acc * 256 + b, 0) % max }
export function uuid(): string { return globalThis.crypto.randomUUID() }
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
