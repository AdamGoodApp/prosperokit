import { createServerEntry, createStartHandler } from '@tanstack/react-start/server'

export default createServerEntry({
  fetch: createStartHandler(() => new Response('Not found', { status: 404 })),
})
