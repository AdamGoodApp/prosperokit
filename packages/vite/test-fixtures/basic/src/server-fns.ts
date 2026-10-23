import { createServerFn } from '@tanstack/react-start'

export const greet = createServerFn({ method: 'GET' }).handler(async () => {
  return { message: 'hello from the server' }
})
