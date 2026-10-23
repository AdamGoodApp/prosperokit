import { prosperoTheme } from '@prosperokit/tailwind/theme'

/** Tailwind v3 config: the ProsperoKit design tokens spread into `theme.extend`. */
export default {
  content: ['./src/**/*.{ts,tsx}', './registry/**/*.tsx'],
  theme: {
    extend: { ...prosperoTheme },
  },
}
