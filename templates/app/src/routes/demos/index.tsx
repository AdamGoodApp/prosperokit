import { Text, View } from '@prosperokit/react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Item, ItemGroup } from '@/components/ui/item'

export const Route = createFileRoute('/demos/')({ component: Demos })

function Demos() {
  const navigate = useNavigate()
  return (
    <View className="flex-1 gap-6">
      <Text className="text-2xl font-semibold text-ps-text">Demos</Text>
      <ItemGroup>
        <Item
          testID="demo-link-native"
          autoFocus
          title="Native APIs"
          description="Notifications, keyboard, vibration, sound, HTTP, server functions, custom module"
          onPress={() => navigate({ to: '/demos/native' })}
        />
        <Item
          testID="demo-link-list"
          title="List"
          description="A windowed FlatList with 1000 rows and images"
          onPress={() => navigate({ to: '/demos/list' })}
        />
      </ItemGroup>
    </View>
  )
}
