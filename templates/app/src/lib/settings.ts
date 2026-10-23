import { z } from 'zod'

export const ACCENTS = ['blue', 'green', 'orange', 'pink'] as const

export const settingsSchema = z.object({
  uiSounds: z.boolean(),
  accent: z.enum(ACCENTS),
  volume: z.number().min(0).max(100),
})

export type Settings = z.infer<typeof settingsSchema>

export const defaultSettings: Settings = { uiSounds: true, accent: 'blue', volume: 80 }

export const SETTINGS_PATH = 'data://settings.json'
