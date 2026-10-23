import type { prosperoTheme } from '@prosperokit/tailwind/theme'

declare const config: {
  content: string[]
  theme: { extend: typeof prosperoTheme }
}
export default config
