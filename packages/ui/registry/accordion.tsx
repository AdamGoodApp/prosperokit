import { Text, View, type ViewProps } from '@prosperokit/react'
import {
  rowIconColor,
  rowTextClass,
  UiIcon,
  useControllableState,
} from '@prosperokit/ui/primitives'
import { ChevronDown, ChevronUp } from 'lucide'
import { createContext, type ReactNode, useContext } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  type CollapsibleContentProps,
  CollapsibleTrigger,
  type CollapsibleTriggerProps,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface AccordionContextValue {
  value: readonly string[]
  disabled: boolean
  toggle: (itemValue: string) => void
}

const AccordionContext = createContext<AccordionContextValue | null>(null)
const ItemContext = createContext<string | null>(null)

interface AccordionBaseProps extends Omit<ViewProps, 'children'> {
  disabled?: boolean
  children?: ReactNode
}

export interface AccordionSingleProps extends AccordionBaseProps {
  type?: 'single'
  /** Whether the open item can be closed again. Default `false`. */
  collapsible?: boolean
  /** The open item's value (`''` = none). */
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

export interface AccordionMultipleProps extends AccordionBaseProps {
  type: 'multiple'
  value?: string[]
  defaultValue?: string[]
  onValueChange?: (value: string[]) => void
}

export type AccordionProps = AccordionSingleProps | AccordionMultipleProps

const EMPTY: string[] = []

function toList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value)) return value
  return value === '' ? EMPTY : [value]
}

/** Vertical stack of `AccordionItem`s; at most one open in `single` mode (default). */
export function Accordion(props: AccordionProps) {
  const { className, children, disabled = false, testID = 'accordion' } = props
  const multiple = props.type === 'multiple'
  const collapsible = props.type === 'multiple' ? true : (props.collapsible ?? false)
  const [value, setValue] = useControllableState<string[]>({
    value: toList(props.value),
    defaultValue: toList(props.defaultValue) ?? EMPTY,
    onChange: (next) => {
      if (props.type === 'multiple') props.onValueChange?.(next)
      else props.onValueChange?.(next[0] ?? '')
    },
  })
  const toggle = (itemValue: string) => {
    const isOpen = value.includes(itemValue)
    if (multiple) {
      setValue(isOpen ? value.filter((v) => v !== itemValue) : [...value, itemValue])
    } else if (!isOpen) {
      setValue([itemValue])
    } else if (collapsible) {
      setValue([])
    }
  }
  return (
    <AccordionContext.Provider value={{ value, disabled, toggle }}>
      <View testID={testID} className={cn('w-full', className)}>
        {children}
      </View>
    </AccordionContext.Provider>
  )
}

export interface AccordionItemProps extends Omit<ViewProps, 'children'> {
  value: string
  disabled?: boolean
  children?: ReactNode
}

export function AccordionItem({
  value,
  disabled,
  className,
  children,
  testID,
  ...props
}: AccordionItemProps) {
  const ctx = useContext(AccordionContext)
  if (!ctx) throw new Error('AccordionItem must be rendered inside <Accordion>')
  return (
    <ItemContext.Provider value={value}>
      <Collapsible
        testID={testID ?? `accordion-item-${value}`}
        open={ctx.value.includes(value)}
        onOpenChange={() => ctx.toggle(value)}
        disabled={disabled ?? ctx.disabled}
        className={cn('border-b border-ps-border', className)}
        {...props}
      >
        {children}
      </Collapsible>
    </ItemContext.Provider>
  )
}

export function AccordionTrigger({
  className,
  children,
  testID,
  ...props
}: CollapsibleTriggerProps) {
  const value = useContext(ItemContext)
  return (
    <CollapsibleTrigger
      testID={testID ?? `accordion-trigger-${value ?? ''}`}
      className={cn('min-h-[72px] justify-between', className)}
      {...props}
    >
      {(state) => {
        const label = typeof children === 'function' ? children(state) : children
        return (
          <>
            <View className="flex-1 flex-row items-center">
              {typeof label === 'string' ? (
                <Text className={cn('text-base font-medium', rowTextClass(state.focused))}>
                  {label}
                </Text>
              ) : (
                label
              )}
            </View>
            <UiIcon
              icon={state.open ? ChevronUp : ChevronDown}
              size={32}
              color={rowIconColor(state.focused, 'muted')}
            />
          </>
        )
      }}
    </CollapsibleTrigger>
  )
}

export function AccordionContent({
  className,
  children,
  testID,
  ...props
}: CollapsibleContentProps) {
  const value = useContext(ItemContext)
  return (
    <CollapsibleContent
      testID={testID ?? `accordion-content-${value ?? ''}`}
      className={cn('px-6 pb-5', className)}
      {...props}
    >
      {children}
    </CollapsibleContent>
  )
}
