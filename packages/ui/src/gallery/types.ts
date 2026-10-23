import type { ReactNode } from 'react'

export interface GalleryEntry {
  /** The registry component name (`registry.json` `name`), e.g. `select`. */
  name: string
  /** Section heading the entry is grouped under, e.g. `Overlays`. */
  section: string
  /** Sample content exercising the component. */
  element: ReactNode
}
