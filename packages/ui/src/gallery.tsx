import { coreEntries } from './gallery/core'
import { formsEntries } from './gallery/forms'
import { layoutEntries } from './gallery/layout'
import { menusEntries } from './gallery/menus'
import { overlaysEntries } from './gallery/overlays'
import type { GalleryEntry } from './gallery/types'

export type { GalleryEntry }

/** Every component with sample content; the template's `/gallery` route renders these. */
export const galleryEntries: GalleryEntry[] = [
  ...coreEntries,
  ...layoutEntries,
  ...formsEntries,
  ...menusEntries,
  ...overlaysEntries,
]
