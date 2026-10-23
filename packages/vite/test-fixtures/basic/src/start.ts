import { createStart } from '@tanstack/react-start'

export const startInstance = createStart(() => ({
  serverFns: {
    fetch: (url: RequestInfo | URL, init?: RequestInit) => fetch(url, init),
  },
}))
