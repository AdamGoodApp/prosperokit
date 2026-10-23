import { FlatList, FocusScope, Text, View } from '@prosperokit/react'
import { type GalleryEntry, galleryEntries } from '@prosperokit/ui/gallery'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/gallery')({ component: Gallery })

function Gallery() {
  return (
    <FocusScope autoFocus className="flex-1">
      <FlatList<GalleryEntry>
        testID="gallery-list"
        className="flex-1"
        data={galleryEntries}
        keyExtractor={(entry) => entry.name}
        ItemSeparatorComponent={() => <View className="h-8" />}
        renderItem={({ item }) => (
          <View testID={`gallery-${item.name}`} className="gap-3">
            <Text className="text-sm font-semibold uppercase text-ps-text-muted">
              {item.section} / {item.name}
            </Text>
            {item.element}
          </View>
        )}
      />
    </FocusScope>
  )
}
