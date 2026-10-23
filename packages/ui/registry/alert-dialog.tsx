import type { ButtonProps } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  type DialogContentProps,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

/** A modal that must be answered: `back` cancels and the initial focus lands on `AlertDialogCancel`. */
export const AlertDialog = Dialog

export const AlertDialogTrigger = DialogTrigger

export function AlertDialogContent({
  testID = 'alert-dialog-overlay',
  ...props
}: Omit<DialogContentProps, 'autoFocus'>) {
  return <DialogContent testID={testID} autoFocus={false} {...props} />
}

export const AlertDialogHeader = DialogHeader

export const AlertDialogFooter = DialogFooter

export const AlertDialogTitle = DialogTitle

export const AlertDialogDescription = DialogDescription

/** Confirms: runs `onPress`, then closes. */
export function AlertDialogAction({
  variant = 'default',
  testID = 'alert-dialog-action',
  ...props
}: ButtonProps) {
  return <DialogClose variant={variant} testID={testID} {...props} />
}

/** Cancels: closes; takes the initial focus so a stray Cross press cannot confirm. */
export function AlertDialogCancel({
  variant = 'secondary',
  testID = 'alert-dialog-cancel',
  autoFocus = true,
  ...props
}: ButtonProps) {
  return <DialogClose variant={variant} testID={testID} autoFocus={autoFocus} {...props} />
}
