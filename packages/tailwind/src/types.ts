/** A style object in the engine's (React Native-like) key format. */
export type EngineStyle = Record<string, unknown>

/** A transition fragment; unset fields are filled with engine defaults (all, 150 ms, ease). */
export interface TransitionFragment {
  props?: string | string[]
  duration?: number
  delay?: number
  easing?: string
}

/** A gradient fragment; fragments of several tokens combine into one `backgroundGradient`. */
export interface GradientFragment {
  angle?: number
  from?: number
  via?: number
  to?: number
}

/** One entry of `app.styles.json`'s `styles` array. */
export interface TokenStyle {
  base?: EngineStyle
  focus?: EngineStyle
  active?: EngineStyle
  disabled?: EngineStyle
  transition?: TransitionFragment
  gradient?: GradientFragment
  /**
   * Host props (not styles) a token contributes, e.g. `line-clamp-2` →
   * `{ numberOfLines: 2 }`. The engine ignores this field; the runtime
   * resolver (`resolveClassProps`) hands it to the React layer, which passes
   * the props through to the host node.
   */
  props?: Record<string, unknown>
}

/** Why a token could not be compiled. */
export interface Rejection {
  token: string
  reason: string
}

/** The `app.styles.json` shape. */
export interface StyleTableJson {
  tokens: Record<string, number>
  styles: TokenStyle[]
}

export interface CompileResult extends StyleTableJson {
  rejected: Rejection[]
}

export type CompileOutcome =
  | { style: TokenStyle; reason?: undefined }
  | { style: null; reason: string }
