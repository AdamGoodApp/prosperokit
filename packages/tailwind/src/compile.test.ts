import { describe, expect, it, vi } from 'vitest'
import { parseColor } from './color.js'
import { compileToken, compileTokens, explainToken, mergeTokenStyles } from './compile.js'
import { createResolver, resolveClasses, setClassTable } from './runtime.js'

const WHITE = 0xffffffff
const ACCENT = 0x0070d1ff
const BG = 0x0b0f17ff

describe('compileToken', () => {
  it('focus:ring-2 → focus.outlineWidth', () => {
    expect(compileToken('focus:ring-2')).toEqual({ focus: { outlineWidth: 2 } })
  })
  it('focus-visible: maps to the focus slot; ring colour and offset', () => {
    expect(compileToken('focus-visible:ring-white')).toEqual({
      focus: { outlineColor: WHITE },
    })
    expect(compileToken('focus:ring-ps-accent')).toEqual({
      focus: { outlineColor: ACCENT },
    })
    expect(compileToken('focus:ring-offset-4')).toEqual({
      focus: { outlineOffset: 4 },
    })
    expect(compileToken('ring')).toEqual({ base: { outlineWidth: 3 } })
  })
  it('active:scale-95', () => {
    expect(compileToken('active:scale-95')).toEqual({
      active: { transform: [{ scale: 0.95 }] },
    })
  })
  it('disabled:opacity-50', () => {
    expect(compileToken('disabled:opacity-50')).toEqual({
      disabled: { opacity: 0.5 },
    })
  })
  it('gradient fragments', () => {
    expect(compileToken('bg-gradient-to-r')).toEqual({ gradient: { angle: 90 } })
    expect(compileToken('bg-gradient-to-bl')).toEqual({
      gradient: { angle: 225 },
    })
    expect(compileToken('from-ps-accent')).toEqual({ gradient: { from: ACCENT } })
    expect(compileToken('via-white')).toEqual({ gradient: { via: WHITE } })
    expect(compileToken('to-ps-bg')).toEqual({ gradient: { to: BG } })
    const merged = mergeTokenStyles(
      ['bg-gradient-to-r', 'from-ps-accent', 'to-ps-bg'].map((t) => compileToken(t) ?? {}),
    )
    expect(merged.gradient).toEqual({ angle: 90, from: ACCENT, to: BG })
  })
  it('hover: is rejected with a focus: hint', () => {
    expect(compileToken('hover:bg-white')).toBeNull()
    const out = explainToken('hover:bg-white')
    expect(out.reason).toContain('focus:')
  })
  it('responsive and other variants are rejected', () => {
    expect(compileToken('sm:p-4')).toBeNull()
    expect(explainToken('sm:p-4').reason).toContain('unsupported variant')
    expect(compileToken('group-hover:p-4')).toBeNull()
    expect(compileToken('first:p-4')).toBeNull()
  })
  it('dark: is stripped', () => {
    expect(compileToken('dark:bg-black')).toEqual({
      base: { backgroundColor: 0x000000ff },
    })
    expect(compileToken('dark:focus:bg-white')).toEqual({
      focus: { backgroundColor: WHITE },
    })
  })
  it('line-clamp-2 → numberOfLines prop', () => {
    expect(compileToken('line-clamp-2')).toEqual({ props: { numberOfLines: 2 } })
  })
  it('transition-all duration-200 ease-out → one transition', () => {
    const list = ['transition-all', 'duration-200', 'ease-out'].map((t) => compileToken(t) ?? {})
    expect(list[0]).toEqual({ transition: { props: 'all' } })
    expect(mergeTokenStyles(list).transition).toEqual({
      props: 'all',
      duration: 200,
      easing: 'ease-out',
    })
    expect(compileToken('delay-150')).toEqual({ transition: { delay: 150 } })
    expect(compileToken('transition-colors')).toEqual({
      transition: { props: 'colors' },
    })
    expect(compileToken('transition-none')).toEqual({
      transition: { props: [] },
    })
  })
  it('px-6 expands to left/right', () => {
    expect(compileToken('px-6')).toEqual({
      base: { paddingLeft: 24, paddingRight: 24 },
    })
    expect(compileToken('my-2')).toEqual({
      base: { marginTop: 8, marginBottom: 8 },
    })
  })
  it('rounded-full / ps-radii', () => {
    expect(compileToken('rounded-full')).toEqual({ base: { borderRadius: 9999 } })
    expect(compileToken('rounded-xl')).toEqual({ base: { borderRadius: 24 } })
  })
  it('text-2xl uses the ProsperoKit type scale; font-semibold', () => {
    expect(compileToken('text-2xl')).toEqual({
      base: { fontSize: 40, lineHeight: 52 },
    })
    expect(compileToken('font-semibold')).toEqual({
      base: { fontWeight: '600' },
    })
  })
  it('shadow-lg keeps shadow keys', () => {
    const s = compileToken('shadow-lg')?.base
    expect(s).toMatchObject({
      shadowColor: 0x000000ff,
      shadowRadius: 8,
      shadowOffset: { width: 1, height: 1 },
    })
  })
  it('opacity-80, gap-4', () => {
    expect(compileToken('opacity-80')).toEqual({ base: { opacity: 0.8 } })
    expect(compileToken('gap-4')).toEqual({ base: { gap: 16 } })
  })
  it('border border-white/20', () => {
    expect(compileToken('border')).toEqual({ base: { borderWidth: 1 } })
    expect(compileToken('border-white/20')).toEqual({
      base: { borderColor: 0xffffff33 },
    })
  })
  it('w-[300px], tracking-wide, colours', () => {
    expect(compileToken('w-[300px]')).toEqual({ base: { width: 300 } })
    expect(compileToken('tracking-wide')).toEqual({
      base: { letterSpacing: 0.6 },
    })
    expect(compileToken('bg-ps-surface')).toEqual({
      base: { backgroundColor: 0xffffff14 },
    })
    expect(compileToken('text-ps-text-muted')).toEqual({
      base: { color: 0xffffffa3 },
    })
  })
  it('misc utilities and rejections', () => {
    expect(compileToken('flex-row')).toEqual({
      base: { flexDirection: 'row' },
    })
    expect(compileToken('object-cover')).toEqual({
      base: { resizeMode: 'cover' },
    })
    expect(compileToken('definitely-not-tailwind')).toBeNull()
    expect(explainToken('definitely-not-tailwind').reason).toContain('unknown utility')
    expect(explainToken('definitely-not-tailwind').reason).toContain('unknown utility')
    expect(compileToken('!p-4')).toBeNull()
    expect(compileToken('underline')).toBeNull()
    expect(compileToken('focus:transition-all')).toBeNull()
  })
  it('does not leak console.warn capture', () => {
    const before = console.warn
    compileToken('nope-nope')
    expect(console.warn).toBe(before)
  })
})

