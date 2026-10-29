# AutoCheckin (English)

[中文说明](README.md)

AutoCheckin does your daily check-ins automatically. Sign in by scanning a QR code or on the platform's official login page, with nothing to configure. After every task it re-reads the platform's own status and only reports success when the platform confirms it.

Available as a desktop app (Windows / macOS / Linux AppImage and deb) and an Android app. All data stays on your device; the app only talks to the platforms official servers.

## Supported platforms

| Platform | Daily tasks (default) | How success is verified |
| --- | --- | --- |
| NetEase Cloud Music | Mobile and desktop daily check-in | Re-queries the account check-in status |
| Bilibili | Watch a video, share a video, Bilibili Comics check-in, give 1 coin (off by default, uses coins) | Re-queries the daily XP tasks / comics status |
| Baidu Tieba | Check in to all followed forums | Reloads the forum list and verifies each one |

These are Chinese services, so you need an account on them (and their mobile apps for QR login).

## Language

The desktop UI follows your system locale: Chinese for zh* locales, English for everything else. On Linux it reads LC_ALL, then LC_MESSAGES, then LANG, otherwise the OS language. You can override it under Settings > Language. Messages that come straight from a platform server may still be in Chinese.

## Download

Get the latest build from the [Releases page](https://github.com/Runa-Asahi/AutoCheckin_Engineering/releases/latest). On Linux: `chmod +x AutoCheckin-*.AppImage && ./AutoCheckin-*.AppImage`.
