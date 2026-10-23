import { Text } from '@prosperokit/react'
import { UiIcon } from '@prosperokit/ui/primitives'
import { colors } from '@prosperokit/ui/theme'
import { Search } from 'lucide'
import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { useAppForm } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { InputOTP } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { GalleryEntry } from './types'

function OtpSample() {
  const [code, setCode] = useState('')
  return <InputOTP length={6} value={code} onChange={setCode} />
}

function SwitchSample() {
  const [on, setOn] = useState(true)
  return <Switch checked={on} onCheckedChange={setOn} label="Network access" />
}

function SliderSample() {
  const [v, setV] = useState(40)
  return <Slider value={v} onValueChange={setV} step={5} />
}

function FormSample() {
  const form = useAppForm({
    defaultValues: { name: '' },
    onSubmit: () => {},
  })
  return (
    <form.AppForm>
      <form.Form>
        <form.AppField
          name="name"
          validators={{
            onChange: ({ value }) => (value.length < 3 ? 'At least 3 characters' : undefined),
          }}
        >
          {(field) => <field.TextField label="Name" placeholder="Player name" />}
        </form.AppField>
        <form.SubmitButton label="Save" />
      </form.Form>
    </form.AppForm>
  )
}

const section = 'Forms'

export const formsEntries: GalleryEntry[] = [
  { name: 'label', section, element: <Label>Display name</Label> },
  { name: 'input', section, element: <Input placeholder="Enter a name" /> },
  { name: 'textarea', section, element: <Textarea placeholder="Write a message" /> },
  {
    name: 'input-group',
    section,
    element: (
      <InputGroup>
        <InputGroupAddon>
          <UiIcon icon={Search} size={28} color={colors.textMuted} />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search games" />
        <InputGroupAddon>
          <Text className="text-base text-ps-text-muted">PS5</Text>
        </InputGroupAddon>
      </InputGroup>
    ),
  },
  { name: 'input-otp', section, element: <OtpSample /> },
  {
    name: 'field',
    section,
    element: (
      <FieldGroup>
        <Field>
          <FieldLabel>Email</FieldLabel>
          <Input placeholder="you@example.com" />
          <FieldDescription>We never share it.</FieldDescription>
          <FieldError errors={['Enter a valid email']} />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Notifications</FieldLabel>
            <FieldDescription>Trophies and messages.</FieldDescription>
          </FieldContent>
          <Switch />
        </Field>
      </FieldGroup>
    ),
  },
  { name: 'form', section, element: <FormSample /> },
  { name: 'checkbox', section, element: <Checkbox label="Remember me" defaultChecked /> },
  { name: 'switch', section, element: <SwitchSample /> },
  { name: 'slider', section, element: <SliderSample /> },
  { name: 'progress', section, element: <Progress value={65} /> },
]
