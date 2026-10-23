import type { LayoutRect, NativeHandle, ViewStyle } from '@prosperokit/react'
import { type RefObject, useEffect, useState } from 'react'
import { sizes } from '../theme'

/** Screen-space rect of `ref` measured when `active` turns true (`null` until the reply arrives). */
export function useAnchorRect(
  ref: RefObject<NativeHandle | null>,
  active: boolean,
): LayoutRect | null {
  const [rect, setRect] = useState<LayoutRect | null>(null)
  useEffect(() => {
    if (!active) {
      setRect(null)
      return
    }
    let cancelled = false
    ref.current
      ?.measure()
      .then((r) => {
        if (!cancelled) setRect(r)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ref, active])
  return rect
}

export type Placement = 'bottom' | 'top' | 'right' | 'auto'

export interface AnchorStyleOptions {
  placement?: Placement
  /** Panel width in px (also its minimum). Default: the anchor's width. */
  width?: number
  /** Gap between anchor and panel in px. Default 8. */
  gap?: number
}

/**
 * Absolute position of a panel next to an anchor rect. Until the anchor has been
 * measured the panel is laid out invisibly (opacity 0) so it still mounts and can be focused.
 */
export function anchorStyle(rect: LayoutRect | null, options: AnchorStyleOptions = {}): ViewStyle {
  const { placement = 'bottom', gap = 8 } = options
  if (!rect) return { position: 'absolute', left: 0, top: 0, opacity: 0, width: options.width }
  const width = options.width ?? rect.width
  const left = Math.max(0, Math.min(rect.x, sizes.screenWidth - width))
  const resolved: Exclude<Placement, 'auto'> =
    placement === 'auto' ? (rect.y > sizes.screenHeight / 2 ? 'top' : 'bottom') : placement
  if (resolved === 'right') {
    return { position: 'absolute', left: rect.x + rect.width + gap, top: rect.y, width }
  }
  if (resolved === 'top') {
    return {
      position: 'absolute',
      left,
      bottom: sizes.screenHeight - rect.y + gap,
      width,
    }
  }
  return { position: 'absolute', left, top: rect.y + rect.height + gap, width }
}
