import { View, type ViewProps } from '@prosperokit/react'
import { createFormHook, createFormHookContexts } from '@tanstack/react-form'
import type { ReactNode } from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Checkbox, type CheckboxProps } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input, type InputProps } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider, type SliderProps } from '@/components/ui/slider'
import { Switch, type SwitchProps } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts()

interface FieldChrome {
  label?: string
  description?: ReactNode
}

function Chrome({
  label,
  description,
  errors,
  children,
  orientation,
}: FieldChrome & {
  errors: ReadonlyArray<unknown>
  children: ReactNode
  orientation?: 'vertical' | 'horizontal'
}) {
  return (
    <Field orientation={orientation}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      {children}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError errors={errors} />
    </Field>
  )
}

export function TextField({
  label,
  description,
  ...props
}: FieldChrome & Omit<InputProps, 'value' | 'onChangeText'>) {
  const field = useFieldContext<string>()
  return (
    <Chrome label={label} description={description} errors={field.state.meta.errors}>
      <Input
        testID={`field-${field.name}`}
        value={field.state.value ?? ''}
        onChangeText={field.handleChange}
        onBlur={() => field.handleBlur()}
        {...props}
      />
    </Chrome>
  )
}

export interface SelectFieldProps extends FieldChrome {
  options: ReadonlyArray<{ value: string; label: string }>
  placeholder?: string
  disabled?: boolean
}

export function SelectField({
  label,
  description,
  options,
  placeholder,
  disabled,
}: SelectFieldProps) {
  const field = useFieldContext<string>()
  return (
    <Chrome label={label} description={description} errors={field.state.meta.errors}>
      <Select value={field.state.value} onValueChange={field.handleChange} disabled={disabled}>
        <SelectTrigger testID={`field-${field.name}`}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Chrome>
  )
}

export function SwitchField({
  label,
  description,
  ...props
}: FieldChrome & Omit<SwitchProps, 'checked' | 'onCheckedChange' | 'label'>) {
  const field = useFieldContext<boolean>()
  return (
    <Chrome label={undefined} description={description} errors={field.state.meta.errors}>
      <Switch
        testID={`field-${field.name}`}
        label={label}
        checked={!!field.state.value}
        onCheckedChange={field.handleChange}
        {...props}
      />
    </Chrome>
  )
}

export function CheckboxField({
  label,
  description,
  ...props
}: FieldChrome & Omit<CheckboxProps, 'checked' | 'onCheckedChange' | 'label'>) {
  const field = useFieldContext<boolean>()
  return (
    <Chrome label={undefined} description={description} errors={field.state.meta.errors}>
      <Checkbox
        testID={`field-${field.name}`}
        label={label}
        checked={!!field.state.value}
        onCheckedChange={field.handleChange}
        {...props}
      />
    </Chrome>
  )
}

export function SliderField({
  label,
  description,
  ...props
}: FieldChrome & Omit<SliderProps, 'value' | 'onValueChange'>) {
  const field = useFieldContext<number>()
  return (
    <Chrome label={label} description={description} errors={field.state.meta.errors}>
      <Slider
        testID={`field-${field.name}`}
        value={field.state.value}
        onValueChange={field.handleChange}
        {...props}
      />
    </Chrome>
  )
}

/** Layout wrapper for a form's fields (there is no DOM `<form>`; submit through `SubmitButton`). */
export function Form({ className, children, ...props }: ViewProps) {
  return (
    <View className={cn('gap-8', className)} {...props}>
      {children}
    </View>
  )
}

/** Disabled while submitting or while the form is invalid; pressing it submits the form. */
export function SubmitButton({
  label = 'Submit',
  testID = 'form-submit',
  ...props
}: Omit<ButtonProps, 'children' | 'onPress'> & { label?: string }) {
  const form = useFormContext()
  return (
    <form.Subscribe selector={(s) => ({ submitting: s.isSubmitting, canSubmit: s.canSubmit })}>
      {({ submitting, canSubmit }) => (
        <Button
          testID={testID}
          disabled={submitting || !canSubmit}
          onPress={() => {
            void form.handleSubmit()
          }}
          {...props}
        >
          {label}
        </Button>
      )}
    </form.Subscribe>
  )
}

export const { useAppForm, withForm, withFieldGroup } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, SelectField, SwitchField, CheckboxField, SliderField },
  formComponents: { SubmitButton, Form },
})
