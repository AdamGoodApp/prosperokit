/**
 * The ProsperoKit design tokens (plan Phase 8 §1) as a Tailwind `theme.extend`
 * object. `@prosperokit/ui`'s `tailwind.config.js` re-exports this; the token
 * compiler merges it into twrnc's config by default.
 */
export const prosperoTheme = {
  colors: {
    'ps-bg': '#0b0f17',
    'ps-bg-elevated': '#131a26',
    'ps-surface': 'rgba(255,255,255,0.08)',
    'ps-surface-strong': 'rgba(255,255,255,0.16)',
    'ps-border': 'rgba(255,255,255,0.18)',
    'ps-text': '#ffffff',
    'ps-text-muted': 'rgba(255,255,255,0.64)',
    'ps-text-disabled': 'rgba(255,255,255,0.32)',
    'ps-accent': '#0070d1',
    'ps-accent-strong': '#2d8ff0',
    'ps-focus': '#ffffff',
    'ps-selection': '#ffffff',
    'ps-on-selection': '#0b0f17',
    'ps-danger': '#e53e3e',
    'ps-success': '#34c759',
    'ps-warning': '#f5a623',
    'ps-overlay': 'rgba(0,0,0,0.6)',
  },
  // px at 1080p; 10-foot UI, minimum body 24. Line heights ≈ 1.35×.
  fontSize: {
    xs: ['18px', { lineHeight: '24px' }],
    sm: ['20px', { lineHeight: '28px' }],
    base: ['24px', { lineHeight: '32px' }],
    lg: ['28px', { lineHeight: '38px' }],
    xl: ['32px', { lineHeight: '44px' }],
    '2xl': ['40px', { lineHeight: '52px' }],
    '3xl': ['48px', { lineHeight: '62px' }],
    '4xl': ['56px', { lineHeight: '72px' }],
  },
  borderRadius: {
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    full: '9999px',
  },
  fontFamily: {
    sans: ['Inter'],
  },
} as const

export type ProsperoTheme = typeof prosperoTheme
