import { createServerEntry, createStartHandler } from '@tanstack/react-start/server'

// Server functions are routed before this callback; there is no SSR.
export default createServerEntry({
  fetch: createStartHandler(() => new Response('Not found', { status: 404 })),
})
