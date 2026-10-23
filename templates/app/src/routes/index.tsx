import * as native from '@prosperokit/native'
import { Text, View } from '@prosperokit/react'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'

export const Route = createFileRoute('/')({ component: Welcome })

const DOCS_URL = 'https://github.com/AdamGoodApp/prosperokit/tree/main/docs'

function Code({ children }: { children: ReactNode }) {
  return <Text className="font-mono text-sm text-ps-accent-strong">{children}</Text>
}

function Line({ children }: { children: ReactNode }) {
  return <Text className="text-sm text-ps-text-muted">{children}</Text>
}

function WelcomeCard({
  testID,
  title,
  autoFocus,
  children,
}: {
  testID: string
  title: string
  autoFocus?: boolean
  children: ReactNode
}) {
  return (
    <Card focusable autoFocus={autoFocus} testID={testID} className="flex-1 gap-4 p-8">
      <Text className="text-xl font-semibold text-ps-text">{title}</Text>
      {children}
    </Card>
  )
}

function Welcome() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    native.app.info().then((info) => {
      if (live) setVersion(info.version)
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <View className="flex-1 gap-8">
      <View className="gap-2">
        <Text testID="welcome-title" className="text-4xl font-bold text-ps-text">
          ProsperoKit
        </Text>
        <Text testID="welcome-version" className="text-base text-ps-text-muted">
          {version ? `Version ${version}` : 'Native PS5 apps with React'}
        </Text>
      </View>
      <View className="flex-row gap-6">
        <WelcomeCard testID="card-quick-start" title="Quick start" autoFocus>
          <Code>prosperokit dev</Code>
          <Code>prosperokit dev --ps5 {'<ip>'}</Code>
          <Code>prosperokit build --target ps5</Code>
          <Code>prosperokit deploy</Code>
        </WelcomeCard>
        <WelcomeCard testID="card-make-it-yours" title="Make it yours">
          <Line>
            Edit <Code>src/routes/index.tsx</Code>
          </Line>
          <Line>
            Add components: <Code>prosperokit add button</Code>
          </Line>
          <Line>
            App name and title ID: <Code>prosperokit.config.ts</Code>
          </Line>
          <Line>
            Icon and background: <Code>branding/</Code>
          </Line>
        </WelcomeCard>
        <WelcomeCard testID="card-learn" title="Learn">
          <Line>Components: open Gallery (/gallery)</Line>
          <Line>Native APIs and lists: open Demos (/demos)</Line>
          <Line>Docs: {DOCS_URL}</Line>
        </WelcomeCard>
      </View>
    </View>
  )
}
