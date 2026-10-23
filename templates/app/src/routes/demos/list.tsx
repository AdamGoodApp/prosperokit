import { FlatList, Image, Text, View } from '@prosperokit/react'
import { createFileRoute } from '@tanstack/react-router'
import { Item } from '@/components/ui/item'
import iconUrl from '../../../branding/icon.png'

export const Route = createFileRoute('/demos/list')({ component: ListDemo })

const ROW_HEIGHT = 80
const rows = Array.from({ length: 1000 }, (_, i) => ({
  id: String(i),
  title: `Row ${i + 1}`,
  description: `Windowed FlatList item ${i + 1} of 1000`,
}))

function ListDemo() {
  return (
    <View className="flex-1 gap-6">
      <Text className="text-2xl font-semibold text-ps-text">List</Text>
      <Text className="text-base text-ps-text-muted">
        1000 rows with images; only the rows near the viewport are mounted.
      </Text>
      <FlatList
        testID="demo-list"
        className="flex-1"
        data={rows}
        keyExtractor={(row) => row.id}
        getItemLayout={(_data, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index })}
        renderItem={({ item }) => (
          <Item
            className="h-[80px]"
            title={item.title}
            description={item.description}
            trailing={
              <Image source={iconUrl} resizeMode="cover" style={{ width: 48, height: 48 }} />
            }
          />
        )}
      />
    </View>
  )
}
