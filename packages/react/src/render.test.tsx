import { act, renderNative } from '@prosperokit/testing'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { setClassResolver } from './classes.js'
import { lucideToIconSpec } from './icons.js'
import {
  Animated,
  FlatList,
  Icon,
  Image,
  type NativeHandle,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from './index.js'

describe('reconciler', () => {
  it('emits ops parent-first with classes from the resolver', () => {
    setClassResolver(() => [7])
    const r = renderNative(
      <View className="p-4">
        <Text>Hi</Text>
      </View>,
    )
    expect(r.ops).toEqual([
      [1, 2, 'view', { classes: [7] }],
      [1, 3, 'text', {}],
      [1, 4, 'rawtext', {}],
      [6, 4, 'Hi'],
      [3, 3, 4],
      [3, 2, 3],
      [3, 0, 2],
    ])
    setClassResolver(() => [])
  })

  it('sends one commit per React commit and diffs props on update', () => {
    const r = renderNative(<View testID="a" style={{ opacity: 0.5 }} />)
    expect(r.bridge.commits).toHaveLength(1)
    r.rerender(<View testID="a" style={[{ opacity: 0.5 }, { opacity: 1 }]} focusable />)
    expect(r.bridge.commits).toHaveLength(2)
    expect(r.bridge.commits[1]).toEqual([[2, 2, { style: { opacity: 1 }, focusable: true }]])
    r.rerender(<View testID="a" style={{ opacity: 1 }} focusable />)
    expect(r.bridge.commits).toHaveLength(2)
  })

  it('handles inserts, moves and removals', () => {
    const r = renderNative(
      <View>
        <View testID="a" />
        <View testID="b" />
      </View>,
    )
    r.bridge.commits.length = 0
    r.rerender(
      <View>
        <View testID="c" />
        <View testID="b" />
        <View testID="a" />
      </View>,
    )
    const ops = r.ops
    expect(ops.some((o) => o[0] === 1 && o[2] === 'view')).toBe(true)
    r.rerender(<View />)
    expect(r.ops.filter((o) => o[0] === 5)).toHaveLength(3)
  })

  it('merges resolver host props under explicit props', () => {
    const resolver = Object.assign(() => [1], { props: () => ({ numberOfLines: 2 }) })
    setClassResolver(resolver)
    const r = renderNative(
      <>
        <Text className="line-clamp-2">x</Text>
        <Text className="line-clamp-2" numberOfLines={5}>
          y
        </Text>
      </>,
    )
    const texts = r.findAll('Text')
    expect(texts[0]?.props.numberOfLines).toBe(2)
    expect(texts[1]?.props.numberOfLines).toBe(5)
    setClassResolver(() => [])
  })

  it('throws on unknown host types and raw text outside Text', () => {
    const Div = 'div' as any
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderNative(<Div />)).toThrow(
      'Unknown host component "div"; ProsperoKit renders View/Text/Image/ScrollView/TextInput/Icon',
    )
    expect(() => renderNative(<View>hello</View>)).toThrow(
      'Text strings must be rendered within a <Text> component',
    )
  })

  it('lays out a horizontal ScrollView content container as a row', () => {
    const r = renderNative(
      <>
        <ScrollView testID="h" horizontal contentContainerStyle={{ gap: 24 }}>
          <View testID="h-item" />
        </ScrollView>
        <ScrollView testID="v" contentContainerStyle={{ gap: 24 }}>
          <View testID="v-item" />
        </ScrollView>
        <ScrollView testID="o" horizontal contentContainerStyle={{ flexDirection: 'column' }}>
          <View testID="o-item" />
        </ScrollView>
      </>,
    )
    const container = (id: string) => r.find(id)?.parent?.props.style
    expect(container('h-item')).toEqual({ flexDirection: 'row', gap: 24 })
    expect(container('v-item')).toEqual({ gap: 24 })
    expect(container('o-item')).toEqual({ flexDirection: 'column' })
  })

  it('computes the events bitmask', () => {
    const r = renderNative(
      <>
        <View testID="v" onFocus={() => {}} onBack={() => {}} onLayout={() => {}} />
        <ScrollView testID="s" onScroll={() => {}} />
        <Image testID="i" source="a.png" onLoad={() => {}} onError={() => {}} />
        <TextInput testID="t" />
      </>,
    )
    expect(r.find('v')?.props.events).toBe(1 | 64 | 512)
    expect(r.find('s')?.props.events).toBe(256)
    expect(r.find('i')?.props.events).toBe(4096 | 8192)
    expect(r.find('i')?.props.src).toBe('a.png')
    expect(r.find('t')?.props.events).toBe(1024 | 2048 | 4)
  })
})

