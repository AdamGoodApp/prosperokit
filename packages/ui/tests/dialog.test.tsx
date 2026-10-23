import { renderNative, type TestNode } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

function scopeOf(nodes: TestNode[]): TestNode | undefined {
  return nodes.find((n) => n.props.focusScope !== undefined)
}

function Sample({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger testID="trigger">Open</DialogTrigger>
      <DialogContent>
        <DialogTitle>Title</DialogTitle>
        <DialogDescription>Body</DialogDescription>
        <DialogClose testID="close">Close</DialogClose>
      </DialogContent>
    </Dialog>
  )
}

describe('Dialog', () => {
  it('mounts its content on trigger press inside a trapping, restoring, auto-focused scope', () => {
    const onOpenChange = vi.fn()
    const r = renderNative(<Sample onOpenChange={onOpenChange} />)
    expect(r.find('dialog-overlay')).toBeNull()
    expect(scopeOf(r.findAll('View'))).toBeUndefined()

    const trigger = r.find('trigger') as TestNode
    r.fireEvent(trigger, 'press')

    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(r.find('dialog-overlay')).not.toBeNull()
    const scope = scopeOf(r.findAll('View')) as TestNode
    expect(scope.props.focusScope).toEqual({ trap: true, restore: true })
    expect(scope.props.autoFocus).toBe(true)
    expect(scope.text).toContain('Title')
    expect(scope.text).toContain('Body')
  })

  it('closes on back and returns focus to the trigger', () => {
    const onOpenChange = vi.fn()
    const r = renderNative(<Sample onOpenChange={onOpenChange} />)
    const trigger = r.find('trigger') as TestNode
    r.fireEvent(trigger, 'press')
    const scope = scopeOf(r.findAll('View')) as TestNode

    r.fireEvent(scope, 'back')

    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(r.find('dialog-overlay')).toBeNull()
    expect(r.ops).toContainEqual([8, trigger.id])
  })

  it('closes when DialogClose is pressed', () => {
    const r = renderNative(<Sample />)
    const trigger = r.find('trigger') as TestNode
    r.fireEvent(trigger, 'press')
    r.fireEvent(r.find('close') as TestNode, 'press')
    expect(r.find('dialog-overlay')).toBeNull()
    expect(r.ops).toContainEqual([8, trigger.id])
  })

  it('can be controlled', () => {
    const onOpenChange = vi.fn()
    const r = renderNative(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogClose testID="close">Close</DialogClose>
        </DialogContent>
      </Dialog>,
    )
    expect(r.find('dialog-overlay')).not.toBeNull()
    r.fireEvent(r.find('close') as TestNode, 'press')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    // still open: the parent did not change `open`
    expect(r.find('dialog-overlay')).not.toBeNull()
  })
})

describe('AlertDialog', () => {
  function Alert({ onConfirm }: { onConfirm: () => void }) {
    return (
      <AlertDialog>
        <AlertDialogTrigger testID="trigger">Delete</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Sure?</AlertDialogTitle>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onPress={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  it('focuses Cancel first, back cancels, Action confirms and closes', () => {
    const onConfirm = vi.fn()
    const r = renderNative(<Alert onConfirm={onConfirm} />)
    const trigger = r.find('trigger') as TestNode
    r.fireEvent(trigger, 'press')

    expect(r.find('alert-dialog-cancel')?.props.autoFocus).toBe(true)
    expect(r.find('alert-dialog-action')?.props.autoFocus).toBeFalsy()
    expect(scopeOf(r.findAll('View'))?.props.autoFocus).toBeFalsy()

    r.fireEvent(scopeOf(r.findAll('View')) as TestNode, 'back')
    expect(r.find('alert-dialog-overlay')).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(r.ops).toContainEqual([8, trigger.id])

    r.fireEvent(trigger, 'press')
    r.fireEvent(r.find('alert-dialog-action') as TestNode, 'press')
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(r.find('alert-dialog-overlay')).toBeNull()
  })
})

describe('Sheet', () => {
  it('slides in over 200 ms and closes on back', () => {
    const r = renderNative(
      <Sheet>
        <SheetTrigger testID="trigger">Open</SheetTrigger>
        <SheetContent side="right">
          <SheetTitle>Panel</SheetTitle>
        </SheetContent>
      </Sheet>,
    )
    r.fireEvent(r.find('trigger') as TestNode, 'press')
    const slide = r.ops.find((op) => op[0] === 9 && op[2] === 'translateX')
    expect(slide?.slice(3, 5)).toEqual([0, 200])

    r.fireEvent(scopeOf(r.findAll('View')) as TestNode, 'back')
    expect(r.find('sheet-overlay')).toBeNull()
  })
})
