import { View } from '@prosperokit/react'
import type { ReactNode } from 'react'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  SheetContent,
  type SheetContentProps,
  SheetFooter,
  SheetHeader,
} from '@/components/ui/sheet'

/** A bottom sheet (60 % of the screen height) that slides up in 200 ms; `back` closes. */
export const Drawer = Dialog

export const DrawerTrigger = DialogTrigger

export const DrawerClose = DialogClose

export const DrawerHeader = SheetHeader

export const DrawerFooter = SheetFooter

export const DrawerTitle = DialogTitle

export const DrawerDescription = DialogDescription

export interface DrawerContentProps extends Omit<SheetContentProps, 'side'> {
  children?: ReactNode
}

export function DrawerContent({
  testID = 'drawer-overlay',
  className,
  children,
  ...props
}: DrawerContentProps) {
  return (
    <SheetContent side="bottom" testID={testID} className={className} {...props}>
      <View className="h-[6px] w-[96px] self-center rounded-full bg-ps-surface-strong" />
      {children}
    </SheetContent>
  )
}