describe('events', () => {
  it('Pressable press runs onPress and pressed toggles', () => {
    const onPress = vi.fn()
    const seen: boolean[] = []
    const r = renderNative(
      <Pressable testID="p" onPress={onPress}>
        {({ pressed }) => {
          seen.push(pressed)
          return <Text>x</Text>
        }}
      </Pressable>,
    )
    const node = r.find('p')
    expect(node?.props.focusable).toBe(true)
    r.fireEvent(node as never, 'press')
    expect(onPress).toHaveBeenCalledTimes(1)
    r.fireEvent(node as never, 'pressIn')
    expect(seen.at(-1)).toBe(true)
    r.fireEvent(node as never, 'pressOut')
    expect(seen.at(-1)).toBe(false)
  })

  it('bubbles back and key until stopPropagation and runs the default back', () => {
    const calls: string[] = []
    const r = renderNative(
      <View
        testID="outer"
        onBack={() => {
          calls.push('outer')
        }}
      >
        <View
          testID="inner"
          onBack={(e) => {
            calls.push('inner')
            e.preventDefault()
          }}
        />
      </View>,
    )
    const back = vi.fn()
    ;(globalThis as Record<string, unknown>).__TSR_ROUTER__ = {
      history: { canGoBack: () => true, back },
    }
    r.fireEvent(r.find('inner') as never, 'back')
    expect(calls).toEqual(['inner', 'outer'])
    expect(back).not.toHaveBeenCalled()
    r.fireEvent(r.find('outer') as never, 'back')
    expect(back).toHaveBeenCalledTimes(1)
    ;(globalThis as Record<string, unknown>).__TSR_ROUTER__ = undefined
  })

  it('resolves nextFocus refs to node ids', () => {
    const target = createRef<NativeHandle>()
    const r = renderNative(
      <View>
        <View testID="a" focusable nextFocusDown={target} />
        <View testID="b" focusable ref={target} />
      </View>,
    )
    const a = r.find('a')
    const b = r.find('b')
    expect(r.ops).toContainEqual([2, a?.id, { nextFocusDown: b?.id }])
  })

  it('TextInput opens the IME on press and reports the result', () => {
    const onChangeText = vi.fn()
    const onSubmitEditing = vi.fn()
    const r = renderNative(
      <TextInput
        testID="in"
        placeholder="Name"
        title="Your name"
        defaultValue="ab"
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
      />,
    )
    expect(r.find('in')?.props.value).toBe('ab')
    r.fireEvent(r.find('in') as never, 'press')
    expect(r.bridge.calls).toHaveLength(1)
    const call = r.bridge.calls[0]
    expect(call?.module).toBe('ime')
    expect(call?.fn).toBe('open')
    expect(call?.args).toEqual({
      title: 'Your name',
      placeholder: 'Name',
      initial: 'ab',
      maxLength: 512,
      kind: 'text',
    })
    act(() => r.bridge.replyTo(call?.cbId as number, true, 'hello'))
    expect(onChangeText).toHaveBeenCalledWith('hello')
    expect(onSubmitEditing.mock.calls[0]?.[0].nativeEvent).toEqual({ text: 'hello' })
    expect(r.find('in')?.props.value).toBe('hello')
  })
})

describe('Icon', () => {
  it('converts lucide nodes to paths', () => {
    const spec = lucideToIconSpec([
      ['path', { d: 'M1 1' }],
      ['circle', { cx: 12, cy: 12, r: 5 }],
    ])
    expect(spec.viewBox).toEqual([24, 24])
    expect(spec.paths).toHaveLength(2)
    expect(spec.paths[0]).toMatchObject({
      d: 'M1 1',
      stroke: 'currentColor',
      strokeWidth: 2,
      lineCap: 'round',
    })
  })

  it('emits icon props', () => {
    const r = renderNative(<Icon testID="ic" icon={[['path', { d: 'M1 1' }]]} color={0xff0000ff} />)
    expect(r.find('ic')?.props).toMatchObject({ viewBox: [24, 24], size: 32, color: 0xff0000ff })
  })
})

describe('refs', () => {
  it('exposes a NativeHandle with measure and scrollTo', async () => {
    const ref = createRef<NativeHandle>()
    const r = renderNative(<ScrollView ref={ref} />)
    const id = ref.current?.id as number
    expect(id).toBe(2)
    ref.current?.scrollTo?.({ y: 40, animated: true })
    expect(r.bridge.commits.at(-1)).toEqual([[7, id, 0, 40, true]])
    const p = ref.current?.measure()
    const call = r.bridge.commits.at(-1)?.[0] as number[]
    expect(call.slice(0, 2)).toEqual([10, id])
    r.bridge.replyTo(call[2] as number, true, { x: 1, y: 2, width: 3, height: 4 })
    await expect(p).resolves.toEqual({ x: 1, y: 2, width: 3, height: 4 })
  })
})

describe('Animated', () => {
  it('timing emits an animate op per binding and resolves on animationEnd', () => {
    const v = new Animated.Value(0)
    const r = renderNative(<Animated.View testID="a" style={{ opacity: v }} />)
    expect(r.find('a')?.props.style).toEqual({ opacity: 0 })
    const done = vi.fn()
    Animated.timing(v, { toValue: 1, duration: 200, easing: 'ease-out' }).start(done)
    const op = r.bridge.commits.at(-1)?.[0] as unknown[]
    expect(op.slice(0, 6)).toEqual([9, r.find('a')?.id, 'opacity', 1, 200, 'ease-out'])
    expect(done).not.toHaveBeenCalled()
    r.fireEvent(r.find('a') as never, 'animationEnd', { callback: op[6] })
    expect(done).toHaveBeenCalledWith({ finished: true })
  })
})

describe('FlatList', () => {
  const data = Array.from({ length: 1000 }, (_, i) => i)
  const items = (r: ReturnType<typeof renderNative>) => r.findAll('Text').length

  it('renders initialNumToRender items at mount and the window after a scroll', () => {
    const r = renderNative(
      <FlatList
        testID="list"
        data={data}
        windowSize={5}
        renderItem={({ item }) => <Text>{`item ${item}`}</Text>}
        keyExtractor={(i) => String(i)}
      />,
    )
    expect(items(r)).toBe(12)
    const scroll = r.find('list')
    r.fireEvent(scroll as never, 'scroll', {
      x: 0,
      y: 5000,
      contentW: 1920,
      contentH: 120000,
      viewportW: 1920,
      viewportH: 1080,
    })
    // lo = 5000 - 2*1080 = 2840, hi = 5000 + 3*1080 = 8240; items of 120 px
    const texts = r.findAll('Text').map((t) => Number(t.text.replace('item ', '')))
    expect(Math.min(...texts)).toBe(23)
    expect(Math.max(...texts)).toBe(68)
    expect(texts).toHaveLength(46)
  })
})
