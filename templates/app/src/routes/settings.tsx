import { Text } from '@prosperokit/react'
import { SettingsList } from '@prosperokit/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ACCENTS, defaultSettings, type Settings } from '@/lib/settings'
import { readSettings, writeSettings } from '@/server/settings'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

const SETTINGS_KEY = ['settings'] as const
const VOLUME_STEP = 5

function SettingsPage() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => readSettings() })
  // Defaults until the server function answers (or if it fails; see the status line).
  const settings = query.data ?? defaultSettings

  const mutation = useMutation({
    mutationFn: (next: Settings) => writeSettings({ data: next }),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_KEY })
      const previous = queryClient.getQueryData<Settings>(SETTINGS_KEY)
      queryClient.setQueryData(SETTINGS_KEY, next)
      return { previous }
    },
    onError: (_error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(SETTINGS_KEY, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
  })

  const update = (patch: Partial<Settings>) => mutation.mutate({ ...settings, ...patch })
  const [accentOpen, setAccentOpen] = useState(false)

  // Each row is the focus target (the white PS5 highlight) and operates its
  // control: cross toggles / opens, left and right adjust. The controls are
  // display-only (`focusable={false}`), so focus never hides inside a row.
  return (
    <SettingsList
      items={[
        {
          key: 'ui-sounds',
          title: 'UI sounds',
          description: 'Play a sound when moving focus',
          autoFocus: true,
          onPress: () => update({ uiSounds: !settings.uiSounds }),
          trailing: (
            <Switch
              focusable={false}
              checked={settings.uiSounds}
              onCheckedChange={(uiSounds) => update({ uiSounds })}
            />
          ),
        },
        {
          key: 'theme-accent',
          title: 'Theme accent',
          description: 'Highlight colour',
          onPress: () => setAccentOpen(true),
          trailing: (
            <Select
              value={settings.accent}
              open={accentOpen}
              onOpenChange={setAccentOpen}
              onValueChange={(accent) => update({ accent: accent as Settings['accent'] })}
            >
              <SelectTrigger testID="settings-accent" focusable={false}>
                <SelectValue placeholder="Accent" />
              </SelectTrigger>
              <SelectContent>
                {ACCENTS.map((accent) => (
                  <SelectItem key={accent} value={accent}>
                    {accent}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ),
        },
        {
          key: 'volume',
          title: 'Volume',
          description: `${settings.volume}%`,
          onKey: (e) => {
            const { button, phase } = e.nativeEvent
            if (phase !== 'down' || (button !== 'left' && button !== 'right')) return
            e.stopPropagation()
            const delta = button === 'right' ? VOLUME_STEP : -VOLUME_STEP
            const volume = Math.min(100, Math.max(0, settings.volume + delta))
            if (volume !== settings.volume) update({ volume })
          },
          trailing: (
            <Slider
              className="w-[480px]"
              focusable={false}
              hideValue
              value={settings.volume}
              min={0}
              max={100}
              step={VOLUME_STEP}
            />
          ),
        },
      ]}
      footer={
        <Text testID="settings-status" className="px-6 pt-4 text-sm text-ps-text-muted">
          {query.error
            ? `Could not load settings: ${query.error.message}`
            : mutation.error
              ? `Could not save settings: ${mutation.error.message}`
              : mutation.isPending
                ? 'Saving…'
                : 'Saved to data://settings.json'}
        </Text>
      }
    />
  )
}
