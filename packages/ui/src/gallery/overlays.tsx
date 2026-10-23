import { Text, View } from '@prosperokit/react'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { FocusCard, FocusCardContent, FocusCardTrigger } from '@/components/ui/focus-card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Toaster, useToast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { GalleryEntry } from './types'

const section = 'Overlays'

function DialogSample() {
  return (
    <Dialog>
      <DialogTrigger>Edit profile</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>Change how your name appears to friends.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose>Cancel</DialogClose>
          <DialogClose variant="default">Save</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AlertDialogSample() {
  return (
    <AlertDialog>
      <AlertDialogTrigger variant="destructive">Delete save data</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete save data?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DrawerSample() {
  return (
    <Drawer>
      <DrawerTrigger>Open drawer</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Game options</DrawerTitle>
          <DrawerDescription>Choose what to do with this game.</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DrawerClose>Close</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function SheetSample() {
  return (
    <Sheet>
      <SheetTrigger>Open sheet</SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription>Recent activity from your friends.</SheetDescription>
        </SheetHeader>
        <SheetFooter>
          <SheetClose>Close</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function PopoverSample() {
  return (
    <Popover>
      <PopoverTrigger>Show details</PopoverTrigger>
      <PopoverContent>
        <Text className="text-base font-semibold text-ps-text">Storage</Text>
        <Text className="text-base text-ps-text-muted">412 GB free of 825 GB</Text>
      </PopoverContent>
    </Popover>
  )
}

function TooltipSample() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>Focus me</TooltipTrigger>
        <TooltipContent>Shown after a short delay while focused</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function FocusCardSample() {
  return (
    <FocusCard>
      <FocusCardTrigger className="h-[120px] w-[264px] items-center justify-center bg-ps-surface">
        <Text className="text-base text-ps-text">Astro Bot</Text>
      </FocusCardTrigger>
      <FocusCardContent>
        <Text className="text-base font-semibold text-ps-text">Astro Bot</Text>
        <Text className="text-base text-ps-text-muted">Last played yesterday · 14 h</Text>
      </FocusCardContent>
    </FocusCard>
  )
}

function ToastSample() {
  const { toast } = useToast()
  return (
    <View className="flex-row gap-4">
      <Toaster />
      <Button variant="secondary" onPress={() => toast('Download complete')}>
        Show toast
      </Button>
      <Button
        variant="secondary"
        onPress={() =>
          toast({ title: 'Connection lost', description: 'Retrying…', variant: 'destructive' })
        }
      >
        Show error toast
      </Button>
    </View>
  )
}

function CalendarSample() {
  const [selected, setSelected] = useState<Date | undefined>(new Date())
  return <Calendar selected={selected} onSelect={setSelected} />
}

function DatePickerSample() {
  const [date, setDate] = useState<Date | undefined>(undefined)
  return <DatePicker value={date} onValueChange={setDate} />
}

export const overlaysEntries: GalleryEntry[] = [
  { name: 'dialog', section, element: <DialogSample /> },
  { name: 'alert-dialog', section, element: <AlertDialogSample /> },
  { name: 'drawer', section, element: <DrawerSample /> },
  { name: 'sheet', section, element: <SheetSample /> },
  { name: 'popover', section, element: <PopoverSample /> },
  { name: 'tooltip', section, element: <TooltipSample /> },
  { name: 'focus-card', section, element: <FocusCardSample /> },
  { name: 'toast', section, element: <ToastSample /> },
  { name: 'calendar', section, element: <CalendarSample /> },
  { name: 'date-picker', section, element: <DatePickerSample /> },
]
