import type { Platform } from '../platform.js'
import { bilibili } from './bilibili.js'
import { netease } from './netease.js'
import { tieba } from './tieba.js'

/** 注册新平台：在这里加一行即可。 */
export const PLATFORMS: Platform[] = [netease, bilibili, tieba]
export function getPlatform(id: string): Platform {
  const platform = PLATFORMS.find((item) => item.id === id)
  if (!platform) throw new Error(`不支持的平台：${id}`)
  return platform
}
