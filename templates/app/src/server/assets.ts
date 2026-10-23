import { fs } from '@prosperokit/native/server'
import { createServerFn } from '@tanstack/react-start'

/** Lists the bundled web assets (`app0://www/assets`) from the server runtime. */
export const listAppAssets = createServerFn({ method: 'GET' }).handler(async () => {
  const entries = await fs.readDir({ path: 'app0://www/assets' })
  return entries
    .map((e) => ({ name: e.name, isDir: e.isDir, size: e.size }))
    .sort((a, b) => a.name.localeCompare(b.name))
})
