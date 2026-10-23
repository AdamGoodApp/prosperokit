/**
 * Design tokens (plan Phase 8 §1). The Tailwind side lives in
 * `@prosperokit/tailwind` (`prosperoTheme`, re-exported here and spread into
 * `tailwind.config.js`); this module adds the raw values components need at
 * runtime (icon colours, animation targets) and the shared focus class strings.
 */
import type { BackgroundGradient } from '@prosperokit/react'
import { prosperoTheme } from '@prosperokit/tailwind/theme'

export { prosperoTheme }

/** Raw colour values (the same numbers as `prosperoTheme.colors`, without the `ps-` prefix). */
export const colors = {
  bg: '#0b0f17',
  bgElevated: '#131a26',
  surface: 'rgba(255,255,255,0.08)',
  surfaceStrong: 'rgba(255,255,255,0.16)',
  border: 'rgba(255,255,255,0.18)',
  text: '#ffffff',
  textMuted: 'rgba(255,255,255,0.64)',
  textDisabled: 'rgba(255,255,255,0.32)',
  accent: '#0070d1',
  accentStrong: '#2d8ff0',
  focus: '#ffffff',
  selection: '#ffffff',
  onSelection: '#0b0f17',
  danger: '#e53e3e',
  success: '#34c759',
  warning: '#f5a623',
  overlay: 'rgba(0,0,0,0.6)',
} as const

/** Every page background: linear gradient 180° from `#101826` to `#05070c`. */
export const pageGradient: BackgroundGradient = {
  angle: 180,
  stops: [
    { offset: 0, color: '#101826' },
    { offset: 1, color: '#05070c' },
  ],
}

/** Pixel sizes at 1080p (10-foot UI). */
export const sizes = {
  screenWidth: 1920,
  screenHeight: 1080,
  pageX: 96,
  pageY: 48,
  rowGap: 24,
  tile: 104,
  tileFocused: 124,
  tileRadius: 12,
  cardWidth: 264,
  cardHeight: 120,
  cardRadius: 8,
  topBarHeight: 96,
  topBarTabText: 40,
  clockText: 32,
  buttonSm: 48,
  button: 64,
  buttonLg: 80,
  input: 64,
  switchWidth: 72,
  switchHeight: 40,
  dialogWidth: 960,
  sheetWidth: 720,
  sidebarWidth: 360,
  drawerHeightPercent: 60,
  scrollThumb: 6,
  selectMaxRows: 8,
} as const

export const fontSizes = {
  xs: 18,
  sm: 20,
  base: 24,
  lg: 28,
  xl: 32,
  '2xl': 40,
  '3xl': 48,
  '4xl': 56,
} as const

export const radii = { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 } as const

/** Timings. */
export const durations = {
  transition: 150,
  slide: 200,
  tooltipDelay: 300,
  toast: 4000,
  clock: 30_000,
} as const

/**
 * Focus class conventions. Compose them with `cn()`; state variants are
 * resolved by the engine (`focus:` / `active:` / `disabled:` only).
 */
export const focusRing = 'focus:ring-[3px] focus:ring-ps-focus focus:ring-offset-4'
/** Tiles and cards: ring + scale. */
export const focusTile = `${focusRing} focus:scale-[1.08] active:scale-[0.97] transition-all duration-150 ease-out`
/** Buttons and rows: invert to the selection colours instead of scaling. */
export const focusInvert =
  'focus:bg-ps-selection focus:text-ps-on-selection transition-all duration-150 ease-out'
/** Pressed feedback for buttons and rows. */
export const pressFeedback = 'active:scale-[0.97]'
/** Disabled state. */
export const disabledState = 'disabled:opacity-50 disabled:text-ps-text-disabled'
/** Base transition used by everything interactive. */
export const transitionBase = 'transition-all duration-150 ease-out'
