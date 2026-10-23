/**
 * Public types of `@prosperokit/react` (Phase 5). This file is the contract
 * the UI library, the testing helpers and app code are written against.
 */
import type { ReactNode, RefObject } from 'react'

export type NodeId = number

/** A colour: `0xRRGGBBAA` or a CSS-like string (`#rgb`, `#rrggbb[aa]`, `rgb()`, `rgba()`). */
export type ColorValue = number | string

export type LengthValue = number | `${number}%` | 'auto'

export type Transform =
  | { translateX: number }
  | { translateY: number }
  | { scale: number }
  | { scaleX: number }
  | { scaleY: number }
  | { rotate: number | `${number}deg` }

export interface GradientStop {
  offset: number
  color: ColorValue
}

export interface BackgroundGradient {
  /** Degrees, CSS convention (180 = top → bottom). Default 180. */
  angle?: number
  stops: Array<GradientStop | ColorValue | [number, ColorValue]>
}

export type EasingValue =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | `cubic-bezier(${string})`
  | [number, number, number, number]

export type AnimatableProp =
  | 'opacity'
  | 'translateX'
  | 'translateY'
  | 'scale'
  | 'scaleX'
  | 'scaleY'
  | 'rotate'
  | 'backgroundColor'
  | 'borderColor'
  | 'color'
  | 'width'
  | 'height'
  | 'top'
  | 'left'
  | 'scrollX'
  | 'scrollY'

export interface TransitionSpec {
  /** `'all'` (default), `'transform'`, `'colors'` or a list of property names. */
  props?: 'all' | Array<AnimatableProp | 'transform' | 'colors' | 'all'>
  /** Milliseconds, default 150. */
  duration?: number
  /** Milliseconds, default 0. */
  delay?: number
  /** Default `'ease'`. */
  easing?: EasingValue
}

export interface LayoutStyle {
  display?: 'flex' | 'grid' | 'none'
  position?: 'relative' | 'absolute'
  top?: LengthValue
  right?: LengthValue
  bottom?: LengthValue
  left?: LengthValue
  inset?: LengthValue
  width?: LengthValue
  height?: LengthValue
  minWidth?: LengthValue
  minHeight?: LengthValue
  maxWidth?: LengthValue
  maxHeight?: LengthValue
  margin?: LengthValue
  marginTop?: LengthValue
  marginRight?: LengthValue
  marginBottom?: LengthValue
  marginLeft?: LengthValue
  marginHorizontal?: LengthValue
  marginVertical?: LengthValue
  padding?: LengthValue
  paddingTop?: LengthValue
  paddingRight?: LengthValue
  paddingBottom?: LengthValue
  paddingLeft?: LengthValue
  paddingHorizontal?: LengthValue
  paddingVertical?: LengthValue
  flex?: number
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse'
  justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline'
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline'
  alignContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'stretch'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
  flexGrow?: number
  flexShrink?: number
  flexBasis?: LengthValue
  gap?: number
  rowGap?: number
  columnGap?: number
  aspectRatio?: number | `${number}/${number}`
  overflow?: 'visible' | 'hidden' | 'scroll'
  gridTemplateColumns?: Array<number | `${number}fr` | 'auto'> | string
  gridTemplateRows?: Array<number | `${number}fr` | 'auto'> | string
  gridColumnStart?: number
  gridColumnEnd?: number
  gridRowStart?: number
  gridRowEnd?: number
}

export interface VisualStyle {
  backgroundColor?: ColorValue
  backgroundGradient?: BackgroundGradient
  opacity?: number
  borderRadius?: number
  borderTopLeftRadius?: number
  borderTopRightRadius?: number
  borderBottomRightRadius?: number
  borderBottomLeftRadius?: number
  borderWidth?: number
  borderTopWidth?: number
  borderRightWidth?: number
  borderBottomWidth?: number
  borderLeftWidth?: number
  borderColor?: ColorValue
  borderTopColor?: ColorValue
  borderRightColor?: ColorValue
  borderBottomColor?: ColorValue
  borderLeftColor?: ColorValue
  /** The focus ring: drawn outside the border box, no layout effect. */
  outlineWidth?: number
  outlineColor?: ColorValue
  outlineOffset?: number
  transform?: Transform[]
  shadowColor?: ColorValue
  shadowOffset?: { width: number; height: number }
  shadowOpacity?: number
  shadowRadius?: number
  zIndex?: number
}

