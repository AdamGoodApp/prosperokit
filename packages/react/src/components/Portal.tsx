import type { ReactNode } from 'react'
import { overlayContainer, reconciler } from '../host-config.js'
import type { PortalProps } from '../types.js'

/** Renders children into the overlay layer (engine node 1): above the app, below nothing. */
export function Portal({ children }: PortalProps): ReactNode {
  return reconciler.createPortal(children, overlayContainer, null) as unknown as ReactNode
}
