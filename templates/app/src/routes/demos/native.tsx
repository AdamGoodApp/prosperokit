import * as native from '@prosperokit/native/client'
import { ScrollView, Text, View } from '@prosperokit/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { listAppAssets } from '@/server/assets'

export const Route = createFileRoute('/demos/native')({ component: NativeDemo })

const REPO_URL = 'https://api.github.com/repos/MiladRTX/ps5-homebrew-starter'

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function NativeDemo() {
  const [output, setOutput] = useState('Press a button to call a native API.')
  const [typed, setTyped] = useState<string | null>(null)
  const blip = useRef<number | null>(null)

  const assets = useQuery({ queryKey: ['app-assets'], queryFn: () => listAppAssets() })

  // Runs `fn` and shows its result (or the NativeError) in the output card.
  const run = (label: string, fn: () => Promise<string | undefined>) => async () => {
    try {
      setOutput(`${label}: ${(await fn()) ?? 'ok'}`)
    } catch (error) {
      setOutput(`${label} failed: ${message(error)}`)
    }
  }

  const notify = run('Notification', async () => {
    await native.notify.show({ message: 'Hello from ProsperoKit' })
    return undefined
  })

  const ime = run('Keyboard', async () => {
    const text = await native.ime.open({ title: 'Type something', initial: typed ?? '' })
    if (text !== null) setTyped(text)
    return text === null ? 'cancelled' : `"${text}"`
  })

  const rumble = run('Vibration', async () => {
    await native.pad.setLightBar({ r: 0, g: 112, b: 209 })
    await native.pad.vibrate({ large: 160, small: 200, durationMs: 300 })
    return 'light bar blue, pad vibrated'
  })

  const sound = run('Sound', async () => {
    blip.current ??= (await native.audio.load({ uri: 'app0://www/sounds/blip.wav' })).id
    await native.audio.play({ id: blip.current })
    return 'played blip.wav'
  })

  const http = run('HTTP', async () => {
    const res = await fetch(REPO_URL, { headers: { Accept: 'application/vnd.github+json' } })
    const json = (await res.json()) as { stargazers_count?: number; message?: string }
    if (typeof json.stargazers_count !== 'number') {
      throw new Error(json.message ?? `HTTP ${res.status}`)
    }
    return `${json.stargazers_count} stars on MiladRTX/ps5-homebrew-starter`
  })

  const custom = run('Custom module', async () => {
    const { sum } = await native.custom.example.add({ a: 2, b: 3 })
    return `example.add(2, 3) = ${sum}`
  })

  return (
    <ScrollView
      testID="demo-native"
      className="flex-1"
      contentContainerStyle={{ gap: 24, paddingBottom: 48 }}
    >
      <Text className="text-2xl font-semibold text-ps-text">Native APIs</Text>
      <View className="flex-row flex-wrap gap-4">
        <Button testID="btn-notify" autoFocus onPress={notify}>
          Notify
        </Button>
        <Button testID="btn-ime" onPress={ime}>
          Keyboard
        </Button>
        <Button testID="btn-vibrate" onPress={rumble}>
          Vibrate + light bar
        </Button>
        <Button testID="btn-sound" onPress={sound}>
          Play sound
        </Button>
        <Button testID="btn-http" onPress={http}>
          HTTP request
        </Button>
        <Button testID="btn-custom" onPress={custom}>
          Custom module add(2, 3)
        </Button>
      </View>
      <Card className="gap-2 p-6">
        <Text className="text-sm text-ps-text-muted">Result</Text>
        <Text testID="native-output" className="text-base text-ps-text">
          {output}
        </Text>
        {typed === null ? null : (
          <Text testID="ime-text" className="text-base text-ps-text">
            Typed: {typed}
          </Text>
        )}
      </Card>
      <Card className="gap-2 p-6">
        <Text className="text-sm text-ps-text-muted">Server function: listAppAssets</Text>
        {assets.isPending ? <Text className="text-base text-ps-text">Loading…</Text> : null}
        {assets.isError ? (
          <Text className="text-base text-ps-danger">{message(assets.error)}</Text>
        ) : null}
        {assets.data?.length === 0 ? (
          <Text className="text-base text-ps-text">app0://www/assets is empty</Text>
        ) : null}
        {assets.data?.map((entry) => (
          <Text key={entry.name} className="text-base text-ps-text">
            {entry.name} ({entry.size} bytes)
          </Text>
        ))}
      </Card>
    </ScrollView>
  )
}
