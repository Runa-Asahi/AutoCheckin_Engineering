import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Menu, Tray, app, nativeImage, type NativeImage } from 'electron'

const fallbackIcon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABS0lEQVR4nGOwznklZZ3zaq51zquX1jmvvlvnvPpBAH+HqgXpkWKAMv5a57z6TyIG6ZnLADWNVM0w/JIB6iSCiu3zX/0PqHnz363kNbL4dwaov/Bqdip6/X/Rzq//n7358//41Z//QxvewuR+EDQAZPPUDV/+//j17z8IgMieFZ+xG+BR9vp/4ZQP/5O73v23y3v13zb31f/WxZ/+f/oK0QwCX3/8+1824wOmAY4Fr/9vOvodbNObj3//ty/99L9k+gcwGwZ+/fn/f972r/8dCl5jGuBX9eb/o5d/4Io/fPn7/yES/8/f///XH/6GHogIA0Cmrjv8DawQGzhw/sd/n8o36GGEGgZeFW/+bzn+HcOQ87d//Q+pf4stkDFjAd2Q209+/0/seIcrln5gTUhe5W/+z9r85f/GI9//p/W8x5dGvlMlKVOcmSjKzgC5J8gzW4CSEAAAAABJRU5ErkJggg=='

export interface TrayController {
  rebuild(): void
  destroy(): void
  tooltip(text: string): void
}

export function resourcePath(name: string): string | undefined {
  const candidates = [join(process.resourcesPath, name), join(app.getAppPath(), 'resources', name), join(process.cwd(), 'resources', name)]
  return candidates.find((path) => existsSync(path))
}

export function loadTrayIcon(): NativeImage {
  const path = resourcePath('tray.png')
  if (path) {
    // A sibling tray@2x.png is picked up automatically for high-DPI trays.
    const image = nativeImage.createFromPath(path)
    if (!image.isEmpty()) return image
  }
  return nativeImage.createFromDataURL(fallbackIcon)
}

export function createAppTray(input: {
  open: () => void
  checkNow: () => void
  quit: () => void
  autoLaunch: () => boolean
  setAutoLaunch: (enabled: boolean) => void
  status: () => string
}): TrayController {
  const tray = new Tray(loadTrayIcon())
  const paint = (): void => {
    const status = input.status()
    tray.setToolTip(status)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 AutoCheckin', click: input.open },
      { label: '立即检查未完成签到', click: () => void input.checkNow() },
      { label: '查看最近执行', click: input.open },
      { label: status, enabled: false },
      { type: 'separator' },
      { label: '开机自动启动', type: 'checkbox', checked: input.autoLaunch(), click: (item) => input.setAutoLaunch(Boolean(item.checked)) },
      { type: 'separator' },
      { label: '退出 AutoCheckin', click: input.quit },
    ]))
  }
  tray.on('double-click', input.open)
  paint()
  return { rebuild: paint, destroy: () => tray.destroy(), tooltip: (text) => tray.setToolTip(text) }
}