describe('compileTokens', () => {
  it('builds the app.styles.json shape', () => {
    const out = compileTokens(['p-4', 'focus:ring-2', 'p-4', 'hover:x', 'nope'])
    expect(out.tokens).toEqual({ 'p-4': 0, 'focus:ring-2': 1 })
    expect(out.styles).toHaveLength(2)
    expect(out.rejected.map((r) => r.token)).toEqual(['hover:x', 'nope'])
  })
})

describe('parseColor', () => {
  it('parses hex, rgb, hsl, named', () => {
    expect(parseColor('#fff')).toBe(WHITE)
    expect(parseColor('#0070d1')).toBe(ACCENT)
    expect(parseColor('#ff000080')).toBe(0xff000080)
    expect(parseColor('rgba(255, 255, 255, 0.2)')).toBe(0xffffff33)
    expect(parseColor('rgb(0 112 209 / 50%)')).toBe(0x0070d180)
    expect(parseColor('hsl(0, 100%, 50%)')).toBe(0xff0000ff)
    expect(parseColor('hsla(120, 100%, 50%, 0)')).toBe(0x00ff0000)
    expect(parseColor('transparent')).toBe(0)
    expect(parseColor('White')).toBe(WHITE)
    expect(parseColor('nonsense')).toBeNull()
  })
})

describe('resolver', () => {
  const table = {
    tokens: { 'p-4': 0, 'm-2': 1, 'line-clamp-2': 2 },
    props: { 2: { numberOfLines: 2 } },
  }
  it('maps tokens, caches per string, warns once per unknown token', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const resolve = createResolver(table, { dev: true })
    const a = resolve('p-4  m-2 nope')
    expect(a).toEqual([0, 1])
    expect(resolve('p-4  m-2 nope')).toBe(a)
    resolve('nope p-4')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[prosperokit] unknown class "nope"')
    warn.mockRestore()
  })
  it('is silent when not in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createResolver(table, { dev: false })('zzz')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
  it('passes token props through', () => {
    const resolve = createResolver(table, { dev: false })
    expect(resolve.props('p-4 line-clamp-2')).toEqual({ numberOfLines: 2 })
    expect(resolve.props('p-4')).toBeUndefined()
  })
  it('module-level resolveClasses uses setClassTable', () => {
    expect(resolveClasses('p-4')).toEqual([])
    setClassTable(table, { dev: false })
    expect(resolveClasses('m-2 p-4')).toEqual([1, 0])
  })
})
