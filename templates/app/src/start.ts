import { nativeServerFetch } from '@prosperokit/react'
import { createStart } from '@tanstack/react-start'

export const startInstance = createStart(() => ({
  serverFns: { fetch: nativeServerFetch },
}))
