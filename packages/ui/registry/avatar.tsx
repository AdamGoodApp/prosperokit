import {
  Image,
  type ImageProps,
  type ImageSource,
  Text,
  View,
  type ViewProps,
} from '@prosperokit/react'
import { cva, type VariantProps } from 'class-variance-authority'
import { createContext, type ReactNode, useContext, useState } from 'react'
import { cn } from '@/lib/utils'

const avatarVariants = cva(
  'items-center justify-center overflow-hidden rounded-full bg-ps-surface-strong',
  {
    variants: {
      size: {
        sm: 'h-[48px] w-[48px]',
        default: 'h-[64px] w-[64px]',
        lg: 'h-[96px] w-[96px]',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

const fallbackText = cva('font-semibold text-ps-text', {
  variants: { size: { sm: 'text-sm', default: 'text-base', lg: 'text-xl' } },
  defaultVariants: { size: 'default' },
})

type ImageStatus = 'idle' | 'loaded' | 'error'

interface AvatarContextValue {
  size: NonNullable<VariantProps<typeof avatarVariants>['size']>
  status: ImageStatus
  setStatus: (status: ImageStatus) => void
}

const AvatarContext = createContext<AvatarContextValue | null>(null)

function useAvatar(): AvatarContextValue {
  const ctx = useContext(AvatarContext)
  if (!ctx) throw new Error('Avatar parts must be rendered inside <Avatar>')
  return ctx
}

export interface AvatarProps
  extends Omit<ViewProps, 'children'>,
    VariantProps<typeof avatarVariants> {
  children?: ReactNode
}

export function Avatar({
  size = 'default',
  className,
  children,
  testID = 'avatar',
  ...props
}: AvatarProps) {
  const [status, setStatus] = useState<ImageStatus>('idle')
  return (
    <AvatarContext.Provider value={{ size: size ?? 'default', status, setStatus }}>
      <View testID={testID} className={cn(avatarVariants({ size }), className)} {...props}>
        {children}
      </View>
    </AvatarContext.Provider>
  )
}

export interface AvatarImageProps extends Omit<ImageProps, 'source'> {
  /** Without a source (or when loading fails) the `AvatarFallback` shows instead. */
  source?: ImageSource
}

export function AvatarImage({
  source,
  className,
  testID = 'avatar-image',
  onLoad,
  onError,
  ...props
}: AvatarImageProps) {
  const { status, setStatus } = useAvatar()
  if (!source || status === 'error') return null
  return (
    <Image
      testID={testID}
      source={source}
      resizeMode="cover"
      className={cn('absolute left-0 top-0 h-full w-full', className)}
      onLoad={(e) => {
        setStatus('loaded')
        onLoad?.(e)
      }}
      onError={(e) => {
        setStatus('error')
        onError?.(e)
      }}
      {...props}
    />
  )
}

export interface AvatarFallbackProps extends Omit<ViewProps, 'children'> {
  /** Initials (a string is wrapped in a `Text`). */
  children?: ReactNode
}

/** Shown until the image has loaded, and permanently when there is no image or it failed. */
export function AvatarFallback({
  className,
  children,
  testID = 'avatar-fallback',
  ...props
}: AvatarFallbackProps) {
  const { size, status } = useAvatar()
  if (status === 'loaded') return null
  return (
    <View testID={testID} className={cn('items-center justify-center', className)} {...props}>
      {typeof children === 'string' ? (
        <Text className={fallbackText({ size })}>{children}</Text>
      ) : (
        children
      )}
    </View>
  )
}
