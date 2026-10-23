import { type ReactNode, useReducer, useRef, useState } from 'react'
import type { FlatListProps, NativeEvent, ScrollPayload } from '../types.js'
import { type FocusWithin, FocusWithinContext } from './refs.js'
import { ScrollView } from './ScrollView.js'
import { View } from './View.js'

const DEFAULT_ESTIMATE = 120

interface ScrollInfo {
  offset: number
  viewport: number
  content: number
}

function renderSlot(c: ReactNode | (() => ReactNode) | undefined): ReactNode {
  return typeof c === 'function' ? c() : c
}

/**
 * Windowed list over a `ScrollView`. Until the engine reports a scroll or layout only
 * `initialNumToRender` items exist; afterwards items outside the window collapse into
 * one spacer per gap.
 */
export function FlatList<T>({
  data,
  renderItem,
  keyExtractor = (_item: T, index: number) => String(index),
  horizontal = false,
  initialNumToRender = 12,
  windowSize = 21,
  getItemLayout,
  onEndReached,
  onEndReachedThreshold = 0.5,
  ListHeaderComponent,
  ListFooterComponent,
  ListEmptyComponent,
  ItemSeparatorComponent,
  contentContainerStyle,
  onScroll,
  onLayout,
  ref,
  ...rest
}: FlatListProps<T>) {
  const [scroll, setScroll] = useState<ScrollInfo | null>(null)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const sizes = useRef(new Map<string, number>())
  const headerSize = useRef(0)
  const focusedKey = useRef<string | null>(null)
  const needRefocus = useRef(false)
  const endReachedFor = useRef(-1)
  const contexts = useRef(new Map<string, FocusWithin>())

  const n = data.length
  const keys = data.map((item, i) => keyExtractor(item, i))

  let measuredSum = 0
  let measuredCount = 0
  for (const k of keys) {
    const s = sizes.current.get(k)
    if (s !== undefined) {
      measuredSum += s
      measuredCount++
    }
  }
  const estimate = measuredCount > 0 ? measuredSum / measuredCount : DEFAULT_ESTIMATE

  const starts: number[] = new Array(n + 1)
  starts[0] = 0
  for (let i = 0; i < n; i++) {
    const size = getItemLayout
      ? getItemLayout(data, i).length
      : (sizes.current.get(keys[i] as string) ?? estimate)
    starts[i + 1] = (starts[i] as number) + size
  }
  const total = starts[n] as number

  let first = 0
  let last = Math.min(n, initialNumToRender) - 1
  if (scroll) {
    const rel = scroll.offset - headerSize.current
    const lo = rel - ((windowSize - 1) / 2) * scroll.viewport
    const hi = rel + ((windowSize + 1) / 2) * scroll.viewport
    first = n
    last = -1
    for (let i = 0; i < n; i++) {
      if ((starts[i + 1] as number) > lo && (starts[i] as number) < hi) {
        if (first === n) first = i
        last = i
      }
    }
    if (first === n) {
      first = Math.max(0, n - 1)
      last = n - 1
    }
  }

  if (focusedKey.current !== null) {
    const idx = keys.indexOf(focusedKey.current)
    needRefocus.current = idx < first || idx > last
  }

  const contextFor = (key: string): FocusWithin => {
    let ctx = contexts.current.get(key)
    if (!ctx) {
      ctx = {
        report(focused) {
          if (focused) {
            focusedKey.current = key
            needRefocus.current = false
          }
        },
        claim(handle) {
          if (needRefocus.current && focusedKey.current === key) {
            needRefocus.current = false
            handle.focus()
          }
        },
      }
      contexts.current.set(key, ctx)
    }
    return ctx
  }

  const extent = (e: NativeEvent<{ width: number; height: number }>) =>
    horizontal ? e.nativeEvent.width : e.nativeEvent.height

  const handleScroll = (e: NativeEvent<ScrollPayload>) => {
    const p = e.nativeEvent
    const info: ScrollInfo = horizontal
      ? { offset: p.x, viewport: p.viewportW, content: p.contentW }
      : { offset: p.y, viewport: p.viewportH, content: p.contentH }
    setScroll((prev) =>
      prev &&
      prev.offset === info.offset &&
      prev.viewport === info.viewport &&
      prev.content === info.content
        ? prev
        : info,
    )
    if (
      onEndReached &&
      endReachedFor.current !== n &&
      info.content - (info.offset + info.viewport) <= onEndReachedThreshold * info.viewport
    ) {
      endReachedFor.current = n
      onEndReached()
    }
    onScroll?.(e)
  }

  const spacer = (size: number, key: string) =>
    size > 0 ? (
      <View
        key={key}
        style={horizontal ? { width: size, flexShrink: 0 } : { height: size, flexShrink: 0 }}
      />
    ) : null

  const children: ReactNode[] = []
  for (let i = first; i <= last; i++) {
    const key = keys[i] as string
    children.push(
      <FocusWithinContext.Provider key={key} value={contextFor(key)}>
        <View
          style={{ flexShrink: 0 }}
          onLayout={(e) => {
            const size = extent(e as NativeEvent<{ width: number; height: number }>)
            const prev = sizes.current.get(key)
            if (size > 0 && (prev === undefined || Math.abs(prev - size) > 0.5)) {
              sizes.current.set(key, size)
              bump()
            }
          }}
        >
          {renderItem({ item: data[i] as T, index: i })}
          {ItemSeparatorComponent && i < n - 1 ? ItemSeparatorComponent() : null}
        </View>
      </FocusWithinContext.Provider>,
    )
  }

  const header = renderSlot(ListHeaderComponent)
  const footer = renderSlot(ListFooterComponent)

  return (
    <ScrollView
      {...rest}
      ref={ref}
      horizontal={horizontal}
      contentContainerStyle={[
        { flexDirection: horizontal ? 'row' : 'column', flexShrink: 0 },
        contentContainerStyle,
      ]}
      onScroll={handleScroll}
      onLayout={(e) => {
        const r = e.nativeEvent
        setScroll(
          (prev) => prev ?? { offset: 0, viewport: horizontal ? r.width : r.height, content: 0 },
        )
        onLayout?.(e)
      }}
    >
      {header ? (
        <View
          key="__header"
          style={{ flexShrink: 0 }}
          onLayout={(e) => {
            headerSize.current = extent(e as NativeEvent<{ width: number; height: number }>)
          }}
        >
          {header}
        </View>
      ) : null}
      {n === 0 ? renderSlot(ListEmptyComponent) : null}
      {n > 0 ? spacer(starts[first] as number, '__before') : null}
      {children}
      {n > 0 ? spacer(total - (starts[last + 1] as number), '__after') : null}
      {footer ? (
        <View key="__footer" style={{ flexShrink: 0 }}>
          {footer}
        </View>
      ) : null}
    </ScrollView>
  )
}