export interface TextStyle {
  color?: ColorValue
  fontSize?: number
  fontWeight?:
    | 100
    | 200
    | 300
    | 400
    | 500
    | 600
    | 700
    | 800
    | 900
    | 'normal'
    | 'bold'
    | 'medium'
    | 'semibold'
    | `${number}`
  fontFamily?: string
  fontStyle?: 'normal' | 'italic'
  lineHeight?: number
  letterSpacing?: number
  textAlign?: 'left' | 'center' | 'right' | 'justify' | 'auto'
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
}

export interface ImageStyle {
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center'
  tintColor?: ColorValue
}

export type ViewStyle = LayoutStyle & VisualStyle
export type Style = LayoutStyle & VisualStyle & TextStyle & ImageStyle

/** `style` accepts one object, an array (merged left-to-right) or falsy entries. */
export type StyleProp<T> = T | Array<StyleProp<T>> | null | undefined | false

export type PadButton =
  | 'cross'
  | 'circle'
  | 'square'
  | 'triangle'
  | 'l1'
  | 'r1'
  | 'l2'
  | 'r2'
  | 'l3'
  | 'r3'
  | 'options'
  | 'touchpad'
  | 'up'
  | 'down'
  | 'left'
  | 'right'

export type EventType =
  | 'focus'
  | 'blur'
  | 'press'
  | 'pressIn'
  | 'pressOut'
  | 'longPress'
  | 'back'
  | 'key'
  | 'scroll'
  | 'layout'
  | 'change'
  | 'submit'
  | 'load'
  | 'error'
  | 'animationEnd'
  | 'focusBoundary'

export interface NativeEvent<TPayload = unknown> {
  type: EventType
  /** The node the engine targeted. */
  target: NativeHandle
  /** The node whose handler is running (bubbling events only). */
  currentTarget: NativeHandle
  nativeEvent: TPayload
  defaultPrevented: boolean
  propagationStopped: boolean
  preventDefault(): void
  stopPropagation(): void
}

export interface KeyPayload {
  button: PadButton
  phase: 'down' | 'up'
}

export interface ScrollPayload {
  x: number
  y: number
  contentW: number
  contentH: number
  viewportW: number
  viewportH: number
}

export interface LayoutRect {
  x: number
  y: number
  width: number
  height: number
}

export interface FocusScopeSpec {
  /** Keep spatial navigation inside this subtree. */
  trap?: boolean
  /** Return focus to the last focused child when the scope regains focus. */
  restore?: boolean
}

/** The imperative handle every host component exposes through `ref`. */
export interface NativeHandle {
  readonly id: NodeId
  readonly type: HostType
  focus(): void
  /** Screen-space rect of the node after the next layout. */
  measure(): Promise<LayoutRect>
  /** `ScrollView` only. */
  scrollTo?(opts: { x?: number; y?: number; animated?: boolean }): void
}

export type HostType = 'View' | 'Text' | 'Image' | 'ScrollView' | 'TextInput' | 'Icon'

export interface FocusProps {
  focusable?: boolean
  autoFocus?: boolean
  disabled?: boolean
  focusScope?: FocusScopeSpec | boolean
  nextFocusUp?: RefObject<NativeHandle | null>
  nextFocusDown?: RefObject<NativeHandle | null>
  nextFocusLeft?: RefObject<NativeHandle | null>
  nextFocusRight?: RefObject<NativeHandle | null>
}

export interface EventProps {
  onFocus?: (e: NativeEvent) => void
  onBlur?: (e: NativeEvent) => void
  onPress?: (e: NativeEvent) => void
  onPressIn?: (e: NativeEvent) => void
  onPressOut?: (e: NativeEvent) => void
  onLongPress?: (e: NativeEvent) => void
  /** Circle. Bubbles; `preventDefault()` stops the router from going back. */
  onBack?: (e: NativeEvent) => void
  /** Any other button; bubbles. */
  onKey?: (e: NativeEvent<KeyPayload>) => void
  onLayout?: (e: NativeEvent<LayoutRect>) => void
  /** A `trap` scope refused to move focus in the requested direction. */
  onFocusBoundary?: (e: NativeEvent<{ direction: 'up' | 'down' | 'left' | 'right' }>) => void
}

