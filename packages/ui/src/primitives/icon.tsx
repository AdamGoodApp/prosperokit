import type { IconProps } from '@prosperokit/react'
import { Icon } from '@prosperokit/react'
import type { IconNode } from 'lucide'

export type { IconNode }

export interface UiIconProps extends Omit<IconProps, 'icon'> {
  /** A `lucide` icon node, e.g. `import { Check } from 'lucide'`. */
  icon: IconNode
}

/** `Icon` over a `lucide` node (`lucide`'s attribute type allows `undefined`; the engine's does not). */
export function UiIcon({ icon, ...props }: UiIconProps) {
  return <Icon icon={icon as IconProps['icon']} {...props} />
}
