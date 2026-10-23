import { fs } from '@prosperokit/native/server'
import { createServerFn } from '@tanstack/react-start'
import { defaultSettings, SETTINGS_PATH, type Settings, settingsSchema } from '../lib/settings'

export const readSettings = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Settings> => {
    if (!(await fs.exists({ path: SETTINGS_PATH }))) return defaultSettings
    const text = await fs.readFile({ path: SETTINGS_PATH, encoding: 'utf8' })
    const parsed = settingsSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : defaultSettings
  },
)

export const writeSettings = createServerFn({ method: 'POST' })
  .validator(settingsSchema)
  .handler(async ({ data }): Promise<Settings> => {
    await fs.writeFile({ path: SETTINGS_PATH, data: JSON.stringify(data, null, 2) })
    return data
  })