export interface BaseProps extends FocusProps, EventProps {
  /** Tailwind class names (compiled at build time; `focus:` `active:` `disabled:` variants). */
  className?: string
  /** Applied while focused (merged over `style`). */
  styleFocus?: StyleProp<Style>
  /** Applied while Cross is held (merged over `style` and `styleFocus`). */
  styleActive?: StyleProp<Style>
  /** Applied while `disabled` (merged last). */
  styleDisabled?: StyleProp<Style>
  /** Animate changes of the effective style (state changes and prop updates). */
  transition?: TransitionSpec | boolean | number
  testID?: string
  ref?: RefObject<NativeHandle | null> | ((h: NativeHandle | null) => void)
}

export interface ViewProps extends BaseProps {
  style?: StyleProp<ViewStyle>
  children?: ReactNode
}

export type PressableState = { focused: boolean; pressed: boolean }

export interface PressableProps extends Omit<ViewProps, 'children' | 'style'> {
  children?: ReactNode | ((state: PressableState) => ReactNode)
  /** Resolved at render time from the state, like `children`. */
  style?: StyleProp<ViewStyle> | ((state: PressableState) => StyleProp<ViewStyle>)
}

export interface TextProps extends BaseProps {
  style?: StyleProp<ViewStyle & TextStyle>
  /** 0 (default) = unlimited; otherwise tail ellipsis. */
  numberOfLines?: number
  children?: ReactNode
}

export type ImageSource =
  | string
  | { uri: string }
  | { uri: string; width?: number; height?: number }

export interface ImageProps extends BaseProps {
  style?: StyleProp<ViewStyle & ImageStyle>
  source: ImageSource
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center'
  onLoad?: (e: NativeEvent<{ width: number; height: number }>) => void
  onError?: (e: NativeEvent<{ message: string }>) => void
}

export interface ScrollViewProps extends BaseProps {
  style?: StyleProp<ViewStyle>
  contentContainerStyle?: StyleProp<ViewStyle>
  horizontal?: boolean
  onScroll?: (e: NativeEvent<ScrollPayload>) => void
  children?: ReactNode
}

export type InputKind = 'text' | 'number' | 'url' | 'email' | 'password'

export interface TextInputProps extends BaseProps {
  style?: StyleProp<ViewStyle & TextStyle>
  value?: string
  defaultValue?: string
  placeholder?: string
  placeholderTextColor?: ColorValue
  /** ≤ 512. */
  maxLength?: number
  kind?: InputKind
  secureTextEntry?: boolean
  /** Title of the system keyboard dialog. */
  title?: string
  onChangeText?: (text: string) => void
  onSubmitEditing?: (e: NativeEvent<{ text: string }>) => void
}

export interface IconPathSpec {
  d: string
  fill?: ColorValue | 'currentColor' | 'none'
  stroke?: ColorValue | 'currentColor' | 'none'
  strokeWidth?: number
  lineCap?: 'butt' | 'round' | 'square'
  lineJoin?: 'miter' | 'round' | 'bevel'
}

export interface IconSpec {
  viewBox: [number, number] | [number, number, number, number]
  paths: IconPathSpec[]
}

/** The `lucide` package's `IconNode`: `[tag, attrs][]`. */
export type LucideIconNode = Array<[string, Record<string, string | number>]>

export interface IconProps extends BaseProps {
  style?: StyleProp<ViewStyle>
  icon: IconSpec | LucideIconNode
  /** Pixels, default 32. */
  size?: number
  color?: ColorValue
  strokeWidth?: number
}

export interface FocusScopeProps extends FocusScopeSpec {
  autoFocus?: boolean
  style?: StyleProp<ViewStyle>
  className?: string
  children?: ReactNode
}

export interface PortalProps {
  children?: ReactNode
}

export interface FlatListProps<T> extends Omit<ScrollViewProps, 'children'> {
  data: readonly T[]
  renderItem: (info: { item: T; index: number }) => ReactNode
  keyExtractor?: (item: T, index: number) => string
  initialNumToRender?: number
  windowSize?: number
  getItemLayout?: (data: readonly T[], index: number) => { length: number; offset: number }
  onEndReached?: () => void
  onEndReachedThreshold?: number
  ListHeaderComponent?: ReactNode | (() => ReactNode)
  ListFooterComponent?: ReactNode | (() => ReactNode)
  ListEmptyComponent?: ReactNode | (() => ReactNode)
  ItemSeparatorComponent?: () => ReactNode
  contentContainerStyle?: StyleProp<ViewStyle>
}

export interface AppInfo {
  platform: 'ps5' | 'host'
  titleId: string
  version: string
  uptimeMs: number
}
