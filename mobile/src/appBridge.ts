import { registerPlugin } from '@capacitor/core'

export interface AppBridgePlugin {
  /** 用官方 App 打开链接；opened=false 表示没装该 App */
  openApp(options: { url: string }): Promise<{ opened: boolean }>
  /** 保存 PNG 到 相册/Pictures/AutoCheckin */
  saveImage(options: { base64: string; fileName: string }): Promise<{ saved: boolean; reason?: string }>
}
export const AppBridge = registerPlugin<AppBridgePlugin>('AppBridge')
