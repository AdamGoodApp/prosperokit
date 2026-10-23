import { pkGlobals } from './bridge.js'
import type { AppInfo } from './types.js'

let cached: AppInfo | null = null

/** `app.info()` (`__PK_APP_INFO` when the host preloaded it, else a sync native call). */
export function appInfo(): AppInfo {
  if (cached) return cached
  const g = pkGlobals()
  let info = g.__PK_APP_INFO
  if (!info) {
    try {
      info = g.__pk?.callSync?.('app', 'info', {}) as AppInfo | undefined
    } catch {
      info = undefined
    }
  }
  if (!info) return { platform: 'host', titleId: '', version: '0.0.0', uptimeMs: 0 }
  cached = info
  return info
}

export function resetAppInfoCache(): void {
  cached = null
}

export const Platform = {
  get OS(): 'ps5' | 'host' {
    return appInfo().platform === 'ps5' ? 'ps5' : 'host'
  },
  select<T>(spec: { ps5?: T; host?: T; default?: T }): T | undefined {
    return spec[Platform.OS] ?? spec.default
  },
}

const dimensions = { width: 1920, height: 1080 } as const

export function useWindowDimensions(): { width: number; height: number } {
  return dimensions
}

export const Appearance = {
  getColorScheme(): 'dark' {
    return 'dark'
  },
}
